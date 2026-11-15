import { adminFirestore } from '@/lib/firebase/admin';
import { CaregiverHandover } from '@/types/handover';
import { recordCareEvent } from '@/lib/audit/care-events';
import * as admin from 'firebase-admin';

export class HandoverError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'HandoverError';
    this.statusCode = statusCode;
  }
}

export interface CreateHandoverInput {
  patientId: string;
  givingCaregiverUid: string;
  givingCaregiverName: string;
  receivingCaregiverUid: string;
  receivingCaregiverName: string;
  shiftStartTime: string;
  shiftEndTime: string;
  notes: string;
  patientConditionSummary: string;
  pendingTasksSummary: string[];
  vitalSignsSnapshot?: {
    bloodPressure?: string;
    bloodSugar?: string;
    pulseRate?: string;
    temperature?: string;
  };
}

export async function initiateCaregiverHandover(input: CreateHandoverInput): Promise<CaregiverHandover> {
  const db = adminFirestore();
  const handoverRef = db.collection('patients').doc(input.patientId).collection('handovers').doc();
  const now = new Date().toISOString();

  // Invariant: Giving caregiver cannot hand over to themselves
  if (input.givingCaregiverUid === input.receivingCaregiverUid) {
    throw new HandoverError('A caregiver cannot initiate a handover to themselves. Select an incoming caregiver.', 400);
  }

  const handover: CaregiverHandover = {
    id: handoverRef.id,
    patientId: input.patientId,
    givingCaregiverUid: input.givingCaregiverUid,
    givingCaregiverName: input.givingCaregiverName,
    receivingCaregiverUid: input.receivingCaregiverUid,
    receivingCaregiverName: input.receivingCaregiverName,
    status: 'pending_acknowledgement',
    shiftStartTime: input.shiftStartTime,
    shiftEndTime: input.shiftEndTime,
    notes: input.notes.trim(),
    patientConditionSummary: input.patientConditionSummary.trim(),
    pendingTasksSummary: input.pendingTasksSummary || [],
    vitalSignsSnapshot: input.vitalSignsSnapshot,
    createdAt: now,
  };

  await handoverRef.set(handover);

  await recordCareEvent({
    patientId: input.patientId,
    eventType: 'HANDOVER_INITIATED',
    actorUid: input.givingCaregiverUid,
    actorName: input.givingCaregiverName,
    actorRole: 'caregiver',
    action: `Initiated shift handover to ${input.receivingCaregiverName} (Awaiting acknowledgement)`,
    entitySnapshot: {
      handoverId: handoverRef.id,
      shiftEndTime: input.shiftEndTime,
      notes: input.notes,
      condition: input.patientConditionSummary,
    },
  });

  return handover;
}

export async function acknowledgeCaregiverHandover(
  patientId: string,
  handoverId: string,
  actorUid: string,
  actorName: string,
  actorRole: string
): Promise<CaregiverHandover> {
  const db = adminFirestore();
  const handoverRef = db.collection('patients').doc(patientId).collection('handovers').doc(handoverId);

  // Concurrency-safe acknowledgement: read-check-write must be atomic so that two
  // concurrent PATCH requests (double-tap, or receiver + supervisor racing) cannot
  // both transition the handover and emit duplicate HANDOVER_ACKNOWLEDGED audit events.
  let acknowledged: CaregiverHandover | null = null;

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(handoverRef);
    if (!doc.exists) {
      throw new HandoverError('Handover record not found.', 404);
    }

    const existing = doc.data() as CaregiverHandover;

    // Idempotent no-op guard: already acknowledged
    if (existing.status !== 'pending_acknowledgement') {
      throw new HandoverError(`Cannot acknowledge handover: Already ${existing.status}.`, 409);
    }

    // Invariant: Responsibility transfers ONLY when explicit receiving caregiver or supervisor acknowledges
    const isDesignatedReceiver = existing.receivingCaregiverUid === actorUid;
    const isPrimarySupervisor = actorRole === 'primary_family';

    if (!isDesignatedReceiver && !isPrimarySupervisor) {
      throw new HandoverError(
        `Permission denied. Only designated receiving caregiver (${existing.receivingCaregiverName}) or primary family can acknowledge this handover.`,
        403
      );
    }

    // Invariant: Giving caregiver CANNOT self-acknowledge their own handover under any circumstances
    if (existing.givingCaregiverUid === actorUid) {
      throw new HandoverError('Giving caregiver cannot self-acknowledge their own handover.', 403);
    }

    const now = new Date().toISOString();
    const updates: Partial<CaregiverHandover> = {
      status: 'acknowledged',
      acknowledgedAt: now,
      acknowledgedByUid: actorUid,
    };

    // Conditional write inside the transaction: if the status changed between
    // the transaction read and commit (concurrent writer), the transaction retries,
    // re-reads, and the guard at status !== 'pending_acknowledgement' then rejects.
    transaction.update(handoverRef, updates);
    acknowledged = { ...existing, ...updates };
  });

  const result = acknowledged!;
  // Emit the audit trail only AFTER a successful commit (never on duplicate/race paths)
  await recordCareEvent({
    patientId,
    eventType: 'HANDOVER_ACKNOWLEDGED',
    actorUid,
    actorName,
    actorRole,
    action: `Acknowledged care handover from ${result.givingCaregiverName}. Shift responsibility accepted.`,
    entitySnapshot: {
      handoverId,
      givingCaregiver: result.givingCaregiverName,
      receivingCaregiver: result.receivingCaregiverName,
      acknowledgedAt: result.acknowledgedAt,
    },
  });

  return result;
}

export async function cancelOrRejectCaregiverHandover(
  patientId: string,
  handoverId: string,
  actorUid: string,
  actorName: string,
  actorRole: string,
  reason: string = ''
): Promise<CaregiverHandover> {
  const db = adminFirestore();
  const handoverRef = db.collection('patients').doc(patientId).collection('handovers').doc(handoverId);

  let updatedHandover: CaregiverHandover | null = null;

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(handoverRef);
    if (!doc.exists) {
      throw new HandoverError('Handover record not found.', 404);
    }

    const existing = doc.data() as CaregiverHandover;

    if (existing.status !== 'pending_acknowledgement') {
      throw new HandoverError(`Cannot cancel or reject handover: Already ${existing.status}.`, 409);
    }

    // Permission check: giving caregiver (cancel), receiving caregiver (reject), or primary family (supervisor cancel)
    const isGivingCaregiver = existing.givingCaregiverUid === actorUid;
    const isDesignatedReceiver = existing.receivingCaregiverUid === actorUid;
    const isPrimarySupervisor = actorRole === 'primary_family';

    if (!isGivingCaregiver && !isDesignatedReceiver && !isPrimarySupervisor) {
      throw new HandoverError(
        'Permission denied. Only designated caregivers or primary family can cancel or reject this handover.',
        403
      );
    }

    const now = new Date().toISOString();
    const updates: Partial<CaregiverHandover> = {
      status: 'cancelled',
      cancelledAt: now,
      cancelledByUid: actorUid,
      cancellationReason: reason.trim() || (isGivingCaregiver ? 'Cancelled by giving caregiver' : 'Declined by recipient'),
    };

    transaction.update(handoverRef, updates);
    updatedHandover = { ...existing, ...updates };
  });

  const result = updatedHandover!;

  await recordCareEvent({
    patientId,
    eventType: 'HANDOVER_CANCELLED',
    actorUid,
    actorName,
    actorRole,
    action: `Shift handover cancelled: ${result.cancellationReason}`,
    entitySnapshot: {
      handoverId,
      givingCaregiver: result.givingCaregiverName,
      receivingCaregiver: result.receivingCaregiverName,
      cancelledAt: result.cancelledAt,
      reason: result.cancellationReason,
    },
  });

  return result;
}

export async function listCaregiverHandovers(patientId: string): Promise<CaregiverHandover[]> {
  const db = adminFirestore();
  const snap = await db
    .collection('patients')
    .doc(patientId)
    .collection('handovers')
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();

  return snap.docs.map((d) => d.data() as CaregiverHandover);
}
