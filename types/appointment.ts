export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled';

export interface ReminderPreferences {
  email24h: boolean;
  email2h: boolean;
}

export interface ReminderDeliveryStatus {
  sent24h: boolean;
  sent2h: boolean;
  sent24hAt?: string;
  sent2hAt?: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  doctorName: string;
  specialty: string;
  clinicName: string;
  clinicAddress: string;
  appointmentDate: string; // Authoritative UTC ISO String
  localDate: string; // Patient's local date YYYY-MM-DD
  localTime: string; // Patient's local time HH:mm
  timezone: string; // IANA Timezone, e.g. 'Asia/Kolkata'
  notes?: string;
  accompaniedBy?: string; // Caregiver or family member name
  status: AppointmentStatus;
  cancellationReason?: string;
  reminderPreferences: ReminderPreferences;
  reminderStatus: ReminderDeliveryStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface AppointmentConflict {
  conflictingAppointmentId: string;
  doctorName: string;
  specialty: string;
  appointmentDate: string;
  localTime: string;
  timeDiffMinutes: number;
}
