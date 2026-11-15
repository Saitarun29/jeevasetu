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

const UpdateAppointmentSchema = z.object({
  doctorName: z.string().min(2).optional(),
  specialty: z.string().min(2).optional(),
  clinicName: z.string().min(2).optional(),
  clinicAddress: z.string().min(2).optional(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  notes: z.string().optional(),
  accompaniedBy: z.string().optional(),
  status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
  cancellationReason: z.string().optional(),
  reminderPreferences: z
    .object({
      email24h: z.boolean(),
      email2h: z.boolean(),
    })
    .optional(),
  allowConflictOverride: z.boolean().default(false),
});

// GET /api/patients/[id]/appointments/[appId] - Single appointment details
export async function GET(
  request: Request,
  { params }: { params: { id: string; appId: string } }
) {
  try {
    const { patientId } = await verifyPatientAccess(request, params.id);
    const db = adminFirestore();

    const appDoc = await db
      .collection('patients')
      .doc(patientId)
      .collection('appointments')
      .doc(params.appId)
      .get();

    if (!appDoc.exists) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    return NextResponse.json({ appointment: { id: appDoc.id, ...appDoc.data() } });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch appointment' },
      { status: error.statusCode || 500 }
    );
  }
}

// PATCH /api/patients/[id]/appointments/[appId] - Edit, Complete, or Cancel appointment
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; appId: string } }
) {
  try {
    const { user, member, patientId } = await verifyPatientAccess(request, params.id, [
      'primary_family',
      'family_member',
      'caregiver',
    ]);
    const body = await request.json();
    const validatedData = UpdateAppointmentSchema.parse(body);

    const db = adminFirestore();
    const appRef = db.collection('patients').doc(patientId).collection('appointments').doc(params.appId);

    const existingDoc = await appRef.get();
    if (!existingDoc.exists) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    const current = existingDoc.data() as Appointment;

    // Role restrictions: Caregivers can only mark completed or update notes/accompaniment
    if (member.role === 'caregiver') {
      if (validatedData.status === 'cancelled' || validatedData.doctorName || validatedData.specialty) {
        return NextResponse.json(
          { error: 'Caregivers may only mark appointments completed or update accompaniment notes.' },
          { status: 403 }
        );
      }
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const updatePayload: any = {
      updatedBy: user.uid,
      updatedAt: now,
    };

    let careEventType: any = 'APPOINTMENT_UPDATED';
    let careAction = `Updated appointment with ${current.doctorName}`;

    // Handle cancellation
    if (validatedData.status === 'cancelled') {
      if (!validatedData.cancellationReason?.trim()) {
        return NextResponse.json(
          { error: 'A cancellation reason is required when cancelling an appointment.' },
          { status: 400 }
        );
      }
      updatePayload.status = 'cancelled';
      updatePayload.cancellationReason = validatedData.cancellationReason.trim();
      careEventType = 'APPOINTMENT_CANCELLED';
      careAction = `Cancelled appointment with ${current.doctorName} (${current.specialty}) on ${current.localDate}. Reason: ${validatedData.cancellationReason}`;
    } else if (validatedData.status === 'completed') {
      updatePayload.status = 'completed';
      careEventType = 'APPOINTMENT_COMPLETED';
      careAction = `Marked appointment with ${current.doctorName} (${current.specialty}) as completed`;
    }

    // Handle date / time reschedule
    if (validatedData.localDate || validatedData.localTime) {
      const newLocalDate = validatedData.localDate || current.localDate;
      const newLocalTime = validatedData.localTime || current.localTime;
      const timezone = current.timezone || 'Asia/Kolkata';

      const { instant, error: dateError } = validateAndConvertAppointmentDate(
        newLocalDate,
        newLocalTime,
        timezone,
        false
      );

      if (dateError) {
        return NextResponse.json({ error: dateError }, { status: 400 });
      }

      // Check conflict
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

      const conflicts = detectAppointmentConflicts(existingAppointments, instant, 60, params.appId);

      if (conflicts.length > 0 && !validatedData.allowConflictOverride) {
        return NextResponse.json(
          {
            error: `Conflicting appointment detected: ${conflicts[0].doctorName} (${conflicts[0].specialty}) is scheduled within ${conflicts[0].timeDiffMinutes} minutes. Set allowConflictOverride=true to proceed anyway.`,
            conflicts,
          },
          { status: 409 }
        );
      }

      updatePayload.appointmentDate = instant.toISOString();
      updatePayload.localDate = newLocalDate;
      updatePayload.localTime = newLocalTime;

      // Reset reminder delivery status on reschedule so fresh reminders are sent!
      updatePayload.reminderStatus = {
        sent24h: false,
        sent2h: false,
      };

      careAction = `Rescheduled appointment with ${current.doctorName} to ${newLocalDate} at ${newLocalTime}`;
    }

    // Update remaining optional fields
    if (validatedData.doctorName) updatePayload.doctorName = validatedData.doctorName;
    if (validatedData.specialty) updatePayload.specialty = validatedData.specialty;
    if (validatedData.clinicName) updatePayload.clinicName = validatedData.clinicName;
    if (validatedData.clinicAddress) updatePayload.clinicAddress = validatedData.clinicAddress;
    if (validatedData.notes !== undefined) updatePayload.notes = validatedData.notes;
    if (validatedData.accompaniedBy !== undefined) updatePayload.accompaniedBy = validatedData.accompaniedBy;
    if (validatedData.reminderPreferences) updatePayload.reminderPreferences = validatedData.reminderPreferences;

    await appRef.update(updatePayload);

    // Record append-only Care Event in Timeline
    await recordCareEvent({
      patientId,
      eventType: careEventType,
      actorUid: user.uid,
      actorName: member.displayName || user.email,
      actorRole: member.role,
      action: careAction,
      entitySnapshot: {
        appointmentId: params.appId,
        ...updatePayload,
      },
    });

    return NextResponse.json({
      success: true,
      appointment: { ...current, ...updatePayload },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors.map((e) => e.message).join(', ') }, { status: 400 });
    }
    return NextResponse.json(
      { error: error.message || 'Failed to update appointment' },
      { status: error.statusCode || 500 }
    );
  }
}
