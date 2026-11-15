import { adminFirestore } from '@/lib/firebase/admin';
import { CareGap } from '@/types/care-gap';
import { Medication, MedicationEvent } from '@/types/medication';
import { Appointment } from '@/types/appointment';
import { CaregiverTask } from '@/types/task';
import { CaregiverHandover } from '@/types/handover';
import {
  getPatientLocalDate,
  expandDailyDoses,
  evaluateMissedDoses,
} from '@/lib/medication/engine';

export async function detectPatientCareGaps(patientId: string): Promise<CareGap[]> {
  const db = adminFirestore();
  const gaps: CareGap[] = [];
  const now = new Date();
  const nowIso = now.toISOString();

  // 1. Fetch Patient Profile for Timezone
  const patientDoc = await db.collection('patients').doc(patientId).get();
  if (!patientDoc.exists) {
    return [];
  }
  const patientData = patientDoc.data()!;
  const timezone = patientData.timezone || 'Asia/Kolkata';
  const todayLocalDate = getPatientLocalDate(now, timezone);

  // 2. Scan Overdue / Unconfirmed Medications
  // NOTE: Medication documents use boolean `isActive` + `isArchived` (see types/medication.ts),
  // not a string `status` field. Query the real fields so gaps are actually detected.
  const medsSnap = await db
    .collection('patients')
    .doc(patientId)
    .collection('medications')
    .where('isArchived', '==', false)
    .where('isActive', '==', true)
    .get();

  const medications = medsSnap.docs.map((d) => d.data() as Medication);

  if (medications.length > 0) {
    const eventsSnap = await db
      .collection('patients')
      .doc(patientId)
      .collection('medication_events')
      .where('scheduledDate', '==', todayLocalDate)
      .get();

    const loggedEvents = eventsSnap.docs.map((d) => d.data() as MedicationEvent);
    const expectedDoses = expandDailyDoses(medications, todayLocalDate, loggedEvents, timezone);

    // Evaluate missed/unconfirmed past 60 min grace period
    const evaluated = evaluateMissedDoses(expectedDoses, now, 60, timezone);

    for (const dose of evaluated) {
      if (dose.status === 'MISSED') {
        gaps.push({
          id: `gap_med_${dose.medicationId}_${dose.scheduledDate}_${dose.scheduledTime}`,
          patientId,
          type: 'unconfirmed_dose',
          severity: 'critical',
          title: `Missed Dose: ${dose.medicationName} (${dose.dosage})`,
          description: `Scheduled for ${dose.scheduledTime} today. The 60-minute grace period has passed without confirmation.`,
          detectedAt: nowIso,
          actionRequired: 'Verify whether medication was ingested or record reason for skipped dose.',
          targetEntityId: dose.medicationId,
          targetEntityType: 'medication',
        });
      }
    }
  }

  // 3. Scan Doctor Appointments (Next 48 Hours)
  const aptsSnap = await db
    .collection('patients')
    .doc(patientId)
    .collection('appointments')
    .where('status', '==', 'scheduled')
    .get();

  const appointments = aptsSnap.docs.map((d) => d.data() as Appointment);

  for (const apt of appointments) {
    const aptTime = new Date(apt.appointmentDate).getTime();
    const hoursRemaining = (aptTime - now.getTime()) / (1000 * 60 * 60);

    // If within next 48 hours and missing notes/accompaniment confirmation
    if (hoursRemaining > 0 && hoursRemaining <= 48) {
      const hasAccompaniment = Boolean(
        (apt.accompaniedBy && apt.accompaniedBy.trim().length > 0) ||
        (apt.notes && /\baccompanied\b/i.test(apt.notes) && !/\bunaccompanied\b/i.test(apt.notes))
      );
      if (!hasAccompaniment) {
        gaps.push({
          id: `gap_apt_${apt.id}`,
          patientId,
          type: 'unaccompanied_appointment',
          severity: 'warning',
          title: `Upcoming Clinic Visit: Dr. ${apt.doctorName}`,
          description: `Scheduled in ${Math.round(hoursRemaining)} hours at ${apt.clinicName}. No caregiver accompaniment is noted.`,
          detectedAt: nowIso,
          actionRequired: 'Confirm escort caregiver and transportation for the elder.',
          targetEntityId: apt.id,
          targetEntityType: 'appointment',
        });
      }
    }
  }

  // 4. Scan Overdue Caregiver Tasks
  const tasksSnap = await db
    .collection('patients')
    .doc(patientId)
    .collection('tasks')
    .where('status', 'in', ['pending', 'in_progress'])
    .get();

  const tasks = tasksSnap.docs.map((d) => d.data() as CaregiverTask);

  for (const task of tasks) {
    const dueDateStr = /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)
      ? `${task.dueDate}T23:59:59.999`
      : task.dueDate;
    const taskDue = new Date(dueDateStr).getTime();
    if (now.getTime() > taskDue) {
      const overdueHours = Math.round((now.getTime() - taskDue) / (1000 * 60 * 60));
      gaps.push({
        id: `gap_task_${task.id}`,
        patientId,
        type: 'overdue_task',
        severity: task.priority === 'urgent' || task.priority === 'high' ? 'critical' : 'warning',
        title: `Overdue Task: ${task.title}`,
        description: `Assigned to ${task.assignedToName}. Overdue by ${overdueHours} hours (Due: ${task.dueDate}).`,
        detectedAt: nowIso,
        actionRequired: 'Check with caregiver on task completion status.',
        targetEntityId: task.id,
        targetEntityType: 'task',
      });
    }
  }

  // 5. Scan Pending Handovers Awaiting Acknowledgement (> 2 hours)
  const handoversSnap = await db
    .collection('patients')
    .doc(patientId)
    .collection('handovers')
    .where('status', '==', 'pending_acknowledgement')
    .get();

  const handovers = handoversSnap.docs.map((d) => d.data() as CaregiverHandover);

  for (const ho of handovers) {
    const createdTime = new Date(ho.createdAt).getTime();
    const pendingHours = (now.getTime() - createdTime) / (1000 * 60 * 60);

    if (pendingHours >= 2) {
      gaps.push({
        id: `gap_handover_${ho.id}`,
        patientId,
        type: 'pending_handover',
        severity: 'critical',
        title: `Unacknowledged Shift Handover from ${ho.givingCaregiverName}`,
        description: `Initiated ${Math.round(pendingHours)} hours ago for ${ho.receivingCaregiverName}. Caregiver duty transfer remains unresolved.`,
        detectedAt: nowIso,
        actionRequired: `Request ${ho.receivingCaregiverName} or family supervisor acknowledge the handover.`,
        targetEntityId: ho.id,
        targetEntityType: 'handover',
      });
    }
  }

  // Sort by severity (critical > warning > info)
  const severityRank: Record<string, number> = { critical: 3, warning: 2, info: 1 };
  return gaps.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
}
