export type CareEventType =
  | 'PATIENT_CREATED'
  | 'PATIENT_UPDATED'
  | 'CARE_CIRCLE_MEMBER_JOINED'
  | 'CARE_CIRCLE_MEMBER_REVOKED'
  | 'INVITATION_GENERATED'
  | 'MEDICATION_CREATED'
  | 'MEDICATION_UPDATED'
  | 'MEDICATION_TAKEN'
  | 'MEDICATION_SKIPPED'
  | 'MEDICATION_MISSED'
  | 'MEDICATION_CORRECTED'
  | 'APPOINTMENT_SCHEDULED'
  | 'APPOINTMENT_UPDATED'
  | 'APPOINTMENT_COMPLETED'
  | 'APPOINTMENT_CANCELLED'
  | 'REMINDER_SENT'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_COMPLETED'
  | 'TASK_CANCELLED'
  | 'HANDOVER_INITIATED'
  | 'HANDOVER_ACKNOWLEDGED'
  | 'HANDOVER_CANCELLED';

export interface CareEvent {
  id: string;
  patientId: string;
  eventType: CareEventType;
  actorUid: string;
  actorName?: string;
  actorRole: string;
  action: string;
  serverTimestamp: string;
  clientTimestamp?: string;
  source: 'manual' | 'system' | 'offline_sync';
  entitySnapshot?: Record<string, any>;
  refEventId?: string; // Set when this event amends or corrects an earlier event
}
