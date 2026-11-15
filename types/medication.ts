export type MedicationCertaintyState = 'UNCONFIRMED' | 'TAKEN' | 'SKIPPED' | 'MISSED';

export type FrequencyType = 'daily' | 'specific_days' | 'as_needed';

export type MedicationForm =
  | 'tablet'
  | 'capsule'
  | 'liquid'
  | 'injection'
  | 'topical'
  | 'inhaler'
  | 'drops'
  | 'patch'
  | 'other';

export interface Medication {
  id: string;
  patientId: string;
  name: string;
  dosage: string;
  form: MedicationForm;
  instructions: string;
  prescribedBy?: string;
  frequency: FrequencyType;
  times: string[]; // HH:mm format, e.g. ["08:00", "20:00"]
  daysOfWeek?: number[]; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD (optional)
  version: number;
  isActive: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface MedicationEvent {
  id: string; // Client-generated action UUID
  patientId: string;
  medicationId: string;
  medicationName: string;
  dosage: string;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: string; // HH:mm
  status: MedicationCertaintyState;
  actorUid: string;
  actorName: string;
  actorRole: string;
  serverTimestamp: string;
  clientTimestamp?: string;
  note?: string; // Explanation for SKIPPED or notes
  source: 'online' | 'offline_sync' | 'scheduler_cron';
}

export interface ExpectedDose {
  doseKey: string; // {medicationId}_{scheduledDate}_{scheduledTime}
  medicationId: string;
  medicationName: string;
  dosage: string;
  form: MedicationForm;
  instructions: string;
  prescribedBy?: string;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: string; // HH:mm
  status: MedicationCertaintyState;
  event?: MedicationEvent;
}
