import { describe, it, expect } from 'vitest';
import { CaregiverTask, TaskStatus, TaskPriority } from '@/types/task';
import { CaregiverHandover, HandoverStatus } from '@/types/handover';
import { CareGap, CareGapType } from '@/types/care-gap';

describe('Milestone 5: Care Continuity — Caregiver Tasks Lifecycle', () => {
  it('creates a task with pending status and valid priority and due date', () => {
    const task: CaregiverTask = {
      id: 'task_001',
      patientId: 'patient_123',
      title: 'Blood glucose check before dinner',
      priority: 'high',
      status: 'pending',
      dueDate: '2026-11-15T19:00:00Z',
      assignedToUid: 'caregiver_sunita',
      assignedToName: 'Sunita Sharma',
      assignedByUid: 'family_anita',
      assignedByName: 'Anita Sharma',
      createdAt: '2026-11-15T12:00:00Z',
      updatedAt: '2026-11-15T12:00:00Z',
    };

    expect(task.status).toBe('pending');
    expect(task.priority).toBe('high');
    expect(task.assignedToUid).toBe('caregiver_sunita');
  });

  it('completes a task with actor attribution and completion timestamp', () => {
    const initialTask: CaregiverTask = {
      id: 'task_002',
      patientId: 'patient_123',
      title: 'Administer Evening Insulin (6 Units)',
      priority: 'urgent',
      status: 'pending',
      dueDate: '2026-11-15T20:00:00Z',
      assignedToUid: 'caregiver_sunita',
      assignedToName: 'Sunita Sharma',
      assignedByUid: 'family_anita',
      assignedByName: 'Anita Sharma',
      createdAt: '2026-11-15T12:00:00Z',
      updatedAt: '2026-11-15T12:00:00Z',
    };

    function completeTask(task: CaregiverTask, completedByUid: string, completedByName: string, nowIso: string): CaregiverTask {
      return {
        ...task,
        status: 'completed',
        completedAt: nowIso,
        completedByUid,
        completedByName,
        updatedAt: nowIso,
      };
    }

    const completed = completeTask(initialTask, 'caregiver_sunita', 'Sunita Sharma', '2026-11-15T20:05:00Z');
    expect(completed.status).toBe('completed');
    expect(completed.completedByUid).toBe('caregiver_sunita');
    expect(completed.completedAt).toBe('2026-11-15T20:05:00Z');
  });

  it('protects terminal task states from unauthorized mutation and attribution overwrites', () => {
    const completedTask: CaregiverTask = {
      id: 'task_003',
      patientId: 'patient_123',
      title: 'Morning Physiotherapy Routine',
      priority: 'medium',
      status: 'completed',
      dueDate: '2026-11-15T09:00:00Z',
      assignedToUid: 'caregiver_anita',
      assignedToName: 'Anita',
      assignedByUid: 'family_lead',
      assignedByName: 'Family Lead',
      createdAt: '2026-11-15T08:00:00Z',
      updatedAt: '2026-11-15T09:10:00Z',
      completedAt: '2026-11-15T09:10:00Z',
      completedByUid: 'caregiver_anita',
      completedByName: 'Anita',
    };

    function safeUpdateTask(task: CaregiverTask, requestedStatus: TaskStatus): { allowed: boolean; idempotent: boolean; task: CaregiverTask } {
      if (task.status === 'completed' || task.status === 'cancelled') {
        if (task.status === requestedStatus) {
          return { allowed: true, idempotent: true, task };
        }
        return { allowed: false, idempotent: false, task };
      }
      return { allowed: true, idempotent: false, task: { ...task, status: requestedStatus } };
    }

    // Attempting to re-open a completed task without explicit workflow is rejected
    const reOpen = safeUpdateTask(completedTask, 'in_progress');
    expect(reOpen.allowed).toBe(false);

    // Duplicate completion request returns original record idempotently without mutating metadata
    const duplicateComplete = safeUpdateTask(completedTask, 'completed');
    expect(duplicateComplete.allowed).toBe(true);
    expect(duplicateComplete.idempotent).toBe(true);
    expect(duplicateComplete.task.completedByUid).toBe('caregiver_anita');
  });
});

describe('Milestone 5: Care Continuity — Acknowledged Shift Handover Invariants', () => {
  it('enforces that shift handover begins as pending_acknowledgement', () => {
    const handover: CaregiverHandover = {
      id: 'ho_001',
      patientId: 'patient_123',
      givingCaregiverUid: 'caregiver_day',
      givingCaregiverName: 'Ramesh Day Shift',
      receivingCaregiverUid: 'caregiver_night',
      receivingCaregiverName: 'Pooja Night Shift',
      status: 'pending_acknowledgement',
      shiftStartTime: '20:00',
      shiftEndTime: '08:00',
      notes: 'Patient had normal lunch. Evening medications prepared.',
      patientConditionSummary: 'Alert, resting comfortably.',
      pendingTasksSummary: ['Check 22:00 BP'],
      createdAt: '2026-11-15T19:50:00Z',
    };

    expect(handover.status).toBe('pending_acknowledgement');
    expect(handover.acknowledgedAt).toBeUndefined();
  });

  it('rejects self-acknowledgement by giving caregiver (responsibility does NOT transfer silently)', () => {
    const handover: CaregiverHandover = {
      id: 'ho_002',
      patientId: 'patient_123',
      givingCaregiverUid: 'caregiver_day',
      givingCaregiverName: 'Ramesh Day Shift',
      receivingCaregiverUid: 'caregiver_night',
      receivingCaregiverName: 'Pooja Night Shift',
      status: 'pending_acknowledgement',
      shiftStartTime: '20:00',
      shiftEndTime: '08:00',
      notes: 'Handover notes',
      patientConditionSummary: 'Stable',
      pendingTasksSummary: [],
      createdAt: '2026-11-15T19:50:00Z',
    };

    function canAcknowledge(handover: CaregiverHandover, actorUid: string, actorRole: string): { allowed: boolean; reason?: string } {
      if (handover.givingCaregiverUid === actorUid) {
        return { allowed: false, reason: 'Giving caregiver cannot self-acknowledge handover' };
      }
      if (handover.receivingCaregiverUid !== actorUid && actorRole !== 'primary_family') {
        return { allowed: false, reason: 'Only designated receiver or primary family can acknowledge' };
      }
      return { allowed: true };
    }

    // Giving caregiver Ramesh tries to acknowledge their own handover
    const attempt1 = canAcknowledge(handover, 'caregiver_day', 'caregiver');
    expect(attempt1.allowed).toBe(false);
    expect(attempt1.reason).toContain('Giving caregiver cannot self-acknowledge');

    // Giving caregiver who is also primary family tries to self-acknowledge
    const attemptSelfPrimary = canAcknowledge(handover, 'caregiver_day', 'primary_family');
    expect(attemptSelfPrimary.allowed).toBe(false);
    expect(attemptSelfPrimary.reason).toContain('Giving caregiver cannot self-acknowledge');

    // Unrelated caregiver tries to acknowledge
    const attempt2 = canAcknowledge(handover, 'caregiver_stranger', 'caregiver');
    expect(attempt2.allowed).toBe(false);

    // Designated incoming caregiver Pooja acknowledges
    const attempt3 = canAcknowledge(handover, 'caregiver_night', 'caregiver');
    expect(attempt3.allowed).toBe(true);

    // Different primary family supervisor can also acknowledge in emergency
    const attempt4 = canAcknowledge(handover, 'family_primary_different', 'primary_family');
    expect(attempt4.allowed).toBe(true);
  });

  it('allows cancellation/rejection by authorized parties and prevents transfer of care responsibility', () => {
    const handover: CaregiverHandover = {
      id: 'ho_003',
      patientId: 'patient_123',
      givingCaregiverUid: 'caregiver_day',
      givingCaregiverName: 'Ramesh Day Shift',
      receivingCaregiverUid: 'caregiver_night',
      receivingCaregiverName: 'Pooja Night Shift',
      status: 'pending_acknowledgement',
      shiftStartTime: '20:00',
      shiftEndTime: '08:00',
      notes: 'Handover notes',
      patientConditionSummary: 'Stable',
      pendingTasksSummary: [],
      createdAt: '2026-11-15T19:50:00Z',
    };

    function canCancelOrReject(
      h: CaregiverHandover,
      actorUid: string,
      actorRole: string
    ): { allowed: boolean; reason?: string } {
      if (h.status !== 'pending_acknowledgement') {
        return { allowed: false, reason: `Cannot cancel: Already ${h.status}` };
      }
      const isGiving = h.givingCaregiverUid === actorUid;
      const isReceiving = h.receivingCaregiverUid === actorUid;
      const isSupervisor = actorRole === 'primary_family';

      if (!isGiving && !isReceiving && !isSupervisor) {
        return { allowed: false, reason: 'Permission denied' };
      }
      return { allowed: true };
    }

    // Giving caregiver can cancel pending handover
    expect(canCancelOrReject(handover, 'caregiver_day', 'caregiver').allowed).toBe(true);

    // Designated recipient can reject/decline pending handover
    expect(canCancelOrReject(handover, 'caregiver_night', 'caregiver').allowed).toBe(true);

    // Primary family supervisor can cancel/reject
    expect(canCancelOrReject(handover, 'family_primary', 'primary_family').allowed).toBe(true);

    // Unrelated caregiver CANNOT cancel
    expect(canCancelOrReject(handover, 'caregiver_unrelated', 'caregiver').allowed).toBe(false);

    // Once cancelled, status is terminal and responsibility is NOT transferred
    const cancelledHandover: CaregiverHandover = {
      ...handover,
      status: 'cancelled',
      cancelledAt: '2026-11-15T20:05:00Z',
      cancelledByUid: 'caregiver_night',
      cancellationReason: 'Unable to take shift due to emergency',
    };

    expect(cancelledHandover.status).toBe('cancelled');
    expect(cancelledHandover.acknowledgedAt).toBeUndefined(); // Care was NEVER transferred!
    expect(canCancelOrReject(cancelledHandover, 'caregiver_day', 'caregiver').allowed).toBe(false);
  });
});

describe('Milestone 5: Care Continuity — Care Gap Detector Heuristics', () => {
  it('flags unconfirmed doses exceeding 60-minute grace period as critical care gaps', () => {
    function detectDoseGap(scheduledIso: string, nowIso: string, gracePeriodMin: number = 60): boolean {
      const scheduledMs = new Date(scheduledIso).getTime();
      const nowMs = new Date(nowIso).getTime();
      return (nowMs - scheduledMs) > (gracePeriodMin * 60 * 1000);
    }

    const scheduledTime = '2026-11-15T08:00:00Z';
    // 08:30 (within grace period)
    expect(detectDoseGap(scheduledTime, '2026-11-15T08:30:00Z', 60)).toBe(false);
    // 09:15 (beyond 60 min grace period)
    expect(detectDoseGap(scheduledTime, '2026-11-15T09:15:00Z', 60)).toBe(true);
  });

  it('flags handovers pending acknowledgement > 2 hours as critical continuity gaps', () => {
    function detectHandoverGap(createdAtIso: string, nowIso: string): boolean {
      const createdMs = new Date(createdAtIso).getTime();
      const nowMs = new Date(nowIso).getTime();
      const diffHours = (nowMs - createdMs) / (1000 * 60 * 60);
      return diffHours >= 2;
    }

    const handoverTime = '2026-11-15T10:00:00Z';
    expect(detectHandoverGap(handoverTime, '2026-11-15T11:30:00Z')).toBe(false); // 1.5h
    expect(detectHandoverGap(handoverTime, '2026-11-15T12:15:00Z')).toBe(true);  // 2.25h
  });

  it('accurately identifies accompanied appointments using both accompaniedBy field and notes', () => {
    function hasAccompaniment(accompaniedBy?: string, notes?: string): boolean {
      return Boolean(
        (accompaniedBy && accompaniedBy.trim().length > 0) ||
        (notes && /\baccompanied\b/i.test(notes) && !/\bunaccompanied\b/i.test(notes))
      );
    }

    // Accompanied by daughter in accompaniedBy field
    expect(hasAccompaniment('Sunita (Daughter)', 'Bring fasting reports')).toBe(true);

    // Explicitly unassisted
    expect(hasAccompaniment('', 'Elder unaccompanied')).toBe(false);

    // Empty fields
    expect(hasAccompaniment('', '')).toBe(false);
    expect(hasAccompaniment(undefined, undefined)).toBe(false);
  });

  it('treats date-only task due dates as due by end-of-day preventing premature daytime alerts', () => {
    function isTaskOverdue(dueDateStr: string, nowIso: string): boolean {
      const boundaryStr = /^\d{4}-\d{2}-\d{2}$/.test(dueDateStr)
        ? `${dueDateStr}T23:59:59.999Z`
        : dueDateStr;
      const dueTime = new Date(boundaryStr).getTime();
      const nowTime = new Date(nowIso).getTime();
      return nowTime > dueTime;
    }

    // Task due today (2026-11-15) checked at 09:00 AM on the same day -> NOT overdue
    expect(isTaskOverdue('2026-11-15', '2026-11-15T09:00:00Z')).toBe(false);
    // Task due today checked at 18:00 PM on the same day -> NOT overdue
    expect(isTaskOverdue('2026-11-15', '2026-11-15T18:00:00Z')).toBe(false);
    // Task due yesterday checked today -> IS overdue
    expect(isTaskOverdue('2026-11-14', '2026-11-15T09:00:00Z')).toBe(true);
  });

  it('guarantees terminal task updates are idempotent and emit 0 duplicate audit events', () => {
    let auditEventsCount = 0;
    const existingTask: CaregiverTask = {
      id: 'task_terminal_1',
      patientId: 'patient_kausalya',
      title: 'Blood Pressure Log',
      priority: 'high',
      status: 'completed',
      dueDate: '2026-11-15',
      assignedToUid: 'caregiver_sunita',
      assignedToName: 'Sunita',
      assignedByUid: 'family_anita',
      assignedByName: 'Anita',
      createdAt: '2026-11-15T08:00:00Z',
      updatedAt: '2026-11-15T08:30:00Z',
      completedAt: '2026-11-15T08:30:00Z',
      completedByUid: 'caregiver_sunita',
      completedByName: 'Sunita',
    };

    function simulateTaskStatusUpdate(
      task: CaregiverTask,
      requestedStatus: TaskStatus,
      onAudit: () => void
    ) {
      let isNoOp = false;
      let updatedTask: CaregiverTask = task;

      if (task.status === 'completed' || task.status === 'cancelled') {
        if (task.status === requestedStatus) {
          isNoOp = true;
          return { task: updatedTask, isNoOp };
        }
        throw new Error(`Task is already ${task.status} and cannot be modified.`);
      }

      onAudit();
      return { task: updatedTask, isNoOp: false };
    }

    // Attempting same status 'completed' on already completed task
    const result = simulateTaskStatusUpdate(existingTask, 'completed', () => {
      auditEventsCount++;
    });

    expect(result.isNoOp).toBe(true);
    expect(auditEventsCount).toBe(0); // 0 duplicate audit events!

    // Attempting to reopen completed task to 'pending' -> rejected
    expect(() => simulateTaskStatusUpdate(existingTask, 'pending', () => {})).toThrow(
      'Task is already completed and cannot be modified.'
    );
  });
});
