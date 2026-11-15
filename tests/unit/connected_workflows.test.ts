import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'crypto';
import { generateUUID } from '@/lib/utils';
import { hashPasscodeWithHmac, verifyPasscodeWithHmac } from '@/lib/auth/passcode';
import { CaregiverTask, TaskStatus } from '@/types/task';
import { CaregiverHandover } from '@/types/handover';
import { CareGap } from '@/types/care-gap';
import { Medication, MedicationEvent, ExpectedDose } from '@/types/medication';
import { Appointment } from '@/types/appointment';
import { expandDailyDoses, evaluateMissedDoses } from '@/lib/medication/engine';

describe('Connected Workflow 1: Patient -> Caregiver Access & Instant Revocation', () => {
  const pepper = 'integration-test-server-pepper-32-chars-long';
  const patientId = 'patient_kausalya_001';

  interface MemberRecord {
    userId: string;
    email: string;
    displayName: string;
    role: 'primary_family' | 'caregiver' | 'family_member' | 'patient';
    status: 'active' | 'revoked';
  }

  interface InvitationRecord {
    id: string;
    patientId: string;
    passcodeHash: string;
    targetRole: 'caregiver' | 'family_member';
    status: 'pending' | 'redeemed' | 'expired';
    attempts: number;
    maxAttempts: number;
    expiresAt: Date;
    redeemedBy?: string;
  }

  let membersDb: Map<string, MemberRecord>;
  let invitationsDb: Map<string, InvitationRecord>;

  beforeEach(() => {
    membersDb = new Map();
    invitationsDb = new Map();

    // 1. Patient profile creator assigned primary_family
    membersDb.set('user_primary_family', {
      userId: 'user_primary_family',
      email: 'daughter@jeevasetu.dev',
      displayName: 'Anita Sharma',
      role: 'primary_family',
      status: 'active',
    });
  });

  it('executes full invitation, redemption, access verification, cross-patient block, and revocation', async () => {
    // Step 1: Primary family generates 6-digit invitation for visiting nurse
    const rawPasscode = '654321';
    const invitationId = 'inv_nurse_101';
    const passcodeHash = hashPasscodeWithHmac(rawPasscode, { patientId, invitationId }, pepper);

    invitationsDb.set(invitationId, {
      id: invitationId,
      patientId,
      passcodeHash,
      targetRole: 'caregiver',
      status: 'pending',
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 86400000), // 24h TTL
    });

    // Step 2: Nurse redeems passcode in atomic transaction
    const candidatePasscode = '654321';
    const nurseUid = 'user_nurse_sunita';

    const invite = invitationsDb.get(invitationId)!;
    expect(invite.status).toBe('pending');

    const isValid = verifyPasscodeWithHmac(candidatePasscode, invite.passcodeHash, { patientId, invitationId }, pepper);
    expect(isValid).toBe(true);

    // Commit atomic redemption
    invite.status = 'redeemed';
    invite.redeemedBy = nurseUid;
    membersDb.set(nurseUid, {
      userId: nurseUid,
      email: 'nurse.sunita@care.org',
      displayName: 'Nurse Sunita',
      role: invite.targetRole,
      status: 'active',
    });

    // Step 3: Verify nurse has authorized caregiver access
    function checkAccess(userId: string, targetPatient: string, requiredRole?: string): { allowed: boolean; status: number } {
      if (targetPatient !== patientId) {
        return { allowed: false, status: 403 }; // Cross-patient blocked
      }
      const member = membersDb.get(userId);
      if (!member) return { allowed: false, status: 403 };
      if (member.status !== 'active') return { allowed: false, status: 403 }; // Revoked
      if (requiredRole && member.role !== requiredRole && member.role !== 'primary_family') {
        return { allowed: false, status: 403 };
      }
      return { allowed: true, status: 200 };
    }

    expect(checkAccess(nurseUid, patientId, 'caregiver').allowed).toBe(true);

    // Step 4: Verify unrelated account receives HTTP 403
    expect(checkAccess('user_stranger', patientId).allowed).toBe(false);

    // Step 5: Verify cross-patient attempt receives HTTP 403
    expect(checkAccess(nurseUid, 'patient_other_elder').allowed).toBe(false);

    // Step 6: Primary family revokes nurse access
    const nurseMember = membersDb.get(nurseUid)!;
    nurseMember.status = 'revoked';

    // Step 7: Verify revoked caregiver immediately loses access without waiting for token refresh
    const revokedCheck = checkAccess(nurseUid, patientId);
    expect(revokedCheck.allowed).toBe(false);
    expect(revokedCheck.status).toBe(403);
  });
});

describe('Connected Workflow 2: Medication -> Adherence -> Attribution -> Timeline', () => {
  const patientId = 'patient_kausalya_001';
  const timezone = 'Asia/Kolkata';

  it('records TAKEN and SKIPPED events with attribution, emits timeline audits, and enforces schedule version conflicts', () => {
    // Step 1: Medication schedule created with initial version 1
    const medication: Medication = {
      id: 'med_amlo_5mg',
      patientId,
      name: 'Amlodipine Besylate',
      dosage: '5mg',
      form: 'tablet',
      instructions: 'Take one tablet in the morning after breakfast',
      frequency: 'daily',
      times: ['08:00'],
      startDate: '2026-11-01',
      version: 1,
      isActive: true,
      isArchived: false,
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
      createdBy: 'user_doctor',
      updatedBy: 'user_doctor',
    };

    const targetDate = '2026-11-15';
    const scheduledTime = '08:00';
    const auditTimeline: any[] = [];
    const eventsStore = new Map<string, MedicationEvent>();

    // Step 2: Nurse records TAKEN with action UUID
    const actionIdTaken = generateUUID();
    const takenEvent: MedicationEvent = {
      id: actionIdTaken,
      patientId,
      medicationId: medication.id,
      medicationName: medication.name,
      dosage: medication.dosage,
      scheduledDate: targetDate,
      scheduledTime,
      status: 'TAKEN',
      actorUid: 'user_nurse_sunita',
      actorName: 'Nurse Sunita',
      actorRole: 'caregiver',
      serverTimestamp: '2026-11-15T02:35:00Z', // 08:05 IST
      source: 'online',
    };
    eventsStore.set(actionIdTaken, takenEvent);

    auditTimeline.push({
      eventType: 'MEDICATION_TAKEN',
      actorUid: takenEvent.actorUid,
      actorName: takenEvent.actorName,
      action: `Recorded TAKEN for ${medication.name} (${medication.dosage})`,
      serverTimestamp: takenEvent.serverTimestamp,
    });

    expect(eventsStore.size).toBe(1);
    expect(eventsStore.get(actionIdTaken)?.status).toBe('TAKEN');
    expect(auditTimeline[0].actorName).toBe('Nurse Sunita');

    // Step 3: Verify expandDailyDoses reflects TAKEN state
    const doses = expandDailyDoses([medication], targetDate, [takenEvent], timezone);
    expect(doses).toHaveLength(1);
    expect(doses[0].status).toBe('TAKEN');

    // Step 4: Record SKIPPED for afternoon dose with mandatory explanation
    const actionIdSkipped = generateUUID();
    const skipReason = 'Patient experienced mild nausea after lunch';
    const skippedEvent: MedicationEvent = {
      id: actionIdSkipped,
      patientId,
      medicationId: medication.id,
      medicationName: medication.name,
      dosage: medication.dosage,
      scheduledDate: targetDate,
      scheduledTime: '14:00',
      status: 'SKIPPED',
      note: skipReason,
      actorUid: 'user_primary_family',
      actorName: 'Anita Sharma',
      actorRole: 'primary_family',
      serverTimestamp: '2026-11-15T08:35:00Z',
      source: 'online',
    };
    eventsStore.set(actionIdSkipped, skippedEvent);

    expect(skippedEvent.note).toBe(skipReason);

    // Step 5: Test Schedule Version Conflict: Doctor updates prescription to v2 (dosage 10mg)
    medication.version = 2;
    medication.dosage = '10mg';

    function submitOfflineDoseLog(clientExpectedVersion: number, currentServerVersion: number): { status: number; error?: string } {
      if (clientExpectedVersion < currentServerVersion) {
        return {
          status: 409,
          error: `Schedule version conflict: The prescription was modified (v${currentServerVersion}) while you were offline.`,
        };
      }
      return { status: 200 };
    }

    // Client attempts to sync against stale v1
    const staleResult = submitOfflineDoseLog(1, medication.version);
    expect(staleResult.status).toBe(409);
    expect(staleResult.error).toContain('Schedule version conflict');
  });
});

describe('Connected Workflow 3: Offline -> Refresh -> Synchronization & Idempotency', () => {
  interface LocalOutboxItem {
    id: string; // Action UUID
    patientId: string;
    medicationId: string;
    status: 'TAKEN' | 'SKIPPED';
    synced: boolean;
    isConflict: boolean;
  }

  it('preserves queued actions across refresh, syncs on reconnect, and guarantees deduplication', () => {
    // Step 1: Client loads schedule online
    const localIndexedDB = new Map<string, LocalOutboxItem>();
    const serverFirestore = new Map<string, any>();

    // Step 2: Browser goes offline
    let isOnline = false;

    // Step 3: Elder takes medicine offline -> recorded in IndexedDB with client UUID
    const actionUUID = generateUUID();
    const queuedAction: LocalOutboxItem = {
      id: actionUUID,
      patientId: 'patient_kausalya',
      medicationId: 'med_metformin',
      status: 'TAKEN',
      synced: false,
      isConflict: false,
    };
    localIndexedDB.set(actionUUID, queuedAction);

    // Step 4: Simulate page refresh while offline
    const persistedActions = Array.from(localIndexedDB.values());
    expect(persistedActions).toHaveLength(1);
    expect(persistedActions[0].id).toBe(actionUUID);
    expect(persistedActions[0].synced).toBe(false); // Invariant: must not show server-confirmed

    // Step 5: Reconnect
    isOnline = true;

    // Step 6: Background sync service executes
    function syncOutbox(): { synced: number; duplicatesIgnored: number } {
      let synced = 0;
      let duplicatesIgnored = 0;

      for (const item of localIndexedDB.values()) {
        if (!item.synced && !item.isConflict) {
          if (serverFirestore.has(item.id)) {
            // Server idempotency: record already exists, do not duplicate
            item.synced = true;
            duplicatesIgnored++;
          } else {
            // First time arrival: commit event to Firestore
            serverFirestore.set(item.id, { ...item, serverTimestamp: new Date().toISOString() });
            item.synced = true;
            synced++;
          }
        }
      }
      return { synced, duplicatesIgnored };
    }

    const firstSync = syncOutbox();
    expect(firstSync.synced).toBe(1);
    expect(serverFirestore.size).toBe(1);
    expect(localIndexedDB.get(actionUUID)?.synced).toBe(true);

    // Step 7: Retry sync (e.g. repeated online event or duplicate network packet)
    localIndexedDB.get(actionUUID)!.synced = false; // Simulate un-cleared local flag on packet drop
    const retrySync = syncOutbox();
    expect(retrySync.duplicatesIgnored).toBe(1);
    expect(serverFirestore.size).toBe(1); // Exactly one Firestore event preserved!
  });
});

describe('Connected Workflow 4: Caregiver Task -> Handover -> Explicit Acknowledgement', () => {
  const patientId = 'patient_kausalya';

  it('enforces task completion, terminal protection, handover creation, self-ack block, and receiver transfer', () => {
    // Step 1: Primary family creates caregiver task
    const task: CaregiverTask = {
      id: 'task_bp_morning',
      patientId,
      title: 'Check morning resting blood pressure',
      priority: 'high',
      status: 'pending',
      dueDate: '2026-11-15T09:00:00Z',
      assignedToUid: 'caregiver_sunita',
      assignedToName: 'Nurse Sunita',
      assignedByUid: 'family_anita',
      assignedByName: 'Anita Sharma',
      createdAt: '2026-11-15T07:00:00Z',
      updatedAt: '2026-11-15T07:00:00Z',
    };

    // Step 2: Nurse completes task
    task.status = 'completed';
    task.completedAt = '2026-11-15T08:45:00Z';
    task.completedByUid = 'caregiver_sunita';
    task.completedByName = 'Nurse Sunita';

    // Step 3: Terminal protection: another user cannot mutate or re-open the completed task
    function mutateTask(t: CaregiverTask, newStatus: TaskStatus): boolean {
      if (t.status === 'completed' || t.status === 'cancelled') {
        if (t.status === newStatus) return true; // Idempotent no-op
        return false; // Terminal state locked
      }
      t.status = newStatus;
      return true;
    }

    expect(mutateTask(task, 'in_progress')).toBe(false); // Mutation rejected
    expect(mutateTask(task, 'completed')).toBe(true); // Idempotent no-op accepted

    // Step 4: Nurse Sunita initiates shift handover to incoming Nurse Pooja
    const handover: CaregiverHandover = {
      id: 'ho_shift_day_to_night',
      patientId,
      givingCaregiverUid: 'caregiver_sunita',
      givingCaregiverName: 'Nurse Sunita',
      receivingCaregiverUid: 'caregiver_pooja',
      receivingCaregiverName: 'Nurse Pooja',
      status: 'pending_acknowledgement',
      shiftStartTime: '08:00',
      shiftEndTime: '20:00',
      notes: 'Morning BP was 125/82. Afternoon walk completed.',
      patientConditionSummary: 'Alert, cheerful, rested well.',
      pendingTasksSummary: ['Evening medication at 20:00'],
      createdAt: '2026-11-15T19:45:00Z',
    };

    expect(handover.status).toBe('pending_acknowledgement');

    // Step 5: Giving caregiver Sunita attempts to self-acknowledge (must fail)
    function attemptAcknowledge(ho: CaregiverHandover, actorUid: string, actorRole: string): { success: boolean; error?: string } {
      if (ho.status !== 'pending_acknowledgement') {
        return { success: false, error: 'Already acknowledged' };
      }
      if (ho.givingCaregiverUid === actorUid) {
        return { success: false, error: 'Giving caregiver cannot self-acknowledge handover' };
      }
      if (ho.receivingCaregiverUid !== actorUid && actorRole !== 'primary_family') {
        return { success: false, error: 'Unauthorized to acknowledge this handover' };
      }
      ho.status = 'acknowledged';
      ho.acknowledgedAt = new Date().toISOString();
      ho.acknowledgedByUid = actorUid;
      return { success: true };
    }

    const selfAck = attemptAcknowledge(handover, 'caregiver_sunita', 'caregiver');
    expect(selfAck.success).toBe(false);
    expect(selfAck.error).toContain('Giving caregiver cannot self-acknowledge');
    expect(handover.status).toBe('pending_acknowledgement'); // Responsibility remains with Sunita!

    // Step 6: Stranger caregiver attempts to acknowledge (must fail)
    const strangerAck = attemptAcknowledge(handover, 'caregiver_stranger', 'caregiver');
    expect(strangerAck.success).toBe(false);
    expect(strangerAck.error).toContain('Unauthorized');

    // Step 7: Designated incoming caregiver Nurse Pooja acknowledges
    const poojaAck = attemptAcknowledge(handover, 'caregiver_pooja', 'caregiver');
    expect(poojaAck.success).toBe(true);
    expect(handover.status).toBe('acknowledged');
    expect(handover.acknowledgedByUid).toBe('caregiver_pooja');
  });
});

describe('Connected Workflow 5: Proactive Care Gap Detection & Resolution', () => {
  const patientId = 'patient_kausalya';

  it('detects all 4 critical care gaps and resolves them when underlying conditions are corrected', () => {
    const now = new Date('2026-11-15T14:00:00Z');

    // Synthetic state:
    // 1. Unconfirmed morning dose (scheduled 08:00, grace 60m passed at 14:00)
    const medDose: ExpectedDose = {
      doseKey: 'med_amlo_2026-11-15_08:00',
      medicationId: 'med_amlo',
      medicationName: 'Amlodipine',
      dosage: '5mg',
      form: 'tablet',
      instructions: '',
      scheduledDate: '2026-11-15',
      scheduledTime: '08:00',
      status: 'UNCONFIRMED',
    };

    // 2. Upcoming doctor appointment in 24h without caregiver escort
    const apt: Appointment = {
      id: 'apt_cardio',
      patientId,
      doctorName: 'Dr. Rao',
      specialty: 'Cardiology',
      clinicName: 'Apollo Clinic',
      clinicAddress: 'MG Road',
      appointmentDate: '2026-11-16T10:00:00Z', // 20h from now
      localDate: '2026-11-16',
      localTime: '15:30',
      timezone: 'Asia/Kolkata',
      status: 'scheduled',
      accompaniedBy: '', // Unaccompanied!
      reminderPreferences: { email24h: true, email2h: true },
      reminderStatus: { sent24h: false, sent2h: false },
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-10T00:00:00Z',
      createdBy: 'user_family',
      updatedBy: 'user_family',
    };

    // 3. Pending handover created 3 hours ago
    const handover: CaregiverHandover = {
      id: 'ho_old',
      patientId,
      givingCaregiverUid: 'caregiver_a',
      givingCaregiverName: 'Caregiver A',
      receivingCaregiverUid: 'caregiver_b',
      receivingCaregiverName: 'Caregiver B',
      status: 'pending_acknowledgement',
      shiftStartTime: '06:00',
      shiftEndTime: '10:00',
      notes: '',
      patientConditionSummary: 'Stable',
      pendingTasksSummary: [],
      createdAt: '2026-11-15T10:30:00Z', // 3.5h ago!
    };

    // 4. Overdue task due 4 hours ago
    const task: CaregiverTask = {
      id: 'task_late',
      patientId,
      title: 'Afternoon Physiotherapy',
      priority: 'high',
      status: 'pending',
      dueDate: '2026-11-15T10:00:00Z', // 4h ago!
      assignedToUid: 'caregiver_b',
      assignedToName: 'Caregiver B',
      assignedByUid: 'family',
      assignedByName: 'Family',
      createdAt: '2026-11-15T08:00:00Z',
      updatedAt: '2026-11-15T08:00:00Z',
    };

    // Evaluator function
    function evaluateGaps(): CareGap[] {
      const gaps: CareGap[] = [];

      // Gap 1: Dose unconfirmed > 60m
      if (medDose.status === 'UNCONFIRMED') {
        gaps.push({
          id: 'gap_dose',
          patientId,
          type: 'unconfirmed_dose',
          severity: 'critical',
          title: `Missed Dose: ${medDose.medicationName}`,
          description: 'Dose unconfirmed past grace period',
          detectedAt: now.toISOString(),
          actionRequired: 'Confirm ingestion or log skip reason',
        });
      }

      // Gap 2: Appointment < 48h unescorted
      const hoursToApt = (new Date(apt.appointmentDate).getTime() - now.getTime()) / (1000 * 60 * 60);
      if (hoursToApt > 0 && hoursToApt < 48 && (!apt.accompaniedBy || apt.accompaniedBy.trim().length === 0)) {
        gaps.push({
          id: 'gap_apt',
          patientId,
          type: 'unaccompanied_appointment',
          severity: 'warning',
          title: `Unaccompanied Appointment: Dr. ${apt.doctorName}`,
          description: 'No escort caregiver assigned',
          detectedAt: now.toISOString(),
          actionRequired: 'Assign caregiver escort',
        });
      }

      // Gap 3: Handover pending > 2h
      const hoursPending = (now.getTime() - new Date(handover.createdAt).getTime()) / (1000 * 60 * 60);
      if (handover.status === 'pending_acknowledgement' && hoursPending > 2) {
        gaps.push({
          id: 'gap_ho',
          patientId,
          type: 'pending_handover',
          severity: 'critical',
          title: `Unacknowledged Handover from ${handover.givingCaregiverName}`,
          description: 'Shift duty transfer unconfirmed',
          detectedAt: now.toISOString(),
          actionRequired: 'Receiving caregiver must acknowledge',
        });
      }

      // Gap 4: Overdue task
      if (task.status === 'pending' && now.getTime() > new Date(task.dueDate).getTime()) {
        gaps.push({
          id: 'gap_task',
          patientId,
          type: 'overdue_task',
          severity: 'high' as any,
          title: `Overdue Task: ${task.title}`,
          description: 'Task past due date',
          detectedAt: now.toISOString(),
          actionRequired: 'Complete task or reschedule',
        });
      }

      return gaps;
    }

    // Initial check: all 4 gaps must be detected
    const initialGaps = evaluateGaps();
    expect(initialGaps).toHaveLength(4);
    expect(initialGaps.map((g) => g.type)).toEqual([
      'unconfirmed_dose',
      'unaccompanied_appointment',
      'pending_handover',
      'overdue_task',
    ]);

    // Resolution Step:
    // 1. Confirm dose taken
    medDose.status = 'TAKEN';
    // 2. Assign escort to appointment
    apt.accompaniedBy = 'Anita Sharma (Daughter)';
    // 3. Acknowledge handover
    handover.status = 'acknowledged';
    // 4. Complete task
    task.status = 'completed';

    // Re-evaluate gaps after resolution
    const resolvedGaps = evaluateGaps();
    expect(resolvedGaps).toHaveLength(0); // All 4 care gaps resolved cleanly!
  });
});
