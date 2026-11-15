import { NextResponse } from 'next/server';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import { detectPatientCareGaps } from '@/lib/continuity/gap-detector';

export const runtime = 'nodejs';

// GET /api/patients/[id]/gaps - Real-time Care Gap Detection Engine
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await verifyPatientAccess(request, params.id, [
      'primary_family',
      'family_member',
      'caregiver',
      'patient',
    ]);

    const gaps = await detectPatientCareGaps(params.id);

    return NextResponse.json({
      patientId: params.id,
      detectedCount: gaps.length,
      hasCriticalGaps: gaps.some((g) => g.severity === 'critical'),
      gaps,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to evaluate care gaps' },
      { status: error.statusCode || 500 }
    );
  }
}
