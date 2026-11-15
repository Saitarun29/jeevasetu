export interface PatientVitals {
  id: string;
  patientId: string;
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  bloodGlucose?: number;
  glucoseContext?: 'fasting' | 'post_meal' | 'random';
  heartRate?: number;
  oxygenSaturation?: number; // SpO2 percentage e.g. 98
  temperatureFahrenheit?: number; // e.g. 98.6
  notes?: string;
  recordedByUid: string;
  recordedByName: string;
  recordedByRole: string;
  recordedAt: string; // ISO string
}
