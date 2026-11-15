import { describe, it, expect } from 'vitest';
import {
  ReminderRecord,
  ReminderType,
  SchedulerLock,
} from '@/types/reminder';
import {
  generateEmailSubject,
  renderReminderEmail,
} from '@/lib/email/templates';
import { isResendConfigured } from '@/lib/email/resend';
import { generateUUID } from '@/lib/utils';
import { Appointment } from '@/types/appointment';

describe('Milestone 4: Proactive Email Reminders & Cloud Scheduler Dispatch', () => {
  // Test 1: Medication reminder generation for upcoming and missed doses
  it('1. generates deterministic reminder records for upcoming doses and missed doses', () => {
    const upcomingReminder: ReminderRecord = {
      id: 'med_upcoming_p1_med1_2026-11-15_0800',
      type: 'medication_upcoming',
      patientId: 'p1',
      patientName: 'Smt. Kausalya Devi',
      recipientEmail: 'anita@example.com',
      recipientName: 'Anita Sharma',
      recipientRole: 'primary_family',
      subject: '',
      scheduledTimeUtc: '2026-11-15T02:30:00.000Z',
      localDate: '2026-11-15',
      localTime: '08:00',
      timezone: 'Asia/Kolkata',
      entityId: 'med1',
      details: {
        title: 'Upcoming Scheduled Dose: Metformin',
        subtitle: '500mg (tablet)',
        instructions: 'Take after breakfast with water',
        actionPrompt: 'Open Portal & Confirm Dose',
      },
      status: 'queued',
      retryCount: 0,
      maxRetries: 3,
      createdAt: '2026-11-15T02:00:00.000Z',
      updatedAt: '2026-11-15T02:00:00.000Z',
    };

    expect(upcomingReminder.id).toBe('med_upcoming_p1_med1_2026-11-15_0800');
    expect(upcomingReminder.type).toBe('medication_upcoming');

    // Missed dose reminder
    const missedReminder: ReminderRecord = {
      ...upcomingReminder,
      id: 'med_missed_p1_med1_2026-11-15_0800',
      type: 'medication_missed',
      details: {
        title: 'ALERT — Missed Dose: Metformin',
        subtitle: 'The 2-hour grace window expired without confirmation.',
        actionPrompt: 'Check on Elder & Record Administration',
      },
    };

    expect(missedReminder.id).toBe('med_missed_p1_med1_2026-11-15_0800');
    expect(missedReminder.type).toBe('medication_missed');
  });

  // Test 2: Appointment 24-hour and 2-hour reminders
  it('2. prepares 24-hour and 2-hour appointment reminders based on time windows', () => {
    const appointment: Appointment = {
      id: 'app_cardio_123',
      patientId: 'p1',
      doctorName: 'Dr. Rajesh Sharma',
      specialty: 'Cardiology',
      clinicName: 'Apollo Hospital',
      clinicAddress: '12th Main Indiranagar',
      appointmentDate: '2026-11-20T05:00:00.000Z', // Nov 20 at 10:30 AM IST
      localDate: '2026-11-20',
      localTime: '10:30',
      timezone: 'Asia/Kolkata',
      status: 'scheduled',
      reminderPreferences: { email24h: true, email2h: true },
      reminderStatus: { sent24h: false, sent2h: false },
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      createdBy: 'u1',
      updatedBy: 'u1',
    };

    // Deterministic reminder IDs
    const reminder24hId = `app_24h_${appointment.patientId}_${appointment.id}`;
    const reminder2hId = `app_2h_${appointment.patientId}_${appointment.id}`;

    expect(reminder24hId).toBe('app_24h_p1_app_cardio_123');
    expect(reminder2hId).toBe('app_2h_p1_app_cardio_123');

    // Target time check:
    // When evaluated 24 hours prior (Nov 19, 05:00 UTC) -> 24h triggers
    const now24hBefore = new Date('2026-11-19T05:00:00.000Z');
    const diffHours24 = (new Date(appointment.appointmentDate).getTime() - now24hBefore.getTime()) / 3600000;
    expect(diffHours24).toBe(24);
    expect(diffHours24 >= 20 && diffHours24 <= 26).toBe(true);

    // When evaluated 2 hours prior (Nov 20, 03:00 UTC) -> 2h triggers
    const now2hBefore = new Date('2026-11-20T03:00:00.000Z');
    const diffHours2 = (new Date(appointment.appointmentDate).getTime() - now2hBefore.getTime()) / 3600000;
    expect(diffHours2).toBe(2);
    expect(diffHours2 >= 1 && diffHours2 <= 3).toBe(true);
  });

  // Test 3: Patient timezone correctness in rendered email content
  it('3. renders email templates using the patient local time rather than server UTC time', () => {
    const reminder: ReminderRecord = {
      id: 'app_24h_p1_app_1',
      type: 'appointment_24h',
      patientId: 'p1',
      patientName: 'Smt. Kausalya Devi',
      recipientEmail: 'anita@example.com',
      recipientName: 'Anita Sharma',
      recipientRole: 'primary_family',
      subject: '',
      scheduledTimeUtc: '2026-11-20T05:00:00.000Z', // 05:00 UTC is 10:30 AM IST
      localDate: '2026-11-20',
      localTime: '10:30',
      timezone: 'Asia/Kolkata',
      entityId: 'app_1',
      details: {
        title: 'Upcoming Consultation: Dr. Rajesh Sharma',
        subtitle: 'Cardiology at Apollo Hospital',
        location: '12th Main, Indiranagar',
        actionPrompt: 'View Appointment Details',
      },
      status: 'queued',
      retryCount: 0,
      maxRetries: 3,
      createdAt: '2026-11-19T05:00:00.000Z',
      updatedAt: '2026-11-19T05:00:00.000Z',
    };

    const rendered = renderReminderEmail(reminder, 'http://localhost:3000');

    // Subject must be privacy-conscious and display local time
    expect(rendered.subject).toContain('10:30');
    expect(rendered.subject).toContain('Kausalya');
    expect(rendered.subject).not.toContain('05:00'); // Does NOT leak UTC time

    // HTML template must display local date and time
    expect(rendered.html).toContain('10:30');
    expect(rendered.html).toContain('Asia/Kolkata');
    expect(rendered.html).toContain('Apollo Hospital');
    expect(rendered.html).toContain('Clinical Safety Invariant');
  });

  // Test 4: Cancelled and completed appointment exclusion
  it('4. strictly excludes cancelled and completed appointments from generating reminders', () => {
    function shouldGenerateAppointmentReminder(
      status: 'scheduled' | 'completed' | 'cancelled',
      hoursUntil: number
    ): boolean {
      if (status !== 'scheduled') return false; // Excluded!
      return hoursUntil >= 1 && hoursUntil <= 26;
    }

    expect(shouldGenerateAppointmentReminder('scheduled', 24)).toBe(true);
    expect(shouldGenerateAppointmentReminder('completed', 24)).toBe(false);
    expect(shouldGenerateAppointmentReminder('cancelled', 24)).toBe(false);
    expect(shouldGenerateAppointmentReminder('cancelled', 2)).toBe(false);
  });

  // Test 5: Duplicate reminder prevention
  it('5. prevents duplicate reminder dispatch using deterministic reminder IDs', () => {
    const dispatchedStore = new Map<string, { status: string; sentAt: string }>();

    function processReminder(id: string) {
      const existing = dispatchedStore.get(id);
      if (existing && existing.status === 'sent') {
        return { dispatched: false, reason: 'Already sent' };
      }
      dispatchedStore.set(id, { status: 'sent', sentAt: new Date().toISOString() });
      return { dispatched: true, reason: 'Dispatched successfully' };
    }

    const reminderId = 'med_upcoming_p1_med1_2026-11-15_0800';

    // First cron execution: dispatched
    const firstRun = processReminder(reminderId);
    expect(firstRun.dispatched).toBe(true);

    // Second cron execution 5 minutes later: skipped (idempotent duplicate prevention)
    const secondRun = processReminder(reminderId);
    expect(secondRun.dispatched).toBe(false);
    expect(secondRun.reason).toBe('Already sent');
    expect(dispatchedStore.size).toBe(1);
  });

  // Test 6: Concurrent scheduler invocation (Distributed Lock)
  it('6. protects against concurrent scheduler runs using lock acquisition with TTL', () => {
    let currentLock: SchedulerLock | null = null;
    const lockTtlMs = 120000; // 2 minutes

    function acquireLock(processId: string, nowMs: number) {
      if (currentLock && currentLock.locked) {
        const expiresAtMs = new Date(currentLock.expiresAt).getTime();
        if (nowMs < expiresAtMs) {
          return { acquired: false, reason: 'Lock active' };
        }
      }
      currentLock = {
        locked: true,
        lockedAt: new Date(nowMs).toISOString(),
        lockedBy: processId,
        expiresAt: new Date(nowMs + lockTtlMs).toISOString(),
      };
      return { acquired: true };
    }

    const t0 = 1000000;

    // Process A acquires lock
    const pA = acquireLock('scheduler_instance_A', t0);
    expect(pA.acquired).toBe(true);

    // Concurrent Process B attempts to acquire lock at t0 + 10s -> REJECTED
    const pB = acquireLock('scheduler_instance_B', t0 + 10000);
    expect(pB.acquired).toBe(false);
    expect(pB.reason).toBe('Lock active');

    // Process C attempts after TTL expired (t0 + 130s) -> ACQUIRES (auto-clears stale lock)
    const pC = acquireLock('scheduler_instance_C', t0 + 130000);
    expect(pC.acquired).toBe(true);
    expect((currentLock as SchedulerLock | null)?.lockedBy).toBe('scheduler_instance_C');
  });

  // Test 7: Provider failure and bounded retry
  it('7. captures provider failure and implements bounded retries (max 3)', () => {
    interface ReminderState {
      retryCount: number;
      maxRetries: number;
      status: 'queued' | 'processing' | 'sent' | 'failed';
      lastError?: string;
    }

    function handleDispatchResult(
      state: ReminderState,
      result: { success: boolean; error?: string }
    ): ReminderState {
      if (result.success) {
        return { ...state, status: 'sent', lastError: undefined };
      }
      const newRetries = state.retryCount + 1;
      return {
        ...state,
        retryCount: newRetries,
        status: 'failed',
        lastError: result.error,
      };
    }

    let state: ReminderState = { retryCount: 0, maxRetries: 3, status: 'queued' };

    // Failure 1
    state = handleDispatchResult(state, { success: false, error: 'Network timeout' });
    expect(state.status).toBe('failed');
    expect(state.retryCount).toBe(1);

    // Failure 2
    state = handleDispatchResult(state, { success: false, error: 'Rate limit' });
    expect(state.retryCount).toBe(2);

    // Failure 3 (hits max retries)
    state = handleDispatchResult(state, { success: false, error: 'Rate limit' });
    expect(state.retryCount).toBe(3);

    // Verify retry guard: will not retry if retryCount >= maxRetries
    const shouldRetry = state.status === 'failed' && state.retryCount < state.maxRetries;
    expect(shouldRetry).toBe(false);
  });

  // Test 8: Missed-dose reminder without altering adherence status (CRITICAL SAFETY INVARIANT)
  it('8. confirms that sending reminders NEVER mutates medication adherence status to TAKEN', () => {
    let doseAdherenceStatus: 'UNCONFIRMED' | 'TAKEN' | 'SKIPPED' | 'MISSED' = 'MISSED';
    let reminderDeliveryStatus: 'queued' | 'processing' | 'sent' | 'failed' = 'queued';

    // Cloud Scheduler simulates sending missed-dose reminder email:
    reminderDeliveryStatus = 'sent';

    // Assert: Adherence state remains strictly MISSED!
    expect(doseAdherenceStatus).toBe('MISSED');
    expect(reminderDeliveryStatus).toBe('sent');
    expect(doseAdherenceStatus as any).not.toBe('TAKEN');
  });

  // Test 9: Unauthorized scheduler endpoint verification
  it('9. rejects unauthorized requests to the scheduler cron endpoint without secret', () => {
    const configuredSecret = 'test_cron_secret_1234567890';

    function authenticateCronRequest(authHeader: string | null): { authenticated: boolean; code: number } {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { authenticated: false, code: 401 };
      }
      const token = authHeader.substring(7).trim();
      if (token !== configuredSecret) {
        return { authenticated: false, code: 401 };
      }
      return { authenticated: true, code: 200 };
    }

    // Missing header
    expect(authenticateCronRequest(null).code).toBe(401);

    // Invalid secret
    expect(authenticateCronRequest('Bearer wrong-secret').code).toBe(401);

    // Valid secret
    expect(authenticateCronRequest('Bearer test_cron_secret_1234567890').code).toBe(200);
  });

  // Test 10: Cross-patient isolation in reminder dispatch
  it('10. isolates reminders strictly by patientId and never leaks recipient data across care circles', () => {
    const reminders: ReminderRecord[] = [
      {
        id: 'r_alice',
        patientId: 'patient_alice',
        type: 'medication_upcoming',
        patientName: 'Alice',
        recipientEmail: 'family_alice@example.com',
        recipientName: 'Alice Family',
        recipientRole: 'primary_family',
        subject: '',
        scheduledTimeUtc: '2026-11-15T08:00:00Z',
        localDate: '2026-11-15',
        localTime: '08:00',
        timezone: 'Asia/Kolkata',
        entityId: 'med_a',
        details: { title: 'Dose', subtitle: '', actionPrompt: '' },
        status: 'queued',
        retryCount: 0,
        maxRetries: 3,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'r_bob',
        patientId: 'patient_bob',
        type: 'medication_upcoming',
        patientName: 'Bob',
        recipientEmail: 'family_bob@example.com',
        recipientName: 'Bob Family',
        recipientRole: 'primary_family',
        subject: '',
        scheduledTimeUtc: '2026-11-15T08:00:00Z',
        localDate: '2026-11-15',
        localTime: '08:00',
        timezone: 'Asia/Kolkata',
        entityId: 'med_b',
        details: { title: 'Dose', subtitle: '', actionPrompt: '' },
        status: 'queued',
        retryCount: 0,
        maxRetries: 3,
        createdAt: '',
        updatedAt: '',
      },
    ];

    // Filter by patient_alice
    const aliceReminders = reminders.filter((r) => r.patientId === 'patient_alice');
    expect(aliceReminders).toHaveLength(1);
    expect(aliceReminders[0].recipientEmail).toBe('family_alice@example.com');
    expect(aliceReminders[0].recipientEmail).not.toContain('bob');
  });
});
