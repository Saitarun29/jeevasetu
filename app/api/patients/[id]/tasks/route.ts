import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import { createCaregiverTask, listCaregiverTasks } from '@/lib/tasks/engine';
import { adminFirestore } from '@/lib/firebase/admin';
import { CareCircleMember } from '@/types/auth';
import { TaskStatus } from '@/types/task';

export const runtime = 'nodejs';

const CreateTaskSchema = z.object({
  title: z.string().min(2, 'Title must be at least 2 characters'),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  dueDate: z.string().min(5, 'Due date is required'),
  assignedToUid: z.string().min(1, 'Assigned caregiver is required'),
  assignedToName: z.string().min(1, 'Caregiver name is required'),
});

// GET /api/patients/[id]/tasks - List tasks for patient
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, member } = await verifyPatientAccess(request, params.id, [
      'primary_family',
      'family_member',
      'caregiver',
      'patient',
    ]);

    const url = new URL(request.url);
    const status = url.searchParams.get('status') as TaskStatus | undefined;

    const tasks = await listCaregiverTasks(params.id, status || undefined);
    return NextResponse.json({ tasks }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch tasks' },
      { status: error.statusCode || 500 }
    );
  }
}

// POST /api/patients/[id]/tasks - Create task (primary family & caregivers)
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, member } = await verifyPatientAccess(request, params.id, [
      'primary_family',
      'family_member',
      'caregiver',
    ]);

    const body = await request.json();
    const validated = CreateTaskSchema.parse(body);

    const db = adminFirestore();

    // B4: assignee must be an active member of this patient's care circle.
    // Prevents assigning tasks to foreign/revoked UIDs and stops attacker-supplied
    // `assignedToName` from poisoning the append-only audit trail.
    const assigneeRef = db
      .collection('patients')
      .doc(params.id)
      .collection('members')
      .doc(validated.assignedToUid);
    const assigneeDoc = await assigneeRef.get();

    if (!assigneeDoc.exists) {
      return NextResponse.json(
        { error: 'The assigned caregiver is not a member of this care circle.' },
        { status: 400 }
      );
    }
    const assigneeData = assigneeDoc.data() as CareCircleMember;
    if (assigneeData.status !== 'active') {
      return NextResponse.json(
        { error: 'The assigned caregiver has revoked access to this care circle.' },
        { status: 403 }
      );
    }

    const task = await createCaregiverTask({
      patientId: params.id,
      title: validated.title,
      description: validated.description,
      priority: validated.priority,
      dueDate: validated.dueDate,
      assignedToUid: validated.assignedToUid,
      // Prefer the stored, authoritative display name over the client-supplied one
      assignedToName: assigneeData.displayName || validated.assignedToName,
      assignedByUid: user.uid,
      assignedByName: user.name || user.email || 'Family Member',
      assignedByRole: member.role,
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors.map((e) => e.message).join(', ') }, { status: 400 });
    }
    return NextResponse.json(
      { error: error.message || 'Failed to create task' },
      { status: error.statusCode || 500 }
    );
  }
}
