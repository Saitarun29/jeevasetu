import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import { updateCaregiverTaskStatus } from '@/lib/tasks/engine';

export const runtime = 'nodejs';

const UpdateTaskSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
  notes: z.string().optional(),
});

// PATCH /api/patients/[id]/tasks/[taskId] - Update task status
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; taskId: string } }
) {
  try {
    const { user, member } = await verifyPatientAccess(request, params.id, [
      'primary_family',
      'family_member',
      'caregiver',
    ]);

    const body = await request.json();
    const { status, notes } = UpdateTaskSchema.parse(body);

    const updatedTask = await updateCaregiverTaskStatus(
      params.id,
      params.taskId,
      status,
      user.uid,
      user.name || user.email || 'Caregiver',
      member.role,
      notes
    );

    return NextResponse.json({ task: updatedTask }, { status: 200 });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors.map((e) => e.message).join(', ') }, { status: 400 });
    }
    return NextResponse.json(
      { error: error.message || 'Failed to update task' },
      { status: error.statusCode || 500 }
    );
  }
}
