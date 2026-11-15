export type IncidentSeverity = 'routine' | 'unusual' | 'urgent';

export type IncidentCategory =
  | 'fall'
  | 'confusion'
  | 'medication_refusal'
  | 'pain_complaint'
  | 'adverse_reaction'
  | 'mood_change'
  | 'general_observation';

export interface CaregiverIncidentReport {
  id: string;
  patientId: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  description: string;
  actionTaken?: string;
  familyNotified: boolean;
  reportedByUid: string;
  reportedByName: string;
  reportedByRole: string;
  reportedAt: string; // ISO string
}
