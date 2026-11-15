import { Resend } from 'resend';
import { ReminderRecord } from '@/types/reminder';
import { renderReminderEmail } from '@/lib/email/templates';

export interface SendEmailResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
  unconfigured?: boolean;
  restrictedRecipient?: boolean;
  restrictionReason?: string;
}

/**
 * Checks if a Resend error message represents a testing-mode recipient restriction.
 * In Resend test mode (using onboarding@resend.dev without a verified custom domain),
 * delivery is restricted to the verified account owner email or delivered@resend.dev.
 */
export function isResendRestrictionError(message?: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('only send testing emails to your own email address') ||
    lower.includes('verify a domain') ||
    lower.includes('use our testing email address') ||
    lower.includes('domains like `example.com`') ||
    lower.includes('testing email')
  );
}

/**
 * Checks if Resend API key is realistically configured.
 */
export function isResendConfigured(): boolean {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return false;
  if (key === 're_123456789_abcdef' || key.startsWith('re_example')) return false;
  return key.startsWith('re_');
}

/**
 * Dispatches an email via Resend transactional email API strictly server-side.
 * Never fakes or simulates successful dispatch if key is missing, invalid, or restricted.
 * Never exposes credentials to client.
 */
export async function sendReminderEmail(reminder: ReminderRecord): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || 'JEEVASETU <onboarding@resend.dev>';

  if (!isResendConfigured() || !apiKey) {
    return {
      success: false,
      unconfigured: true,
      error:
        'RESEND_API_KEY is not configured with a valid provider token. Please set RESEND_API_KEY in environment variables.',
    };
  }

  try {
    const resend = new Resend(apiKey);
    const { subject, html, text } = renderReminderEmail(reminder);

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [reminder.recipientEmail],
      subject,
      html,
      text,
    });

    if (error) {
      const isRestricted = isResendRestrictionError(error.message);
      return {
        success: false,
        error: error.message || 'Resend provider returned an error dispatching email',
        restrictedRecipient: isRestricted,
        restrictionReason: isRestricted
          ? `Resend Test Mode Restriction: Recipient <${reminder.recipientEmail}> cannot receive mail. Without a custom verified domain, Resend testing mode strictly restricts delivery to the account owner or delivered@resend.dev.`
          : undefined,
      };
    }

    if (!data || !data.id) {
      return {
        success: false,
        error: 'Resend did not return a provider message ID',
      };
    }

    return {
      success: true,
      providerMessageId: data.id,
    };
  } catch (err: any) {
    const isRestricted = isResendRestrictionError(err?.message);
    return {
      success: false,
      error: err?.message || 'Unexpected exception during Resend email dispatch',
      restrictedRecipient: isRestricted,
      restrictionReason: isRestricted
        ? `Resend Test Mode Restriction: Recipient <${reminder.recipientEmail}> cannot receive mail in test mode.`
        : undefined,
    };
  }
}
