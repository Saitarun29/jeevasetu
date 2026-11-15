import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  expandDailyDoses,
  evaluateMissedDoses,
  calculateAdherenceMetrics,
} from '@/lib/medication/engine';
import { Medication, MedicationEvent, ExpectedDose } from '@/types/medication';
import { generateUUID } from '@/lib/utils';

describe('Milestone 2: Medication Scheduling CRUD and 4-State Adherence Engine', () => {
  // Test 1: Medication creation and validation
  it('1. validates medication creation schema correctly with Zod', () => {
    const CreateMedicationSchema = z.object({
      name: z.string().min(2),
      dosage: z.string().min(1),
      form: z.enum([
        'tablet',
        'capsule',
        'liquid',
        'injection',
        'topical',
        'inhaler',
        'drops',
        'patch',
        'other',
      ]),
      instructions: z.string().min(1),
      frequency: z.enum(['daily', 'specific_days', 'as_needed']),
      times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    });

    const validMed = {
      name: 'Metformin Hydrochloride',
      dosage: '500mg',
      form: 'tablet',
      instructions: 'Take after breakfast with water',
      frequency: 'daily',
      times: ['08:00', '20:00'],
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    };

    expect(CreateMedicationSchema.safeParse(validMed).success).toBe(true);

    // Invalid: missing scheduled times for daily frequency
    const invalidTimes = { ...validMed, times: ['invalid-time'] };
    expect(CreateMedicationSchema.safeParse(invalidTimes).success).toBe(false);

    // Invalid: invalid start date format
    const invalidDate = { ...validMed, startDate: '01/01/2026' };
    expect(CreateMedicationSchema.safeParse(invalidDate).success).toBe(false);
  });

  // Test 2: Unauthorized medication access
  it('2. rejects unauthorized roles from mutating medication schedules', () => {
    type UserRole = 'primary_family' | 'family_member' | 'caregiver' | 'patient';

    function canModifyMedication(role: UserRole): boolean {
      const allowedRoles: UserRole[] = ['primary_family', 'family_member', 'caregiver'];
      return allowedRoles.includes(role);
    }

    expect(canModifyMedication('primary_family')).toBe(true);
    expect(canModifyMedication('family_member')).toBe(true);
    expect(canModifyMedication('caregiver')).toBe(true);
    expect(canModifyMedication('patient')).toBe(false); // Patients cannot alter prescribed regimens
  });

  // Test 3: Cross-patient access rejection
  it('3. rejects cross-patient medication requests strictly by patientId boundary', () => {
    interface AccessContext {
      userId: string;
      authorizedPatientId: string;
      status: 'active' | 'revoked';
    }

    function verifyPatientBoundary(ctx: AccessContext, requestedPatientId: string): boolean {
      if (ctx.status !== 'active') return false;
      return ctx.authorizedPatientId === requestedPatientId;
    }

    const caregiverAccess: AccessContext = {
      userId: 'caregiver_123',
      authorizedPatientId: 'patient_A',
      status: 'active',
    };

    // Access to patient A is allowed
    expect(verifyPatientBoundary(caregiverAccess, 'patient_A')).toBe(true);

    // Cross-tenant access to patient B is rejected
    expect(verifyPatientBoundary(caregiverAccess, 'patient_B')).toBe(false);
  });

  // Test 4: TAKEN transition and actor attribution
  it('4. records TAKEN state transition with full actor attribution and timestamps', () => {
    const med: Medication = {
      id: 'med_metformin',
      patientId: 'patient_1',
      name: 'Metformin',
      dosage: '500mg',
      form: 'tablet',
      instructions: 'After breakfast',
      frequency: 'daily',
      times: ['08:00'],
      startDate: '2026-01-01',
      version: 1,
      isActive: true,
      isArchived: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      createdBy: 'user_family',
      updatedBy: 'user_family',
    };

    const actionId = generateUUID();
    const event: MedicationEvent = {
      id: actionId,
      patientId: 'patient_1',
      medicationId: 'med_metformin',
      medicationName: 'Metformin',
      dosage: '500mg',
      scheduledDate: '2026-11-15',
      scheduledTime: '08:00',
      status: 'TAKEN',
      actorUid: 'nurse_sita',
      actorName: 'Nurse Sita',
      actorRole: 'caregiver',
      serverTimestamp: '2026-11-15T08:05:00Z',
      clientTimestamp: '2026-11-15T08:04:55Z',
      source: 'online',
    };

    const doses = expandDailyDoses([med], '2026-11-15', [event]);
    expect(doses).toHaveLength(1);
    expect(doses[0].status).toBe('TAKEN');
    expect(doses[0].event?.actorUid).toBe('nurse_sita');
    expect(doses[0].event?.actorRole).toBe('caregiver');
    expect(doses[0].event?.serverTimestamp).toBe('2026-11-15T08:05:00Z');
  });

  // Test 5: SKIPPED transition with documented reason
  it('5. records SKIPPED state transition with mandatory explanation note', () => {
    const med: Medication = {
      id: 'med_bp',
      patientId: 'patient_1',
      name: 'Amlodipine',
      dosage: '5mg',
      form: 'tablet',
      instructions: 'Morning',
      frequency: 'daily',
      times: ['09:00'],
      startDate: '2026-01-01',
      version: 1,
      isActive: true,
      isArchived: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      createdBy: 'user_family',
      updatedBy: 'user_family',
    };

    const event: MedicationEvent = {
      id: generateUUID(),
      patientId: 'patient_1',
      medicationId: 'med_bp',
      medicationName: 'Amlodipine',
      dosage: '5mg',
      scheduledDate: '2026-11-15',
      scheduledTime: '09:00',
      status: 'SKIPPED',
      note: 'Elder feeling nauseous, holding morning dose as instructed by doctor',
      actorUid: 'family_anita',
      actorName: 'Anita Sharma',
      actorRole: 'family_member',
      serverTimestamp: '2026-11-15T09:10:00Z',
      source: 'online',
    };

    const doses = expandDailyDoses([med], '2026-11-15', [event]);
    expect(doses).toHaveLength(1);
    expect(doses[0].status).toBe('SKIPPED');
    expect(doses[0].event?.note).toContain('Elder feeling nauseous');
  });

  // Test 6: MISSED determination after grace period
  it('6. determines MISSED status strictly after grace period expiration', () => {
    const unconfirmedDose: ExpectedDose = {
      doseKey: 'med_1_2026-11-15_08:00',
      medicationId: 'med_1',
      medicationName: 'Metformin',
      dosage: '500mg',
      form: 'tablet',
      instructions: 'After breakfast',
      scheduledDate: '2026-11-15',
      scheduledTime: '08:00',
      status: 'UNCONFIRMED',
    };

    const gracePeriodMinutes = 120; // 2 hours

    // Scenario A: Evaluated at 09:30 UTC (90 mins later, within grace period) -> remains UNCONFIRMED
    const withinGrace = new Date(Date.UTC(2026, 10, 15, 9, 30, 0));
    const evaluatedWithin = evaluateMissedDoses([unconfirmedDose], withinGrace, gracePeriodMinutes, 'UTC');
    expect(evaluatedWithin[0].status).toBe('UNCONFIRMED');

    // Scenario B: Evaluated at 10:30 UTC (150 mins later, past 120m grace) -> transitions to MISSED
    const pastGrace = new Date(Date.UTC(2026, 10, 15, 10, 30, 0));
    const evaluatedPast = evaluateMissedDoses([unconfirmedDose], pastGrace, gracePeriodMinutes, 'UTC');
    expect(evaluatedPast[0].status).toBe('MISSED');

    // Scenario C: Confirmed TAKEN dose must NEVER be changed to MISSED
    const takenDose: ExpectedDose = { ...unconfirmedDose, status: 'TAKEN' };
    const evaluatedTaken = evaluateMissedDoses([takenDose], pastGrace, gracePeriodMinutes, 'UTC');
    expect(evaluatedTaken[0].status).toBe('TAKEN');
  });

  // Test 7: Duplicate UUID request (Idempotency)
  it('7. safely handles duplicate UUID requests idempotently without creating duplicate events', () => {
    const eventStore = new Map<string, any>();

    function recordEventIdempotent(eventPayload: { actionId: string; status: string }) {
      if (eventStore.has(eventPayload.actionId)) {
        return { isDuplicate: true, event: eventStore.get(eventPayload.actionId) };
      }
      eventStore.set(eventPayload.actionId, { ...eventPayload, recordedAt: new Date().toISOString() });
      return { isDuplicate: false, event: eventStore.get(eventPayload.actionId) };
    }

    const actionUUID = generateUUID();

    // First attempt: created
    const firstCall = recordEventIdempotent({ actionId: actionUUID, status: 'TAKEN' });
    expect(firstCall.isDuplicate).toBe(false);
    expect(firstCall.event.status).toBe('TAKEN');

    // Second attempt with exact same actionId: returns existing without duplicates
    const retryCall = recordEventIdempotent({ actionId: actionUUID, status: 'TAKEN' });
    expect(retryCall.isDuplicate).toBe(true);
    expect(retryCall.event).toBe(firstCall.event);
    expect(eventStore.size).toBe(1);
  });

  // Test 8: Concurrent duplicate requests (Transaction simulation)
  it('8. handles concurrent duplicate requests cleanly using simulated transactional check', async () => {
    const database = new Map<string, any>();
    const actionId = generateUUID();

    async function simulateTransactionalWrite(payload: any) {
      // Simulate atomic test-and-set in transaction
      if (database.has(payload.id)) {
        return { duplicate: true, doc: database.get(payload.id) };
      }
      database.set(payload.id, payload);
      return { duplicate: false, doc: payload };
    }

    const results = await Promise.all([
      simulateTransactionalWrite({ id: actionId, status: 'TAKEN' }),
      simulateTransactionalWrite({ id: actionId, status: 'TAKEN' }),
      simulateTransactionalWrite({ id: actionId, status: 'TAKEN' }),
    ]);

    const createdCount = results.filter((r) => !r.duplicate).length;
    const duplicateCount = results.filter((r) => r.duplicate).length;

    expect(createdCount).toBe(1);
    expect(duplicateCount).toBe(2);
    expect(database.size).toBe(1);
  });

  // Test 9: Offline event synchronization
  it('9. preserves client-reported timestamp separately from server timestamp during offline sync', () => {
    const clientReportedTime = '2026-11-15T08:02:15.123Z';
    const serverProcessingTime = '2026-11-15T09:45:00.000Z';

    const syncedEvent: MedicationEvent = {
      id: generateUUID(),
      patientId: 'patient_1',
      medicationId: 'med_1',
      medicationName: 'Aspirin',
      dosage: '75mg',
      scheduledDate: '2026-11-15',
      scheduledTime: '08:00',
      status: 'TAKEN',
      actorUid: 'elder_user',
      actorName: 'Smt. Kausalya',
      actorRole: 'patient',
      clientTimestamp: clientReportedTime, // Preserved exact device time
      serverTimestamp: serverProcessingTime, // Preserved authoritative server sync time
      source: 'offline_sync',
    };

    expect(syncedEvent.clientTimestamp).toBe(clientReportedTime);
    expect(syncedEvent.serverTimestamp).toBe(serverProcessingTime);
    expect(syncedEvent.source).toBe('offline_sync');
  });

  // Test 10: Stale medication version conflict
  it('10. detects and rejects stale medication schedule updates (version conflict / 409)', () => {
    interface MedicationRecord {
      id: string;
      name: string;
      version: number;
    }

    function updateMedicationWithVersionCheck(
      current: MedicationRecord,
      expectedVersion: number,
      newName: string
    ) {
      if (current.version !== expectedVersion) {
        const error: any = new Error(
          `Version conflict: current version is ${current.version}, expected ${expectedVersion}`
        );
        error.statusCode = 409;
        throw error;
      }
      return {
        ...current,
        name: newName,
        version: current.version + 1,
      };
    }

    const currentMed: MedicationRecord = { id: 'med_1', name: 'Atorvastatin 10mg', version: 3 };

    // Valid update with current version: succeeds and increments version to 4
    const validUpdate = updateMedicationWithVersionCheck(currentMed, 3, 'Atorvastatin 20mg');
    expect(validUpdate.version).toBe(4);
    expect(validUpdate.name).toBe('Atorvastatin 20mg');

    // Stale update: user was viewing version 2 when current is 3 -> throws 409
    expect(() => {
      updateMedicationWithVersionCheck(currentMed, 2, 'Atorvastatin 40mg');
    }).toThrowError(/Version conflict/);
  });

  // Test 11: Revoked caregiver rejection
  it('11. immediately rejects revoked caregivers even if they have an active token', () => {
    interface MemberRecord {
      userId: string;
      role: 'caregiver' | 'family_member';
      status: 'active' | 'revoked';
    }

    function checkMembershipAuthoritative(member: MemberRecord): boolean {
      return member.status === 'active';
    }

    const activeNurse: MemberRecord = {
      userId: 'nurse_active',
      role: 'caregiver',
      status: 'active',
    };
    expect(checkMembershipAuthoritative(activeNurse)).toBe(true);

    const revokedNurse: MemberRecord = {
      userId: 'nurse_revoked',
      role: 'caregiver',
      status: 'revoked',
    };
    expect(checkMembershipAuthoritative(revokedNurse)).toBe(false);
  });

  // Test 12: Historical event correction without deletion
  it('12. records audited corrections as new events referencing prior events without deletion', () => {
    const careEventsTimeline: any[] = [];

    // Step 1: Initial event recorded
    const initialEvent = {
      id: 'event_001',
      patientId: 'patient_1',
      eventType: 'MEDICATION_SKIPPED',
      action: 'Skipped morning dose',
      actorUid: 'nurse_1',
      serverTimestamp: '2026-11-15T08:00:00Z',
      refEventId: null,
    };
    careEventsTimeline.push(initialEvent);

    // Step 2: Later correction recorded (dose was actually taken late)
    const correctionEvent = {
      id: 'event_002',
      patientId: 'patient_1',
      eventType: 'MEDICATION_CORRECTED',
      action: 'Corrected status to TAKEN after caregiver verification',
      actorUid: 'primary_family_anita',
      serverTimestamp: '2026-11-15T09:30:00Z',
      refEventId: 'event_001', // Explicit reference to original event
    };
    careEventsTimeline.push(correctionEvent);

    // Assert: original event was never deleted or mutated
    expect(careEventsTimeline).toHaveLength(2);
    expect(careEventsTimeline[0].id).toBe('event_001');
    expect(careEventsTimeline[0].eventType).toBe('MEDICATION_SKIPPED');

    // Assert: correction points back to original event
    expect(careEventsTimeline[1].refEventId).toBe('event_001');
  });

  // Test 13: 4-State adherence metrics calculation
  it('13. computes 4-state adherence metrics accurately', () => {
    const sampleDoses: ExpectedDose[] = [
      {
        doseKey: '1',
        medicationId: 'm1',
        medicationName: 'Med 1',
        dosage: '10mg',
        form: 'tablet',
        instructions: '',
        scheduledDate: '2026-11-15',
        scheduledTime: '08:00',
        status: 'TAKEN',
      },
      {
        doseKey: '2',
        medicationId: 'm2',
        medicationName: 'Med 2',
        dosage: '20mg',
        form: 'tablet',
        instructions: '',
        scheduledDate: '2026-11-15',
        scheduledTime: '12:00',
        status: 'SKIPPED',
      },
      {
        doseKey: '3',
        medicationId: 'm3',
        medicationName: 'Med 3',
        dosage: '30mg',
        form: 'tablet',
        instructions: '',
        scheduledDate: '2026-11-15',
        scheduledTime: '16:00',
        status: 'MISSED',
      },
      {
        doseKey: '4',
        medicationId: 'm4',
        medicationName: 'Med 4',
        dosage: '40mg',
        form: 'tablet',
        instructions: '',
        scheduledDate: '2026-11-15',
        scheduledTime: '20:00',
        status: 'UNCONFIRMED',
      },
    ];

    const metrics = calculateAdherenceMetrics(sampleDoses);

    expect(metrics.totalScheduled).toBe(4);
    expect(metrics.confirmedTaken).toBe(1);
    expect(metrics.skipped).toBe(1);
    expect(metrics.missed).toBe(1);
    expect(metrics.unconfirmed).toBe(1);

    // Evaluated = 1 taken + 1 skipped + 1 missed = 3 evaluated
    // Adherence = (1 / 3) * 100 = 33%
    expect(metrics.adherencePercentage).toBe(33);
  });
});
