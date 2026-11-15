import { ReminderRecord } from '@/types/reminder';

export interface EmailRenderOutput {
  subject: string;
  html: string;
  text: string;
}

/**
 * Privacy-conscious subject line generator:
 * Avoids leaking sensitive medical condition names or detailed diagnosis in notifications.
 */
export function extractFirstName(fullName: string): string {
  const honorifics = new Set(['smt.', 'smt', 'sri', 'shri', 'mr.', 'mr', 'mrs.', 'mrs', 'ms.', 'ms', 'dr.', 'dr']);
  const parts = fullName.trim().split(/\s+/);
  for (const part of parts) {
    if (!honorifics.has(part.toLowerCase())) {
      return part;
    }
  }
  return parts[0] || fullName;
}

export function generateEmailSubject(reminder: ReminderRecord): string {
  const elder = extractFirstName(reminder.patientName);

  switch (reminder.type) {
    case 'medication_upcoming':
      return `JEEVASETU Care Alert: Scheduled dose upcoming for ${elder} at ${reminder.localTime}`;
    case 'medication_missed':
      return `URGENT — JEEVASETU: Unconfirmed dose alert for ${elder} (${reminder.localTime})`;
    case 'medication_unconfirmed':
      return `JEEVASETU Care Circle: Please verify scheduled dose for ${elder}`;
    case 'appointment_24h':
      return `Reminder: Doctor consultation tomorrow for ${elder} at ${reminder.localTime}`;
    case 'appointment_2h':
      return `Reminder: Doctor visit in 2 hours for ${elder} (${reminder.localTime})`;
    default:
      return `JEEVASETU Care Coordination Alert for ${elder}`;
  }
}

/**
 * Builds accessible, high-contrast HTML and plain text email templates.
 */
export function renderReminderEmail(
  reminder: ReminderRecord,
  appUrl: string = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
): EmailRenderOutput {
  const subject = generateEmailSubject(reminder);
  const actionUrl = `${appUrl}/medications?patientId=${reminder.patientId}&date=${reminder.localDate}`;
  const appointmentUrl = `${appUrl}/appointments?patientId=${reminder.patientId}`;
  const targetUrl = reminder.type.startsWith('appointment') ? appointmentUrl : actionUrl;

  const isMissed = reminder.type === 'medication_missed';
  const headerBg = isMissed ? '#991b1b' : '#15803d'; // Red for missed, green for upcoming
  const headerBadge = isMissed ? 'ATTENTION REQUIRED' : 'CARE COORDINATION ALERT';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.6;">
  <div style="max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
    
    <!-- Header -->
    <div style="background-color: ${headerBg}; padding: 28px 24px; text-align: center; color: #ffffff;">
      <span style="display: inline-block; background-color: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">
        ${headerBadge}
      </span>
      <h1 style="margin: 10px 0 0 0; font-size: 26px; font-weight: 900; letter-spacing: -0.5px;">JEEVASETU</h1>
      <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">A bridge between generations</p>
    </div>

    <!-- Body -->
    <div style="padding: 32px 28px;">
      <p style="margin-top: 0; font-size: 16px; font-weight: 600; color: #334155;">
        Hello ${reminder.recipientName || 'Care Circle Member'},
      </p>

      <p style="font-size: 15px; color: #475569; margin-bottom: 24px;">
        This automated notification is sent for <strong style="color: #0f172a;">${reminder.patientName}</strong> (${reminder.timezone} timezone).
      </p>

      <!-- Details Card -->
      <div style="background-color: #f1f5f9; border-radius: 12px; padding: 20px; margin-bottom: 24px; border-left: 4px solid ${headerBg};">
        <h2 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 800; color: #0f172a;">
          ${reminder.details.title}
        </h2>
        <p style="margin: 0 0 6px 0; font-size: 15px; font-weight: 600; color: #1e293b;">
          ${reminder.details.subtitle}
        </p>
        <p style="margin: 0 0 6px 0; font-size: 14px; color: #475569;">
          <strong>Scheduled Local Time:</strong> ${reminder.localDate} at ${reminder.localTime}
        </p>
        ${
          reminder.details.instructions
            ? `<p style="margin: 0 0 6px 0; font-size: 14px; color: #475569;"><strong>Instructions:</strong> ${reminder.details.instructions}</p>`
            : ''
        }
        ${
          reminder.details.location
            ? `<p style="margin: 0; font-size: 14px; color: #475569;"><strong>Clinic / Location:</strong> ${reminder.details.location}</p>`
            : ''
        }
      </div>

      <!-- Call to Action Button -->
      <div style="text-align: center; margin: 32px 0;">
        <a href="${targetUrl}" style="display: inline-block; background-color: #16a34a; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-size: 16px; font-weight: 700; box-shadow: 0 2px 6px rgba(22,163,74,0.3);">
          ${reminder.details.actionPrompt || 'Open Care Portal'}
        </a>
      </div>

      <!-- Critical Clinical Safety Invariant Disclaimer -->
      <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 12px 16px; margin-top: 24px;">
        <p style="margin: 0; font-size: 12px; color: #92400e; line-height: 1.5;">
          <strong>Clinical Safety Invariant:</strong> Delivery of this notification does <em>NOT</em> prove medication ingestion. Medication records transition to CONFIRMED TAKEN only when explicitly confirmed in the application by the elder or an assigned caregiver.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background-color: #f8fafc; padding: 20px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
      <p style="margin: 0 0 6px 0;">
        You received this email because you are a registered member of ${reminder.patientName}'s care circle on JEEVASETU.
      </p>
      <p style="margin: 0;">
        JEEVASETU Elderly Care Platform • Technology strengthening human care and dignity.
      </p>
    </div>

  </div>
</body>
</html>
  `.trim();

  const text = `
JEEVASETU — Care Coordination Alert
--------------------------------------------------
Elder: ${reminder.patientName} (${reminder.timezone})
Alert: ${reminder.details.title}
Details: ${reminder.details.subtitle}
Scheduled Local Time: ${reminder.localDate} at ${reminder.localTime}
${reminder.details.instructions ? `Instructions: ${reminder.details.instructions}\n` : ''}${
    reminder.details.location ? `Location: ${reminder.details.location}\n` : ''
  }
Action Required: ${reminder.details.actionPrompt || 'Please verify in the portal'}
Access Link: ${targetUrl}

SAFETY DISCLAIMER:
Delivery of this notification does NOT prove medication ingestion. Medication adherence records transition to CONFIRMED TAKEN only upon explicit confirmation in the JEEVASETU application.
--------------------------------------------------
  `.trim();

  return { subject, html, text };
}
