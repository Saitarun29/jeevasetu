import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import { acknowledgeCaregiverHandover, cancelOrRejectCaregiverHandover } from '@/lib/handover/engine';

export const runtime = 'nodejs';

const HandoverActionSchema = z.object({
  action: z.enum(['acknowledge', 'cancel', 'reject']),
  reason: z.string().trim().optional(),
});

// PATCH /api/patients/[id]/handovers/[handoverId] - Acknowledge or cancel/reject shift handover
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; handoverId: string } }
) {
  try {
    const { user, member } = await verifyPatientAccess(request, params.id, [
      'primary_family',
      'caregiver',
    ]);

    const body = await request.json();
    const { action, reason } = HandoverActionSchema.parse(body);

    if (action === 'acknowledge') {
      const acknowledged = await acknowledgeCaregiverHandover(
        params.id,
        params.handoverId,
        user.uid,
        user.name || user.email || 'Incoming Caregiver',
        member.role
      );
      return NextResponse.json({ handover: acknowledged }, { status: 200 });
    } else {
      const cancelled = await cancelOrRejectCaregiverHandover(
        params.id,
        params.handoverId,
        user.uid,
        user.name || user.email || 'Caregiver',
        member.role,
        reason || ''
      );
      return NextResponse.json({ handover: cancelled }, { status: 200 });
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors.map((e) => e.message).join(', ') }, { status: 400 });
    }
    // Map domain errors to correct HTTP semantics instead of leaking them as 500s.
    const message: string = error.message || 'Failed to acknowledge handover';
    let status: number = error.statusCode || 500;
    if (/permission denied|cannot self-acknowledge/i.test(message)) status = 403;
    else if (/not found/i.test(message)) status = 404;
    else if (/already acknowledged|already cancelled/i.test(message)) status = 409;
    else if (status === 500 && /already/i.test(message)) status = 409;
    return NextResponse.json({ error: message }, { status });
  }
}
