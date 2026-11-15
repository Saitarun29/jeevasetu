export interface EmergencyContact {
  name: string;
  phone: string;
  relation: string;
}

export interface PatientProfile {
  id: string;
  fullName: string;
  dateOfBirth: string; // YYYY-MM-DD
  bloodGroup: string;
  timezone: string; // IANA Timezone string, e.g. 'Asia/Kolkata', 'America/New_York'
  allergies: string[];
  chronicConditions: string[];
  emergencyContact: EmergencyContact;
  primaryLanguage: string;
  address?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export type CreatePatientInput = Omit<PatientProfile, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
