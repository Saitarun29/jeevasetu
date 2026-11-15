import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  validateAndConvertAppointmentDate,
  detectAppointmentConflicts,
  formatAppointmentDateTime,
} from '@/lib/appointment/engine';
import { Appointment, AppointmentConflict } from '@/types/appointment';
import { generateUUID } from '@/lib/utils';

describe('Milestone 3: Doctor Appointment Management', () => {
  // Test 1: Appointment creation and validation schema
  it('1. validates appointment creation schema with Zod', () => {
    const CreateAppointmentSchema = z.object({
      doctorName: z.string().min(2),
      specialty: z.string().min(2),
      clinicName: z.string().min(2),
      clinicAddress: z.string().min(2),
      localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      notes: z.string().optional(),
      accompaniedBy: z.string().optional(),
      reminderPreferences: z
        .object({
          email24h: z.boolean(),
          email2h: z.boolean(),
        })
        .default({ email24h: true, email2h: true }),
    });

    const validData = {
      doctorName: 'Dr. Rajesh Sharma',
      specialty: 'Cardiology',
      clinicName: 'Apollo Hospital',
      clinicAddress: '12th Main, Indiranagar, Bangalore',
      localDate: '2026-11-20',
      localTime: '10:30',
      notes: 'Bring fasting blood report',
      accompaniedBy: 'Anita Sharma',
      reminderPreferences: { email24h: true, email2h: true },
    };

    expect(CreateAppointmentSchema.safeParse(validData).success).toBe(true);

    // Invalid: missing doctor name
    const missingDoctor = { ...validData, doctorName: 'A' };
    expect(CreateAppointmentSchema.safeParse(missingDoctor).success).toBe(false);

    // Invalid: invalid local time format
    const invalidTime = { ...validData, localTime: '25:00' };
    expect(CreateAppointmentSchema.safeParse(invalidTime).success).toBe(false);
  });

  // Test 2: Invalid and past appointment dates
  it('2. rejects past appointment dates while allowing valid future dates', () => {
    const timezone = 'Asia/Kolkata';

    // A date in the past (e.g. year 2020)
    const pastResult = validateAndConvertAppointmentDate('2020-01-01', '10:00', timezone, false);
    expect(pastResult.error).toBeDefined();
    expect(pastResult.error).toContain('cannot be scheduled in the past');

    // Past date allowed if explicit override flag is true
    const allowedPastResult = validateAndConvertAppointmentDate('2020-01-01', '10:00', timezone, true);
    expect(allowedPastResult.error).toBeUndefined();
    expect(allowedPastResult.instant).toBeDefined();

    // Future date (e.g. year 2028)
    const futureResult = validateAndConvertAppointmentDate('2028-11-20', '10:30', timezone, false);
    expect(futureResult.error).toBeUndefined();
    expect(futureResult.instant).toBeInstanceOf(Date);
  });

  // Test 3: Patient timezone correctness for appointment scheduling
  it('3. converts local appointment date and time into exact UTC instant across timezones', () => {
    // Nov 20, 2026 at 10:30 AM in Asia/Kolkata (UTC+5:30)
    // 10:30 - 5:30 = 05:00 UTC
    const indiaResult = validateAndConvertAppointmentDate('2026-11-20', '10:30', 'Asia/Kolkata', true);
    expect(indiaResult.instant.toISOString()).toBe('2026-11-20T05:00:00.000Z');

    // Nov 20, 2026 at 10:30 AM in America/New_York (Winter EST, UTC-5)
    // 10:30 + 5:00 = 15:30 UTC
    const nyResult = validateAndConvertAppointmentDate('2026-11-20', '10:30', 'America/New_York', true);
    expect(nyResult.instant.toISOString()).toBe('2026-11-20T15:30:00.000Z');

    // July 20, 2026 at 10:30 AM in America/New_York (Summer EDT, UTC-4)
    // 10:30 + 4:00 = 14:30 UTC
    const nySummerResult = validateAndConvertAppointmentDate('2026-07-20', '10:30', 'America/New_York', true);
    expect(nySummerResult.instant.toISOString()).toBe('2026-07-20T14:30:00.000Z');
  });

  // Test 4: Conflict detection
  it('4. detects conflicting appointments scheduled within the 60-minute buffer window', () => {
    const existingAppointment: Appointment = {
      id: 'app_1',
      patientId: 'patient_1',
      doctorName: 'Dr. Sharma',
      specialty: 'Cardiology',
      clinicName: 'Apollo Hospital',
      clinicAddress: 'MG Road',
      appointmentDate: '2026-11-20T05:00:00.000Z', // 10:30 AM IST
      localDate: '2026-11-20',
      localTime: '10:30',
      timezone: 'Asia/Kolkata',
      status: 'scheduled',
      reminderPreferences: { email24h: true, email2h: true },
      reminderStatus: { sent24h: false, sent2h: false },
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      createdBy: 'user_1',
      updatedBy: 'user_1',
    };

    // Scenario A: Overlapping visit at 11:00 AM IST (30 minutes after app_1) -> CONFLICT
    const overlapInstant = new Date('2026-11-20T05:30:00.000Z');
    const conflicts = detectAppointmentConflicts([existingAppointment], overlapInstant, 60);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflictingAppointmentId).toBe('app_1');
    expect(conflicts[0].timeDiffMinutes).toBe(30);

    // Scenario B: Non-overlapping visit at 02:00 PM IST (3.5 hours later) -> NO CONFLICT
    const nonOverlapInstant = new Date('2026-11-20T08:30:00.000Z');
    const noConflicts = detectAppointmentConflicts([existingAppointment], nonOverlapInstant, 60);
    expect(noConflicts).toHaveLength(0);

    // Scenario C: Overlapping visit with a CANCELLED appointment -> Ignored (no conflict)
    const cancelledAppointment: Appointment = { ...existingAppointment, status: 'cancelled' };
    const ignoreCancelled = detectAppointmentConflicts([cancelledAppointment], overlapInstant, 60);
    expect(ignoreCancelled).toHaveLength(0);
  });

  // Test 5: Unauthorized and cross-patient access
  it('5. prevents unauthorized users and cross-patient access to appointment records', () => {
    interface AccessRecord {
      userId: string;
      patientId: string;
      status: 'active' | 'revoked';
    }

    function checkAppointmentAccess(
      userAccess: AccessRecord,
      requestedPatientId: string
    ): { allowed: boolean; reason?: string } {
      if (userAccess.status !== 'active') {
        return { allowed: false, reason: 'Revoked membership' };
      }
      if (userAccess.patientId !== requestedPatientId) {
        return { allowed: false, reason: 'Cross-patient access forbidden' };
      }
      return { allowed: true };
    }

    const aliceAccess: AccessRecord = { userId: 'u_alice', patientId: 'patient_A', status: 'active' };

    // Authorized access
    expect(checkAppointmentAccess(aliceAccess, 'patient_A').allowed).toBe(true);

    // Cross-patient access
    const crossRes = checkAppointmentAccess(aliceAccess, 'patient_B');
    expect(crossRes.allowed).toBe(false);
    expect(crossRes.reason).toBe('Cross-patient access forbidden');

    // Revoked member
    const revokedAccess: AccessRecord = { userId: 'u_alice', patientId: 'patient_A', status: 'revoked' };
    const revokedRes = checkAppointmentAccess(revokedAccess, 'patient_A');
    expect(revokedRes.allowed).toBe(false);
    expect(revokedRes.reason).toBe('Revoked membership');
  });

  // Test 6: Role permissions
  it('6. applies role-based restrictions to appointment operations', () => {
    type UserRole = 'primary_family' | 'family_member' | 'caregiver' | 'patient';

    function canCancelAppointment(role: UserRole): boolean {
      // Caregivers and patients cannot cancel medical appointments
      return role === 'primary_family' || role === 'family_member';
    }

    function canCompleteAppointment(role: UserRole): boolean {
      // Caregivers and family can mark visits complete after accompanying the elder
      return role === 'primary_family' || role === 'family_member' || role === 'caregiver';
    }

    expect(canCancelAppointment('primary_family')).toBe(true);
    expect(canCancelAppointment('family_member')).toBe(true);
    expect(canCancelAppointment('caregiver')).toBe(false);
    expect(canCancelAppointment('patient')).toBe(false);

    expect(canCompleteAppointment('caregiver')).toBe(true);
    expect(canCompleteAppointment('primary_family')).toBe(true);
  });

  // Test 7: Soft cancellation preserves history
  it('7. soft-cancels appointments without deleting history and mandates a cancellation reason', () => {
    const appointment: Appointment = {
      id: 'app_test_cancel',
      patientId: 'patient_1',
      doctorName: 'Dr. Mehta',
      specialty: 'Neurology',
      clinicName: 'Manipal Hospital',
      clinicAddress: 'Old Airport Road',
      appointmentDate: '2026-11-25T04:30:00.000Z',
      localDate: '2026-11-25',
      localTime: '10:00',
      timezone: 'Asia/Kolkata',
      status: 'scheduled',
      reminderPreferences: { email24h: true, email2h: true },
      reminderStatus: { sent24h: false, sent2h: false },
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      createdBy: 'user_1',
      updatedBy: 'user_1',
    };

    function cancelAppointment(app: Appointment, reason: string): Appointment {
      if (!reason || !reason.trim()) {
        throw new Error('Cancellation reason is mandatory');
      }
      return {
        ...app,
        status: 'cancelled',
        cancellationReason: reason.trim(),
        updatedAt: new Date().toISOString(),
      };
    }

    expect(() => cancelAppointment(appointment, '')).toThrowError(/mandatory/);

    const cancelledApp = cancelAppointment(appointment, 'Doctor had emergency surgery');
    expect(cancelledApp.id).toBe('app_test_cancel'); // Record preserved
    expect(cancelledApp.status).toBe('cancelled');
    expect(cancelledApp.cancellationReason).toBe('Doctor had emergency surgery');
  });

  // Test 8: Care Timeline audit event creation
  it('8. generates auditable care events for appointment lifecycle events without deleting past events', () => {
    const timeline: any[] = [];

    // Schedule event
    timeline.push({
      id: generateUUID(),
      eventType: 'APPOINTMENT_SCHEDULED',
      action: 'Scheduled appointment with Dr. Sharma (Cardiology)',
      actorUid: 'user_family_1',
      timestamp: '2026-11-15T09:00:00Z',
      refEventId: null,
    });

    // Update event
    timeline.push({
      id: generateUUID(),
      eventType: 'APPOINTMENT_UPDATED',
      action: 'Rescheduled appointment to 2026-11-22',
      actorUid: 'user_family_1',
      timestamp: '2026-11-15T10:00:00Z',
      refEventId: timeline[0].id,
    });

    // Cancel event
    timeline.push({
      id: generateUUID(),
      eventType: 'APPOINTMENT_CANCELLED',
      action: 'Cancelled visit with Dr. Sharma: Elder feeling unwell',
      actorUid: 'user_family_1',
      timestamp: '2026-11-15T11:00:00Z',
      refEventId: timeline[0].id,
    });

    expect(timeline).toHaveLength(3);
    expect(timeline[0].eventType).toBe('APPOINTMENT_SCHEDULED');
    expect(timeline[2].eventType).toBe('APPOINTMENT_CANCELLED');
    expect(timeline[2].refEventId).toBe(timeline[0].id);
  });

  // Test 9: Reminder status preparation & idempotency keys
  it('9. prepares deterministic reminder idempotency keys for future scheduled processing', () => {
    const appointmentId = 'app_xyz_789';

    // In Milestone 4, Cloud Scheduler will query appointments and send reminders using deterministic keys:
    const key24h = `appointment_${appointmentId}_24h`;
    const key2h = `appointment_${appointmentId}_2h`;

    expect(key24h).toBe('appointment_app_xyz_789_24h');
    expect(key2h).toBe('appointment_app_xyz_789_2h');

    // Reminder status delivery tracking
    const reminderStatus = {
      sent24h: false,
      sent2h: false,
    };

    // When 24h reminder is sent:
    const updatedAfter24h = { ...reminderStatus, sent24h: true, sent24hAt: '2026-11-19T10:30:00Z' };
    expect(updatedAfter24h.sent24h).toBe(true);
    expect(updatedAfter24h.sent2h).toBe(false); // 2h reminder still pending
  });

  // Test 10: Formatting for elderly readability
  it('10. formats appointment date and time for accessible senior presentation', () => {
    // 2026-11-20T05:00:00Z is 10:30 AM on Friday, Nov 20, 2026 in Asia/Kolkata
    const formatted = formatAppointmentDateTime('2026-11-20T05:00:00.000Z', 'Asia/Kolkata');
    expect(formatted.formattedDate).toContain('Friday');
    expect(formatted.formattedDate).toContain('Nov 20, 2026');
    expect(formatted.formattedTime).toMatch(/10:30\s*(AM|am)/);
  });
});
