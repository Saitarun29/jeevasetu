export type HandoverStatus = 'pending_acknowledgement' | 'acknowledged' | 'cancelled';

export interface CaregiverHandover {
  id: string;
  patientId: string;
  givingCaregiverUid: string;
  givingCaregiverName: string;
  receivingCaregiverUid: string;
  receivingCaregiverName: string;
  status: HandoverStatus;
  shiftStartTime: string;
  shiftEndTime: string;
  notes: string;
  patientConditionSummary: string;
  pendingTasksSummary: string[];
  vitalSignsSnapshot?: {
    bloodPressure?: string;
    bloodSugar?: string;
    pulseRate?: string;
    temperature?: string;
  };
  createdAt: string;
  acknowledgedAt?: string;
  acknowledgedByUid?: string;
  cancelledAt?: string;
  cancelledByUid?: string;
  cancellationReason?: string;
}
