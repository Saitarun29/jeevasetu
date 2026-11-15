import {
  Medication,
  MedicationEvent,
  ExpectedDose,
  MedicationCertaintyState,
} from '@/types/medication';

/**
 * Returns the patient's local calendar date (YYYY-MM-DD) for a given UTC Date instant.
 * Never relies on Cloud Run / server UTC date.
 */
export function getPatientLocalDate(instant: Date, timeZone: string = 'Asia/Kolkata'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(instant); // Returns YYYY-MM-DD
  } catch (e) {
    // Fallback if invalid timezone passed
    return instant.toISOString().slice(0, 10);
  }
}

/**
 * Returns the day of the week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
 * for a specific calendar date (YYYY-MM-DD) in the patient's IANA timezone.
 */
export function getPatientDayOfWeek(targetDate: string, timeZone: string = 'Asia/Kolkata'): number {
  const [year, month, day] = targetDate.split('-').map(Number);
  // Noon in UTC for the target date to avoid edge-of-day boundary issues
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
    });
    const weekdayStr = formatter.format(noonUtc);
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return map[weekdayStr] ?? noonUtc.getUTCDay();
  } catch (e) {
    return noonUtc.getUTCDay();
  }
}

/**
 * Converts a patient's local date (YYYY-MM-DD) and local scheduled time (HH:mm) in their IANA timezone
 * into the exact authoritative UTC Date instant.
 *
 * Correctly accounts for:
 * 1. Daylight Saving Time (DST) spring-forward / fall-back transitions.
 * 2. Non-integer timezone offsets (e.g. Asia/Kolkata UTC+05:30, Australia/Adelaide UTC+09:30).
 * 3. Midnight boundary crossing between UTC and local time.
 */
export function getDoseScheduledInstant(
  scheduledDate: string,
  scheduledTime: string,
  timeZone: string = 'Asia/Kolkata'
): Date {
  const [y, m, d] = scheduledDate.split('-').map(Number);
  const [h, min] = scheduledTime.split(':').map(Number);

  // Initial estimate: treat as UTC
  let estimateUtc = Date.UTC(y, m - 1, d, h, min, 0);

  // Iteratively converge to exact wall-clock time in timeZone using Intl
  for (let i = 0; i < 3; i++) {
    const dt = new Date(estimateUtc);
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false,
      }).formatToParts(dt);
    } catch {
      // If timeZone is invalid, default to UTC
      return new Date(estimateUtc);
    }

    const p: Record<string, string> = {};
    for (const part of parts) {
      p[part.type] = part.value;
    }

    const actualH = p.hour === '24' ? 0 : Number(p.hour);
    const actualD = Number(p.day);
    const actualM = Number(p.month);
    const actualY = Number(p.year);
    const actualMin = Number(p.minute);

    // Compute difference between target local wall-clock time and the wall-clock time generated
    const diffHours = (y - actualY) * 365 * 24 + (m - actualM) * 30 * 24 + (d - actualD) * 24 + (h - actualH);
    const diffMinutes = min - actualMin;
    const diffMs = diffHours * 3600000 + diffMinutes * 60000;

    if (diffMs === 0) {
      break;
    }
    estimateUtc += diffMs;
  }

  return new Date(estimateUtc);
}

/**
 * Expands active medications into expected doses for a specific target date (YYYY-MM-DD).
 * Respects the patient's local timezone.
 */
export function expandDailyDoses(
  medications: Medication[],
  targetDate: string,
  events: MedicationEvent[] = [],
  timeZone: string = 'Asia/Kolkata'
): ExpectedDose[] {
  const result: ExpectedDose[] = [];
  const dayOfWeek = getPatientDayOfWeek(targetDate, timeZone);

  // Index existing events by `${medicationId}_${scheduledTime}` for fast lookup
  const eventMap = new Map<string, MedicationEvent>();
  for (const event of events) {
    if (event.scheduledDate === targetDate) {
      const key = `${event.medicationId}_${event.scheduledTime}`;
      eventMap.set(key, event);
    }
  }

  for (const med of medications) {
    // Skip archived or inactive medications
    if (med.isArchived || !med.isActive) continue;

    // Check date boundaries
    if (med.startDate && targetDate < med.startDate) continue;
    if (med.endDate && targetDate > med.endDate) continue;

    // Check frequency suitability
    let isScheduledToday = false;
    if (med.frequency === 'daily') {
      isScheduledToday = true;
    } else if (med.frequency === 'specific_days') {
      if (med.daysOfWeek && med.daysOfWeek.includes(dayOfWeek)) {
        isScheduledToday = true;
      }
    } else if (med.frequency === 'as_needed') {
      // PRN medications do not produce fixed-time scheduled doses
      isScheduledToday = false;
    }

    if (!isScheduledToday) continue;

    // Expand for each scheduled time
    const sortedTimes = [...(med.times || [])].sort();
    for (const time of sortedTimes) {
      const eventKey = `${med.id}_${time}`;
      const existingEvent = eventMap.get(eventKey);

      const status: MedicationCertaintyState = existingEvent
        ? existingEvent.status
        : 'UNCONFIRMED';

      result.push({
        doseKey: `${med.id}_${targetDate}_${time}`,
        medicationId: med.id,
        medicationName: med.name,
        dosage: med.dosage,
        form: med.form,
        instructions: med.instructions,
        prescribedBy: med.prescribedBy,
        scheduledDate: targetDate,
        scheduledTime: time,
        status,
        event: existingEvent,
      });
    }
  }

  // Sort chronologically by scheduled time
  return result.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
}

/**
 * Server-side grace period evaluator:
 * Determines if an UNCONFIRMED dose has transitioned to MISSED based on a configurable grace period (in minutes).
 * Uses getDoseScheduledInstant with the patient's explicit timezone to accurately determine cutoff times.
 */
export function evaluateMissedDoses(
  doses: ExpectedDose[],
  currentTime: Date,
  gracePeriodMinutes: number = 120,
  timeZone: string = 'Asia/Kolkata'
): ExpectedDose[] {
  const currentTimestamp = currentTime.getTime();

  return doses.map((dose) => {
    // Only UNCONFIRMED doses can transition to MISSED
    if (dose.status !== 'UNCONFIRMED') {
      return dose;
    }

    // Compute exact UTC instant when this dose was scheduled in the patient's local timezone
    const scheduledInstant = getDoseScheduledInstant(dose.scheduledDate, dose.scheduledTime, timeZone);
    const cutoffTime = scheduledInstant.getTime() + gracePeriodMinutes * 60 * 1000;

    if (currentTimestamp > cutoffTime) {
      return {
        ...dose,
        status: 'MISSED',
      };
    }

    return dose;
  });
}

export interface AdherenceMetrics {
  totalScheduled: number;
  confirmedTaken: number;
  skipped: number;
  missed: number;
  unconfirmed: number;
  adherencePercentage: number;
}

/**
 * Computes adherence metrics from a collection of expected doses.
 */
export function calculateAdherenceMetrics(doses: ExpectedDose[]): AdherenceMetrics {
  const totalScheduled = doses.length;
  let confirmedTaken = 0;
  let skipped = 0;
  let missed = 0;
  let unconfirmed = 0;

  for (const d of doses) {
    switch (d.status) {
      case 'TAKEN':
        confirmedTaken++;
        break;
      case 'SKIPPED':
        skipped++;
        break;
      case 'MISSED':
        missed++;
        break;
      case 'UNCONFIRMED':
        unconfirmed++;
        break;
    }
  }

  const evaluatedCount = confirmedTaken + skipped + missed;
  const adherencePercentage =
    evaluatedCount > 0
      ? Math.round((confirmedTaken / evaluatedCount) * 100)
      : totalScheduled > 0 && unconfirmed === totalScheduled
      ? 100
      : 0;

  return {
    totalScheduled,
    confirmedTaken,
    skipped,
    missed,
    unconfirmed,
    adherencePercentage,
  };
}
