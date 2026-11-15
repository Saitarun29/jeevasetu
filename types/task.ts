export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface CaregiverTask {
  id: string;
  patientId: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string; // ISO date-time or YYYY-MM-DD
  assignedToUid: string;
  assignedToName: string;
  assignedByUid: string;
  assignedByName: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completedByUid?: string;
  completedByName?: string;
  notes?: string;
}
