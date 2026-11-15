import { Appointment, AppointmentConflict } from '@/types/appointment';
import { getDoseScheduledInstant, getPatientLocalDate } from '@/lib/medication/engine';

/**
 * Validates and converts local appointment date and time into an authoritative UTC Date instant.
 * Rejects past dates unless specifically allowed.
 */
export function validateAndConvertAppointmentDate(
  localDate: string,
  localTime: string,
  timezone: string = 'Asia/Kolkata',
  allowPast: boolean = false
): { instant: Date; error?: string } {
  // Regex check
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    return { instant: new Date(), error: 'Date must be formatted as YYYY-MM-DD' };
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) {
    return { instant: new Date(), error: 'Time must be formatted as HH:mm (24h)' };
  }

  const instant = getDoseScheduledInstant(localDate, localTime, timezone);
  const now = new Date();

  // Appointments must be in the future (with 5-minute grace for form filling)
  if (!allowPast && instant.getTime() < now.getTime() - 5 * 60 * 1000) {
    return {
      instant,
      error: 'Appointment cannot be scheduled in the past. Please select a future date and time.',
    };
  }

  return { instant };
}

/**
 * Detects overlapping or conflicting appointments within a threshold window (default 60 minutes).
 */
export function detectAppointmentConflicts(
  existingAppointments: Appointment[],
  targetInstant: Date,
  thresholdMinutes: number = 60,
  excludeAppointmentId?: string
): AppointmentConflict[] {
  const conflicts: AppointmentConflict[] = [];
  const targetMs = targetInstant.getTime();
  const thresholdMs = thresholdMinutes * 60 * 1000;

  for (const app of existingAppointments) {
    // Only check active scheduled visits
    if (app.status !== 'scheduled') continue;
    if (excludeAppointmentId && app.id === excludeAppointmentId) continue;

    const appMs = new Date(app.appointmentDate).getTime();
    const diffMs = Math.abs(targetMs - appMs);

    if (diffMs < thresholdMs) {
      conflicts.push({
        conflictingAppointmentId: app.id,
        doctorName: app.doctorName,
        specialty: app.specialty,
        appointmentDate: app.appointmentDate,
        localTime: app.localTime,
        timeDiffMinutes: Math.round(diffMs / (60 * 1000)),
      });
    }
  }

  return conflicts;
}

/**
 * Elderly-friendly appointment date and time formatter in the patient's timezone.
 */
export function formatAppointmentDateTime(
  appointmentDateUtc: string,
  timezone: string = 'Asia/Kolkata'
): { formattedDate: string; formattedTime: string; isUpcoming: boolean; isPast: boolean } {
  const date = new Date(appointmentDateUtc);
  const now = new Date();

  const formattedDate = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);

  const formattedTime = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);

  const isUpcoming = date.getTime() > now.getTime();
  const isPast = date.getTime() <= now.getTime();

  return { formattedDate, formattedTime, isUpcoming, isPast };
}
