import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import { recordCareEvent } from '@/lib/audit/care-events';
import {
  validateAndConvertAppointmentDate,
  detectAppointmentConflicts,
} from '@/lib/appointment/engine';
import { Appointment } from '@/types/appointment';
import * as admin from 'firebase-admin';

export const runtime = 'nodejs';

const CreateAppointmentSchema = z.object({
  doctorName: z.string().min(2, 'Doctor name is required (min 2 characters)'),
  specialty: z.string().min(2, 'Medical specialty is required (e.g. Cardiology, Orthopedics)'),
  clinicName: z.string().min(2, 'Clinic or Hospital name is required'),
  clinicAddress: z.string().min(2, 'Clinic address is required'),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD'),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be formatted as HH:mm (24h)'),
  notes: z.string().optional(),
  accompaniedBy: z.string().optional(),
  reminderPreferences: z
    .object({
      email24h: z.boolean().default(true),
      email2h: z.boolean().default(true),
    })
    .default({ email24h: true, email2h: true }),
  allowConflictOverride: z.boolean().default(false),
});

// GET /api/patients/[id]/appointments - List doctor appointments
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { patientId } = await verifyPatientAccess(request, params.id);
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status') || 'all';

    const db = adminFirestore();
    let query: admin.firestore.Query = db
      .collection('patients')
      .doc(patientId)
      .collection('appointments')
      .orderBy('appointmentDate', 'asc');

    if (statusFilter !== 'all') {
      query = query.where('status', '==', statusFilter);
    }

    const snapshot = await query.get();
    const appointments: Appointment[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as any),
    }));

    return NextResponse.json({ appointments });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch appointments' },
      { status: error.statusCode || 500 }
    );
  }
}

// POST /api/patients/[id]/appointments - Schedule a new doctor appointment
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, member, patientId } = await verifyPatientAccess(request, params.id, [
      'primary_family',
      'family_member',
      'caregiver',
    ]);
    const body = await request.json();
    const validatedData = CreateAppointmentSchema.parse(body);

    const db = adminFirestore();

    // 1. Fetch patient timezone
    const patientDoc = await db.collection('patients').doc(patientId).get();
    if (!patientDoc.exists) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
    const patientTimezone = patientDoc.data()?.timezone || 'Asia/Kolkata';

    // 2. Validate appointment date & time in patient's timezone
    const { instant, error: dateError } = validateAndConvertAppointmentDate(
      validatedData.localDate,
      validatedData.localTime,
      patientTimezone,
      false // Rejects past dates
    );

    if (dateError) {
      return NextResponse.json({ error: dateError }, { status: 400 });
    }

    // 3. Conflict Detection: Check for overlapping appointments within 60 minutes
    const existingSnap = await db
      .collection('patients')
      .doc(patientId)
      .collection('appointments')
      .where('status', '==', 'scheduled')
      .get();

    const existingAppointments: Appointment[] = existingSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as any),
    }));

    const conflicts = detectAppointmentConflicts(existingAppointments, instant, 60);

    if (conflicts.length > 0 && !validatedData.allowConflictOverride) {
      return NextResponse.json(
        {
          error: `Conflicting appointment detected: ${conflicts[0].doctorName} (${conflicts[0].specialty}) is scheduled within ${conflicts[0].timeDiffMinutes} minutes. Set allowConflictOverride=true to proceed anyway.`,
          conflicts,
        },
        { status: 409 }
      );
    }

    // 4. Create appointment document
    const appRef = db.collection('patients').doc(patientId).collection('appointments').doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    const appointmentRecord = {
      id: appRef.id,
      patientId,
      doctorName: validatedData.doctorName,
      specialty: validatedData.specialty,
      clinicName: validatedData.clinicName,
      clinicAddress: validatedData.clinicAddress,
      appointmentDate: instant.toISOString(),
      localDate: validatedData.localDate,
      localTime: validatedData.localTime,
      timezone: patientTimezone,
      notes: validatedData.notes || '',
      accompaniedBy: validatedData.accompaniedBy || '',
      status: 'scheduled',
      reminderPreferences: validatedData.reminderPreferences,
      reminderStatus: {
        sent24h: false,
        sent2h: false,
      },
      createdBy: user.uid,
      updatedBy: user.uid,
      createdAt: now,
      updatedAt: now,
    };

    await appRef.set(appointmentRecord);

    // 5. Append-only Care Event in Timeline
    await recordCareEvent({
      patientId,
      eventType: 'APPOINTMENT_SCHEDULED',
      actorUid: user.uid,
      actorName: member.displayName || user.email,
      actorRole: member.role,
      action: `Scheduled appointment with ${validatedData.doctorName} (${validatedData.specialty}) at ${validatedData.clinicName} on ${validatedData.localDate} at ${validatedData.localTime}`,
      entitySnapshot: {
        appointmentId: appRef.id,
        doctorName: validatedData.doctorName,
        specialty: validatedData.specialty,
        clinicName: validatedData.clinicName,
        appointmentDate: instant.toISOString(),
        localDate: validatedData.localDate,
        localTime: validatedData.localTime,
      },
    });

    return NextResponse.json(
      {
        success: true,
        appointmentId: appRef.id,
        appointment: appointmentRecord,
        conflictWarning: conflicts.length > 0 ? conflicts : undefined,
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors.map((e) => e.message).join(', ') }, { status: 400 });
    }
    return NextResponse.json(
      { error: error.message || 'Failed to schedule appointment' },
      { status: error.statusCode || 500 }
    );
  }
}
