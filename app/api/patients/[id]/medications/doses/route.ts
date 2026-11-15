import { NextResponse } from 'next/server';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import {
  expandDailyDoses,
  evaluateMissedDoses,
  calculateAdherenceMetrics,
  getPatientLocalDate,
} from '@/lib/medication/engine';
import { Medication, MedicationEvent } from '@/types/medication';

export const runtime = 'nodejs';

// GET /api/patients/[id]/medications/doses?date=YYYY-MM-DD
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { patientId } = await verifyPatientAccess(request, params.id);
    const { searchParams } = new URL(request.url);

    const db = adminFirestore();

    // Fetch patient profile to get their explicit IANA timezone
    const patientDoc = await db.collection('patients').doc(patientId).get();
    if (!patientDoc.exists) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
    const patientData = patientDoc.data()!;
    const patientTimezone = patientData.timezone || 'Asia/Kolkata';

    // Compute patient's local date if not explicitly requested
    const now = new Date();
    const dateParam = searchParams.get('date') || getPatientLocalDate(now, patientTimezone);
    const gracePeriodMinutes = Number(searchParams.get('gracePeriod') || 120);

    // 1. Fetch active, non-archived medications
    const medsSnapshot = await db
      .collection('patients')
      .doc(patientId)
      .collection('medications')
      .where('isArchived', '==', false)
      .where('isActive', '==', true)
      .get();

    const medications: Medication[] = medsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as any),
    }));

    // 2. Fetch recorded events for this date
    const eventsSnapshot = await db
      .collection('patients')
      .doc(patientId)
      .collection('medication_events')
      .where('scheduledDate', '==', dateParam)
      .get();

    const events: MedicationEvent[] = eventsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as any),
    }));

    // 3. Expand schedule into expected doses using the patient's local timezone
    const rawDoses = expandDailyDoses(medications, dateParam, events, patientTimezone);

    // 4. Server-side evaluation of MISSED doses based on grace period and local scheduled instants
    const evaluatedDoses = evaluateMissedDoses(rawDoses, now, gracePeriodMinutes, patientTimezone);

    // 5. Calculate 4-state adherence metrics
    const metrics = calculateAdherenceMetrics(evaluatedDoses);

    return NextResponse.json({
      patientTimezone,
      date: dateParam,
      doses: evaluatedDoses,
      metrics,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to expand medication doses' },
      { status: error.statusCode || 500 }
    );
  }
}
