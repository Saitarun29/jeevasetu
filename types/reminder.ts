export type ReminderType =
  | 'medication_upcoming'
  | 'medication_missed'
  | 'medication_unconfirmed'
  | 'appointment_24h'
  | 'appointment_2h';

export type ReminderDeliveryStatus = 'queued' | 'processing' | 'sent' | 'failed';

export interface ReminderRecord {
  id: string; // Deterministic ID: {type}_{patientId}_{entityId}_{scheduledDate}_{scheduledTime}
  type: ReminderType;
  patientId: string;
  patientName: string;
  recipientEmail: string;
  recipientName: string;
  recipientRole: string;
  subject: string;
  scheduledTimeUtc: string; // ISO String
  localDate: string;
  localTime: string;
  timezone: string;
  entityId: string; // medicationId or appointmentId
  details: {
    title: string;
    subtitle: string;
    instructions?: string;
    location?: string;
    actionPrompt: string;
  };
  status: ReminderDeliveryStatus;
  retryCount: number;
  maxRetries: number;
  providerMessageId?: string;
  lastError?: string;
  restrictedRecipient?: boolean;
  restrictionReason?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
}

export interface SchedulerLock {
  locked: boolean;
  lockedAt: string;
  lockedBy: string;
  expiresAt: string;
}

export interface SchedulerExecutionLog {
  id: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: 'running' | 'success' | 'failed';
  totalEvaluated: number;
  remindersSent: number;
  remindersFailed: number;
  remindersSkipped: number;
  error?: string;
}

export interface SystemHealthMetrics {
  schedulerStatus: 'operational' | 'degraded' | 'unconfigured';
  lastRunTimestamp: string | null;
  lastRunStatus: string | null;
  totalSentReminders: number;
  totalFailedReminders: number;
  pendingQueueCount: number;
  providerConfigured: boolean;
  recentExecutions: SchedulerExecutionLog[];
}
