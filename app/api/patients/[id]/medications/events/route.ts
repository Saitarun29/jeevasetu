import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import { recordCareEvent } from '@/lib/audit/care-events';
import * as admin from 'firebase-admin';

export const runtime = 'nodejs';

const RecordMedicationEventSchema = z.object({
  actionId: z.string().uuid('actionId must be a valid client-generated UUID'),
  medicationId: z.string().min(1, 'medicationId is required'),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'scheduledDate must be YYYY-MM-DD'),
  scheduledTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'scheduledTime must be HH:mm'),
  status: z.enum(['TAKEN', 'SKIPPED'], {
    errorMap: () => ({ message: 'Status must be TAKEN or SKIPPED' }),
  }),
  note: z.string().optional(),
  clientTimestamp: z.string().optional(),
  source: z.enum(['online', 'offline_sync']).default('online'),
  // Optional optimistic-concurrency guard for offline-synced events.
  // When present, the server rejects (409) if the prescription version changed.
  expectedVersion: z.number().optional(),
}).refine(
  (data) => data.status !== 'SKIPPED' || (data.note && data.note.trim().length > 0),
  {
    message: 'A documented explanation is mandatory when skipping a medication dose.',
    path: ['note'],
  }
);

// POST /api/patients/[id]/medications/events - Log a medication event with action UUID idempotency
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, member, patientId } = await verifyPatientAccess(request, params.id, [
      'patient',
      'caregiver',
      'family_member',
      'primary_family',
    ]);

    const body = await request.json();
    const validatedData = RecordMedicationEventSchema.parse(body);

    const db = adminFirestore();
    const eventRef = db
      .collection('patients')
      .doc(patientId)
      .collection('medication_events')
      .doc(validatedData.actionId);

    const medRef = db
      .collection('patients')
      .doc(patientId)
      .collection('medications')
      .doc(validatedData.medicationId);

    let isDuplicate = false;
    let savedEvent: any = null;

    // Execute atomic Firestore transaction
    await db.runTransaction(async (transaction) => {
      const existingEventDoc = await transaction.get(eventRef);

      // Idempotency: repeated requests with the same UUID return existing record without duplicate events
      if (existingEventDoc.exists) {
        isDuplicate = true;
        savedEvent = existingEventDoc.data();
        return;
      }

      // Verify medication exists and belongs to this patient
      const medDoc = await transaction.get(medRef);
      if (!medDoc.exists) {
        throw new Error('MEDICATION_NOT_FOUND');
      }

      const medData = medDoc.data()!;
      const currentVersion = medData.version || 1;

      // Schedule version conflict guard: an offline action queued against a stale
      // prescription version must NOT silently land. Surface a 409 for the client
      // to reconcile instead of overwriting/conflicting with a newer schedule.
      if (
        typeof validatedData.expectedVersion === 'number' &&
        validatedData.expectedVersion !== currentVersion
      ) {
        const conflictErr: any = new Error(
          `Schedule version conflict: The prescription was modified (v${currentVersion}) while you were offline. Please review current dosage instructions.`
        );
        conflictErr.statusCode = 409;
        throw conflictErr;
      }

      // Server-side authoritative fields
      const newEvent = {
        id: validatedData.actionId,
        patientId,
        medicationId: validatedData.medicationId,
        medicationName: medData.name,
        dosage: medData.dosage,
        scheduledDate: validatedData.scheduledDate,
        scheduledTime: validatedData.scheduledTime,
        status: validatedData.status,
        actorUid: user.uid, // Derived strictly from verified token, anti-spoofing
        actorName: member.displayName || user.email || 'Care Circle Member',
        actorRole: member.role,
        serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        clientTimestamp: validatedData.clientTimestamp || new Date().toISOString(),
        note: validatedData.note || '',
        source: validatedData.source,
      };

      transaction.set(eventRef, newEvent);
      savedEvent = newEvent;
    });

    if (isDuplicate) {
      return NextResponse.json(
        {
          success: true,
          isDuplicate: true,
          message: 'Action already recorded (idempotent replay).',
          event: savedEvent,
        },
        { status: 200 }
      );
    }

    // Append-only care event audit trail
    const careAction =
      validatedData.status === 'TAKEN'
        ? `Confirmed taken: ${savedEvent.medicationName} (${savedEvent.dosage}) at ${validatedData.scheduledTime}`
        : `Skipped: ${savedEvent.medicationName} (${savedEvent.dosage}) at ${validatedData.scheduledTime}${
            validatedData.note ? ` - Reason: ${validatedData.note}` : ''
          }`;

    await recordCareEvent({
      patientId,
      eventType: validatedData.status === 'TAKEN' ? 'MEDICATION_TAKEN' : 'MEDICATION_SKIPPED',
      actorUid: user.uid,
      actorName: member.displayName || user.email,
      actorRole: member.role,
      action: careAction,
      source: validatedData.source === 'offline_sync' ? 'offline_sync' : 'manual',
      clientTimestamp: validatedData.clientTimestamp,
      entitySnapshot: {
        actionId: validatedData.actionId,
        medicationId: validatedData.medicationId,
        status: validatedData.status,
        scheduledDate: validatedData.scheduledDate,
        scheduledTime: validatedData.scheduledTime,
        note: validatedData.note || '',
      },
    });

    return NextResponse.json(
      {
        success: true,
        isDuplicate: false,
        event: savedEvent,
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error.message === 'MEDICATION_NOT_FOUND') {
      return NextResponse.json(
        { error: 'Medication does not exist or does not belong to this patient.' },
        { status: 404 }
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors.map((e) => e.message).join(', ') }, { status: 400 });
    }
    return NextResponse.json(
      { error: error.message || 'Failed to record medication event' },
      { status: error.statusCode || 500 }
    );
  }
}
