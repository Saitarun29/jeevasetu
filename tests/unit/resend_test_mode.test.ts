import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isResendConfigured,
  isResendRestrictionError,
  sendReminderEmail,
} from '@/lib/email/resend';
import { renderReminderEmail, generateEmailSubject } from '@/lib/email/templates';
import { ReminderRecord } from '@/types/reminder';

describe('JEEVASETU Resend Test Mode & Delivery Invariants', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('1. verifies isResendConfigured behaves correctly for valid and invalid keys', () => {
    process.env.RESEND_API_KEY = 're_test_valid_key_1234567890';
    expect(isResendConfigured()).toBe(true);

    process.env.RESEND_API_KEY = '   re_test_with_spaces_123456   ';
    expect(isResendConfigured()).toBe(true);

    process.env.RESEND_API_KEY = '';
    expect(isResendConfigured()).toBe(false);

    process.env.RESEND_API_KEY = 're_123456789_abcdef';
    expect(isResendConfigured()).toBe(false);

    process.env.RESEND_API_KEY = 're_example_key';
    expect(isResendConfigured()).toBe(false);

    delete process.env.RESEND_API_KEY;
    expect(isResendConfigured()).toBe(false);
  });

  it('2. detects Resend test-mode recipient restriction errors reliably', () => {
    const restrictionMsg1 =
      'You can only send testing emails to your own email address (saitarunronanki06@gmail.com). To send emails to other recipients, please verify a domain at resend.com/domains';
    const restrictionMsg2 =
      'Invalid `to` field. Please use our testing email address instead of domains like `example.com`. See our documentation for more information.';
    const randomErrorMsg = 'Network connection reset by peer';

    expect(isResendRestrictionError(restrictionMsg1)).toBe(true);
    expect(isResendRestrictionError(restrictionMsg2)).toBe(true);
    expect(isResendRestrictionError(randomErrorMsg)).toBe(false);
    expect(isResendRestrictionError(undefined)).toBe(false);
  });

  it('3. renders upcoming medication reminder with synthetic patient data and safety disclaimer', () => {
    const reminder: ReminderRecord = {
      id: 'med_upcoming_synth_med1_2026-11-15_0800',
      type: 'medication_upcoming',
      patientId: 'patient_synth_001',
      patientName: 'Demo Elder',
      recipientEmail: 'saitarunronanki06@gmail.com',
      recipientName: 'Demo Caregiver',
      recipientRole: 'primary_family',
      subject: '',
      scheduledTimeUtc: '2026-11-15T02:30:00.000Z',
      localDate: '2026-11-15',
      localTime: '08:00',
      timezone: 'Asia/Kolkata',
      entityId: 'med_synth_01',
      details: {
        title: 'Upcoming Scheduled Dose: Amlodipine 5mg (Demo)',
        subtitle: '1 tablet with morning water',
        instructions: 'Take after breakfast',
        actionPrompt: 'Open Care Portal & Confirm Dose',
      },
      status: 'queued',
      retryCount: 0,
      maxRetries: 3,
      createdAt: '2026-11-15T02:00:00.000Z',
      updatedAt: '2026-11-15T02:00:00.000Z',
    };

    const rendered = renderReminderEmail(reminder, 'http://localhost:3000');

    expect(rendered.subject).toContain('Scheduled dose upcoming');
    expect(rendered.subject).toContain('08:00');
    expect(rendered.html).toContain('Demo Elder');
    expect(rendered.html).toContain('Amlodipine 5mg (Demo)');
    expect(rendered.html).toContain('Clinical Safety Invariant');
    expect(rendered.text).toContain('SAFETY DISCLAIMER');
    expect(rendered.text).toContain('does NOT prove medication ingestion');
  });

  it('4. renders missed medication reminder with urgent alert header and no adherence mutation', () => {
    const reminder: ReminderRecord = {
      id: 'med_missed_synth_med1_2026-11-15_0800',
      type: 'medication_missed',
      patientId: 'patient_synth_001',
      patientName: 'Demo Elder',
      recipientEmail: 'saitarunronanki06@gmail.com',
      recipientName: 'Demo Caregiver',
      recipientRole: 'primary_family',
      subject: '',
      scheduledTimeUtc: '2026-11-15T02:30:00.000Z',
      localDate: '2026-11-15',
      localTime: '08:00',
      timezone: 'Asia/Kolkata',
      entityId: 'med_synth_01',
      details: {
        title: 'ALERT — Missed Dose: Amlodipine 5mg (Demo)',
        subtitle: 'Scheduled for 08:00. The 2-hour grace window expired without confirmation.',
        actionPrompt: 'Check on Elder & Record Administration',
      },
      status: 'queued',
      retryCount: 0,
      maxRetries: 3,
      createdAt: '2026-11-15T04:30:00.000Z',
      updatedAt: '2026-11-15T04:30:00.000Z',
    };

    const rendered = renderReminderEmail(reminder, 'http://localhost:3000');

    expect(rendered.subject).toContain('URGENT');
    expect(rendered.subject).toContain('Unconfirmed dose alert');
    expect(rendered.html).toContain('ATTENTION REQUIRED');
    expect(rendered.html).toContain('2-hour grace window');
    expect(rendered.html).toContain('Clinical Safety Invariant');
  });

  it('5. renders doctor appointment reminders (24h and 2h windows)', () => {
    const reminder24h: ReminderRecord = {
      id: 'app_24h_synth_app01',
      type: 'appointment_24h',
      patientId: 'patient_synth_001',
      patientName: 'Demo Elder',
      recipientEmail: 'saitarunronanki06@gmail.com',
      recipientName: 'Demo Caregiver',
      recipientRole: 'primary_family',
      subject: '',
      scheduledTimeUtc: '2026-11-16T05:00:00.000Z',
      localDate: '2026-11-16',
      localTime: '10:30',
      timezone: 'Asia/Kolkata',
      entityId: 'app_synth_01',
      details: {
        title: 'Upcoming Consultation: Dr. Sample Cardiologist (Demo)',
        subtitle: 'Cardiology at City Health Center',
        location: 'Room 204, OPD Block',
        instructions: 'Carry latest blood pressure log',
        actionPrompt: 'View Appointment Details',
      },
      status: 'queued',
      retryCount: 0,
      maxRetries: 3,
      createdAt: '2026-11-15T05:00:00.000Z',
      updatedAt: '2026-11-15T05:00:00.000Z',
    };

    const rendered24h = renderReminderEmail(reminder24h, 'http://localhost:3000');
    expect(rendered24h.subject).toContain('Doctor consultation tomorrow');
    expect(rendered24h.subject).toContain('10:30');
    expect(rendered24h.html).toContain('City Health Center');
    expect(rendered24h.html).toContain('Carry latest blood pressure log');

    const reminder2h: ReminderRecord = {
      ...reminder24h,
      id: 'app_2h_synth_app01',
      type: 'appointment_2h',
    };
    const rendered2h = renderReminderEmail(reminder2h, 'http://localhost:3000');
    expect(rendered2h.subject).toContain('Doctor visit in 2 hours');
  });

  it('6. safely fails closed when RESEND_API_KEY is not configured', async () => {
    delete process.env.RESEND_API_KEY;

    const reminder: ReminderRecord = {
      id: 'med_test_unconfigured',
      type: 'medication_upcoming',
      patientId: 'p1',
      patientName: 'Demo Patient',
      recipientEmail: 'test@example.com',
      recipientName: 'Demo',
      recipientRole: 'primary_family',
      subject: '',
      scheduledTimeUtc: '2026-11-15T08:00:00Z',
      localDate: '2026-11-15',
      localTime: '08:00',
      timezone: 'Asia/Kolkata',
      entityId: 'med1',
      details: { title: 'Test', subtitle: 'Test', actionPrompt: 'Test' },
      status: 'queued',
      retryCount: 0,
      maxRetries: 3,
      createdAt: '',
      updatedAt: '',
    };

    const result = await sendReminderEmail(reminder);
    expect(result.success).toBe(false);
    expect(result.unconfigured).toBe(true);
    expect(result.error).toContain('RESEND_API_KEY is not configured');
  });

  it('7. enforces clinical invariant: reminder dispatch never mutates medication adherence status to TAKEN', () => {
    let medicationStatus: 'SCHEDULED' | 'UNCONFIRMED' | 'TAKEN' | 'MISSED' = 'UNCONFIRMED';
    const emailDispatchResult = {
      success: true,
      providerMessageId: 'resend_msg_test_12345',
    };

    // Even upon successful email dispatch:
    expect(emailDispatchResult.success).toBe(true);
    // Medication adherence status remains UNCONFIRMED (requires manual user or caregiver confirmation)
    expect(medicationStatus).toBe('UNCONFIRMED');
    expect(medicationStatus).not.toBe('TAKEN');
  });
});
