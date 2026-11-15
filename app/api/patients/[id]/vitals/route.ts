import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import { recordCareEvent } from '@/lib/audit/care-events';

export const runtime = 'nodejs';

const LogVitalsSchema = z.object({
  bloodPressureSystolic: z.number().int().min(50).max(250).optional(),
  bloodPressureDiastolic: z.number().int().min(30).max(150).optional(),
  bloodGlucose: z.number().min(30).max(600).optional(),
  glucoseContext: z.enum(['fasting', 'post_meal', 'random']).optional(),
  heartRate: z.number().int().min(30).max(220).optional(),
  oxygenSaturation: z.number().min(50).max(100).optional(),
  temperatureFahrenheit: z.number().min(90).max(110).optional(),
  notes: z.string().max(500).optional(),
});

// GET /api/patients/[id]/vitals - List recent vitals readings
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { patientId } = await verifyPatientAccess(request, params.id, [
      'patient',
      'caregiver',
      'family_member',
      'primary_family',
    ]);

    const db = adminFirestore();
    const snap = await db
      .collection('patients')
      .doc(patientId)
      .collection('vitals')
      .orderBy('recordedAt', 'desc')
      .limit(30)
      .get();

    const vitals = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ vitals });
  } catch (error: any) {
    const status = error.statusCode || 500;
    return NextResponse.json({ error: error.message || 'Failed to fetch vitals' }, { status });
  }
}

// POST /api/patients/[id]/vitals - Log a new vitals reading
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, member, patientId } = await verifyPatientAccess(request, params.id, [
      'caregiver',
      'family_member',
      'primary_family',
      'patient',
    ]);

    const body = await request.json();
    const validated = LogVitalsSchema.parse(body);

    const now = new Date().toISOString();
    const db = adminFirestore();
    const vitalsRef = db.collection('patients').doc(patientId).collection('vitals').doc();

    const newVitals = {
      id: vitalsRef.id,
      patientId,
      ...validated,
      recordedByUid: user.uid,
      recordedByName: member.displayName || user.email || 'Caregiver',
      recordedByRole: member.role,
      recordedAt: now,
    };

    await vitalsRef.set(newVitals);

    // Build human-readable audit string
    const parts: string[] = [];
    if (validated.bloodPressureSystolic && validated.bloodPressureDiastolic) {
      parts.push(`BP ${validated.bloodPressureSystolic}/${validated.bloodPressureDiastolic} mmHg`);
    }
    if (validated.bloodGlucose) {
      parts.push(`Glucose ${validated.bloodGlucose} mg/dL (${validated.glucoseContext || 'random'})`);
    }
    if (validated.oxygenSaturation) {
      parts.push(`SpO2 ${validated.oxygenSaturation}%`);
    }
    if (validated.heartRate) {
      parts.push(`HR ${validated.heartRate} bpm`);
    }

    const summaryText = parts.length > 0 ? parts.join(', ') : 'Vitals logged';

    await recordCareEvent({
      patientId,
      eventType: 'VITALS_LOGGED' as any,
      actorUid: user.uid,
      actorName: member.displayName || user.email || 'Caregiver',
      actorRole: member.role,
      action: `Recorded patient vitals: ${summaryText}`,
      entitySnapshot: newVitals,
    });

    return NextResponse.json({ success: true, vitals: newVitals }, { status: 201 });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: error.errors[0]?.message || 'Validation error' }, { status: 400 });
    }
    const status = error.statusCode || 500;
    return NextResponse.json({ error: error.message || 'Failed to log vitals' }, { status });
  }
}
