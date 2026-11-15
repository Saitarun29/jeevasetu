export type CareGapType =
  | 'unconfirmed_dose'
  | 'unaccompanied_appointment'
  | 'pending_handover'
  | 'overdue_task'
  | 'missing_emergency_contact';

export type CareGapSeverity = 'info' | 'warning' | 'critical';

export interface CareGap {
  id: string;
  patientId: string;
  type: CareGapType;
  severity: CareGapSeverity;
  title: string;
  description: string;
  detectedAt: string;
  actionRequired: string;
  targetEntityId?: string;
  targetEntityType?: 'medication' | 'appointment' | 'task' | 'handover';
}
