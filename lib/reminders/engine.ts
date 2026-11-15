import { adminFirestore } from '@/lib/firebase/admin';
import {
  ReminderRecord,
  ReminderType,
  SchedulerLock,
  SchedulerExecutionLog,
} from '@/types/reminder';
import {
  expandDailyDoses,
  evaluateMissedDoses,
  getPatientLocalDate,
  getDoseScheduledInstant,
} from '@/lib/medication/engine';
import { Appointment } from '@/types/appointment';
import { Medication, MedicationEvent } from '@/types/medication';
import { sendReminderEmail } from '@/lib/email/resend';
import * as admin from 'firebase-admin';

const LOCK_COLLECTION = 'system_health';
const LOCK_DOC = 'scheduler_lock';
const LOCK_TTL_MS = 2 * 60 * 1000; // 2 minutes lock expiration

/**
 * Acquires a distributed lock in Firestore to protect against overlapping scheduled runs.
 */
export async function acquireSchedulerLock(
  lockHolderId: string
): Promise<{ acquired: boolean; reason?: string }> {
  const db = adminFirestore();
  const lockRef = db.collection(LOCK_COLLECTION).doc(LOCK_DOC);

  try {
    return await db.runTransaction(async (transaction) => {
      const lockDoc = await transaction.get(lockRef);
      const now = Date.now();

      if (lockDoc.exists) {
        const data = lockDoc.data() as SchedulerLock;
        const expiresAtMs = new Date(data.expiresAt).getTime();

        // If lock is held and has not expired, reject acquisition
        if (data.locked && now < expiresAtMs) {
          return {
            acquired: false,
            reason: `Scheduler run currently active by ${data.lockedBy}. Lock expires in ${Math.round(
              (expiresAtMs - now) / 1000
            )}s.`,
          };
        }
      }

      // Lock is free or expired: acquire lock
      const newLock: SchedulerLock = {
        locked: true,
        lockedAt: new Date(now).toISOString(),
        lockedBy: lockHolderId,
        expiresAt: new Date(now + LOCK_TTL_MS).toISOString(),
      };

      transaction.set(lockRef, newLock);
      return { acquired: true };
    });
  } catch (err: any) {
    return { acquired: false, reason: err.message || 'Failed lock acquisition' };
  }
}

/**
 * Releases the distributed lock.
 */
export async function releaseSchedulerLock(lockHolderId: string): Promise<void> {
  const db = adminFirestore();
  const lockRef = db.collection(LOCK_COLLECTION).doc(LOCK_DOC);

  try {
    await db.runTransaction(async (transaction) => {
      const lockDoc = await transaction.get(lockRef);
      if (lockDoc.exists) {
        const data = lockDoc.data() as SchedulerLock;
        if (data.lockedBy === lockHolderId) {
          transaction.update(lockRef, { locked: false });
        }
      }
    });
  } catch (err) {
    console.warn('Error releasing lock:', err);
  }
}

/**
 * Discovers pending medication reminders for a patient.
 * Reminders NEVER change the medication adherence status to TAKEN.
 */
export async function discoverPatientMedicationReminders(
  patientId: string,
  patientName: string,
  patientTimezone: string,
  now: Date,
  recipient: { email: string; name: string; role: string }
): Promise<ReminderRecord[]> {
  const db = adminFirestore();
  const patientLocalDate = getPatientLocalDate(now, patientTimezone);

  // 1. Fetch active medications
  const medsSnap = await db
    .collection('patients')
    .doc(patientId)
    .collection('medications')
    .where('isArchived', '==', false)
    .where('isActive', '==', true)
    .get();

  const medications: Medication[] = medsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as any),
  }));

  // 2. Fetch logged events for today
  const eventsSnap = await db
    .collection('patients')
    .doc(patientId)
    .collection('medication_events')
    .where('scheduledDate', '==', patientLocalDate)
    .get();

  const events: MedicationEvent[] = eventsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as any),
  }));

  // 3. Expand schedule & evaluate missed cutoff (120 mins grace)
  const rawDoses = expandDailyDoses(medications, patientLocalDate, events, patientTimezone);
  const evaluatedDoses = evaluateMissedDoses(rawDoses, now, 120, patientTimezone);

  const reminders: ReminderRecord[] = [];

  for (const dose of evaluatedDoses) {
    const scheduledInstant = getDoseScheduledInstant(
      dose.scheduledDate,
      dose.scheduledTime,
      patientTimezone
    );
    const diffMinutes = (scheduledInstant.getTime() - now.getTime()) / (60 * 1000);

    // Rule A: Upcoming Dose — within next 45 minutes and currently UNCONFIRMED
    if (dose.status === 'UNCONFIRMED' && diffMinutes >= -5 && diffMinutes <= 45) {
      const id = `med_upcoming_${patientId}_${dose.medicationId}_${dose.scheduledDate}_${dose.scheduledTime.replace(
        ':',
        ''
      )}`;

      reminders.push({
        id,
        type: 'medication_upcoming',
        patientId,
        patientName,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        recipientRole: recipient.role,
        subject: '',
        scheduledTimeUtc: scheduledInstant.toISOString(),
        localDate: dose.scheduledDate,
        localTime: dose.scheduledTime,
        timezone: patientTimezone,
        entityId: dose.medicationId,
        details: {
          title: `Upcoming Scheduled Dose: ${dose.medicationName}`,
          subtitle: `${dose.dosage} (${dose.form})`,
          instructions: dose.instructions,
          actionPrompt: 'Open Portal & Confirm Dose',
        },
        status: 'queued',
        retryCount: 0,
        maxRetries: 3,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    }

    // Rule B: Missed Dose — dose has expired the 2-hour grace period without confirmation
    if (dose.status === 'MISSED') {
      const id = `med_missed_${patientId}_${dose.medicationId}_${dose.scheduledDate}_${dose.scheduledTime.replace(
        ':',
        ''
      )}`;

      reminders.push({
        id,
        type: 'medication_missed',
        patientId,
        patientName,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        recipientRole: recipient.role,
        subject: '',
        scheduledTimeUtc: scheduledInstant.toISOString(),
        localDate: dose.scheduledDate,
        localTime: dose.scheduledTime,
        timezone: patientTimezone,
        entityId: dose.medicationId,
        details: {
          title: `ALERT — Missed Dose: ${dose.medicationName}`,
          subtitle: `Scheduled for ${dose.scheduledTime} (${patientTimezone}). The 2-hour grace window expired without confirmation.`,
          instructions: dose.instructions,
          actionPrompt: 'Check on Elder & Record Administration',
        },
        status: 'queued',
        retryCount: 0,
        maxRetries: 3,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    }
  }

  return reminders;
}

/**
 * Discovers pending 24-hour and 2-hour appointment reminders.
 * Excludes cancelled and completed visits.
 */
export async function discoverPatientAppointmentReminders(
  patientId: string,
  patientName: string,
  patientTimezone: string,
  now: Date,
  recipient: { email: string; name: string; role: string }
): Promise<ReminderRecord[]> {
  const db = adminFirestore();

  // Query only 'scheduled' visits (excludes cancelled / completed)
  const appSnap = await db
    .collection('patients')
    .doc(patientId)
    .collection('appointments')
    .where('status', '==', 'scheduled')
    .get();

  const appointments: Appointment[] = appSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as any),
  }));

  const reminders: ReminderRecord[] = [];

  for (const app of appointments) {
    const appInstant = new Date(app.appointmentDate);
    const diffHours = (appInstant.getTime() - now.getTime()) / (3600 * 1000);

    // Rule A: 24-Hour Reminder Window (20h to 26h before visit)
    if (
      app.reminderPreferences?.email24h &&
      !app.reminderStatus?.sent24h &&
      diffHours >= 20 &&
      diffHours <= 26
    ) {
      reminders.push({
        id: `app_24h_${patientId}_${app.id}`,
        type: 'appointment_24h',
        patientId,
        patientName,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        recipientRole: recipient.role,
        subject: '',
        scheduledTimeUtc: app.appointmentDate,
        localDate: app.localDate,
        localTime: app.localTime,
        timezone: patientTimezone,
        entityId: app.id,
        details: {
          title: `Upcoming Consultation: ${app.doctorName}`,
          subtitle: `${app.specialty} at ${app.clinicName}`,
          location: app.clinicAddress,
          instructions: app.notes || 'Please arrive 15 minutes prior to scheduled consultation.',
          actionPrompt: 'View Appointment Details',
        },
        status: 'queued',
        retryCount: 0,
        maxRetries: 3,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    }

    // Rule B: 2-Hour Reminder Window (1h to 3h before visit)
    if (
      app.reminderPreferences?.email2h &&
      !app.reminderStatus?.sent2h &&
      diffHours >= 1 &&
      diffHours <= 3
    ) {
      reminders.push({
        id: `app_2h_${patientId}_${app.id}`,
        type: 'appointment_2h',
        patientId,
        patientName,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        recipientRole: recipient.role,
        subject: '',
        scheduledTimeUtc: app.appointmentDate,
        localDate: app.localDate,
        localTime: app.localTime,
        timezone: patientTimezone,
        entityId: app.id,
        details: {
          title: `Consultation in 2 Hours: ${app.doctorName}`,
          subtitle: `${app.specialty} at ${app.clinicName}`,
          location: app.clinicAddress,
          instructions: app.notes || 'Depart for clinic soon to allow travel time.',
          actionPrompt: 'View Clinic Address & Notes',
        },
        status: 'queued',
        retryCount: 0,
        maxRetries: 3,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    }
  }

  return reminders;
}

/**
 * Main Scheduled Execution Pipeline:
 * Discovers all reminders, enforces idempotency, sends via Resend, and records delivery metrics.
 */
export async function executeScheduledReminderPipeline(processId: string = 'cron_scheduler') {
  const startTime = Date.now();
  const db = adminFirestore();
  const now = new Date();

  // 1. Acquire Distributed Lock
  const lock = await acquireSchedulerLock(processId);
  if (!lock.acquired) {
    return {
      success: false,
      locked: true,
      reason: lock.reason,
    };
  }

  let totalEvaluated = 0;
  let remindersSent = 0;
  let remindersFailed = 0;
  let remindersSkipped = 0;
  let executionError: string | undefined;

  try {
    // 2. Fetch all patients
    const patientsSnap = await db.collection('patients').get();
    const candidateReminders: ReminderRecord[] = [];

    for (const pDoc of patientsSnap.docs) {
      const pData = pDoc.data();
      const patientId = pDoc.id;
      const patientName = pData.fullName || 'Elder';
      const patientTimezone = pData.timezone || 'Asia/Kolkata';

      // Find care circle recipient (Primary Family or First Active Member)
      const membersSnap = await db
        .collection('patients')
        .doc(patientId)
        .collection('members')
        .where('status', '==', 'active')
        .get();

      if (membersSnap.empty) continue;

      const primaryMember =
        membersSnap.docs.find((m) => m.data().role === 'primary_family') || membersSnap.docs[0];
      const recipient = {
        email: primaryMember.data().email,
        name: primaryMember.data().displayName || 'Caregiver',
        role: primaryMember.data().role,
      };

      if (!recipient.email) continue;

      // Discover candidate medication & appointment reminders
      const medReminders = await discoverPatientMedicationReminders(
        patientId,
        patientName,
        patientTimezone,
        now,
        recipient
      );
      const appReminders = await discoverPatientAppointmentReminders(
        patientId,
        patientName,
        patientTimezone,
        now,
        recipient
      );

      candidateReminders.push(...medReminders, ...appReminders);
    }

    totalEvaluated = candidateReminders.length;

    // 3. Process candidates with deterministic idempotency check
    for (const reminder of candidateReminders) {
      const reminderDocRef = db.collection('reminders_sent').doc(reminder.id);
      const existingDoc = await reminderDocRef.get();

      if (existingDoc.exists) {
        const existingData = existingDoc.data() as ReminderRecord;
        // If already successfully dispatched, skip!
        if (existingData.status === 'sent') {
          remindersSkipped++;
          continue;
        }

        // If failed and exceeded 3 retries, skip
        if (existingData.status === 'failed' && existingData.retryCount >= existingData.maxRetries) {
          remindersSkipped++;
          continue;
        }

        // Increment retry count
        reminder.retryCount = (existingData.retryCount || 0) + 1;
      }

      // Mark processing in Firestore
      await reminderDocRef.set(
        {
          ...reminder,
          status: 'processing',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // 4. Dispatch Email via Resend
      const dispatchResult = await sendReminderEmail(reminder);

      if (dispatchResult.success) {
        remindersSent++;
        await reminderDocRef.update({
          status: 'sent',
          providerMessageId: dispatchResult.providerMessageId,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // If appointment reminder, update appointment document to prevent repeat
        if (reminder.type === 'appointment_24h') {
          await db
            .collection('patients')
            .doc(reminder.patientId)
            .collection('appointments')
            .doc(reminder.entityId)
            .update({
              'reminderStatus.sent24h': true,
              'reminderStatus.sent24hAt': admin.firestore.FieldValue.serverTimestamp(),
            });
        } else if (reminder.type === 'appointment_2h') {
          await db
            .collection('patients')
            .doc(reminder.patientId)
            .collection('appointments')
            .doc(reminder.entityId)
            .update({
              'reminderStatus.sent2h': true,
              'reminderStatus.sent2hAt': admin.firestore.FieldValue.serverTimestamp(),
            });
        }
      } else {
        remindersFailed++;
        const updateData: Record<string, any> = {
          status: 'failed',
          lastError: dispatchResult.error || 'Provider rejected email',
          retryCount: dispatchResult.restrictedRecipient ? reminder.maxRetries : reminder.retryCount + 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (dispatchResult.restrictedRecipient) {
          updateData.restrictedRecipient = true;
          updateData.restrictionReason = dispatchResult.restrictionReason || 'Recipient not verified in Resend test mode';
        }
        await reminderDocRef.update(updateData);
      }
    }
  } catch (err: any) {
    executionError = err.message || 'Pipeline failed';
  } finally {
    // 5. Release Lock
    await releaseSchedulerLock(processId);
  }

  const durationMs = Date.now() - startTime;
  const executionLog: SchedulerExecutionLog = {
    id: `run_${Date.now()}`,
    startedAt: new Date(startTime).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs,
    status: executionError ? 'failed' : 'success',
    totalEvaluated,
    remindersSent,
    remindersFailed,
    remindersSkipped,
    error: executionError,
  };

  // Record run in system_health
  try {
    await db.collection('system_health').doc('summary').set(
      {
        lastRunTimestamp: executionLog.completedAt,
        lastRunStatus: executionLog.status,
        lastDurationMs: durationMs,
        totalSentReminders: admin.firestore.FieldValue.increment(remindersSent),
        totalFailedReminders: admin.firestore.FieldValue.increment(remindersFailed),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await db.collection('system_health').doc('summary').collection('runs').doc(executionLog.id).set(executionLog);
  } catch (logErr) {
    console.warn('Failed recording execution log:', logErr);
  }

  return {
    success: !executionError,
    executionLog,
  };
}
