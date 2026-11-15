import { adminFirestore } from '@/lib/firebase/admin';
import { CaregiverTask, TaskStatus, TaskPriority } from '@/types/task';
import { UserRole } from '@/types/auth';
import { recordCareEvent } from '@/lib/audit/care-events';
import * as admin from 'firebase-admin';

export interface CreateTaskInput {
  patientId: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  dueDate: string;
  assignedToUid: string;
  assignedToName: string;
  assignedByUid: string;
  assignedByName: string;
  assignedByRole: UserRole;
}

export async function createCaregiverTask(input: CreateTaskInput): Promise<CaregiverTask> {
  const db = adminFirestore();
  const taskRef = db.collection('patients').doc(input.patientId).collection('tasks').doc();
  const now = new Date().toISOString();

  const task: CaregiverTask = {
    id: taskRef.id,
    patientId: input.patientId,
    title: input.title.trim(),
    description: input.description?.trim() || '',
    priority: input.priority,
    status: 'pending',
    dueDate: input.dueDate,
    assignedToUid: input.assignedToUid,
    assignedToName: input.assignedToName,
    assignedByUid: input.assignedByUid,
    assignedByName: input.assignedByName,
    createdAt: now,
    updatedAt: now,
  };

  await taskRef.set(task);

  await recordCareEvent({
    patientId: input.patientId,
    eventType: 'TASK_CREATED',
    actorUid: input.assignedByUid,
    actorName: input.assignedByName,
    // Anti-spoofing: role comes from the verified member record, not the client payload
    actorRole: input.assignedByRole,
    action: `Assigned task "${input.title}" to ${input.assignedToName} (Priority: ${input.priority})`,
    entitySnapshot: { taskId: taskRef.id, title: input.title, priority: input.priority, dueDate: input.dueDate },
  });

  return task;
}

export async function updateCaregiverTaskStatus(
  patientId: string,
  taskId: string,
  status: TaskStatus,
  actorUid: string,
  actorName: string,
  actorRole: UserRole,
  notes?: string
): Promise<CaregiverTask> {
  const db = adminFirestore();
  const taskRef = db.collection('patients').doc(patientId).collection('tasks').doc(taskId);

  // Concurrency-safe: read-check-write must be atomic so two caregivers cannot
  // both complete the same task and emit duplicate TASK_COMPLETED audit events.
  let updatedTask: CaregiverTask | null = null;
  let isNoOp = false;

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(taskRef);
    if (!doc.exists) {
      throw new Error('Task not found.');
    }

    const existing = doc.data() as CaregiverTask;
    const now = new Date().toISOString();

    // State machine: terminal states (completed/cancelled) cannot be modified.
    // Idempotent guard: if already in the requested terminal state, return existing without re-emitting audit event.
    if (existing.status === 'completed' || existing.status === 'cancelled') {
      if (existing.status === status) {
        updatedTask = existing;
        isNoOp = true;
        return;
      }
      throw new Error(`Task is already ${existing.status} and cannot be modified.`);
    }

    const updates: Partial<CaregiverTask> = {
      status,
      updatedAt: now,
      notes: notes || existing.notes || '',
    };

    if (status === 'completed') {
      updates.completedAt = now;
      updates.completedByUid = actorUid;
      updates.completedByName = actorName;
    }

    transaction.update(taskRef, updates);
    updatedTask = { ...existing, ...updates };
  });

  const result = updatedTask!;

  // If task was already completed/cancelled (idempotent no-op), do not emit duplicate audit log
  if (isNoOp) {
    return result;
  }

  // Correct per-status audit typing
  const eventType =
    status === 'completed' ? 'TASK_COMPLETED' : status === 'cancelled' ? 'TASK_CANCELLED' : 'TASK_UPDATED';

  if (status !== 'pending' && result !== updatedTask) {
    // Only emit if state actually changed
  }

  await recordCareEvent({
    patientId,
    eventType,
    actorUid,
    actorName,
    actorRole,
    action: `Marked task "${result.title}" as ${status.toUpperCase()}`,
    entitySnapshot: { taskId, previousStatus: 'pending', newStatus: status, notes: notes || '' },
  });

  return result;
}

export async function listCaregiverTasks(patientId: string, statusFilter?: TaskStatus): Promise<CaregiverTask[]> {
  const db = adminFirestore();
  let query: admin.firestore.Query = db.collection('patients').doc(patientId).collection('tasks');

  if (statusFilter) {
    query = query.where('status', '==', statusFilter);
  }

  const snap = await query.get();
  const tasks = snap.docs.map((d) => d.data() as CaregiverTask);
  return tasks.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
}
