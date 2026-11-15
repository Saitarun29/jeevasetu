import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import { initiateCaregiverHandover, listCaregiverHandovers } from '@/lib/handover/engine';
import { CareCircleMember } from '@/types/auth';

export const runtime = 'nodejs';

const CreateHandoverSchema = z.object({
  receivingCaregiverUid: z.string().min(1, 'Receiving caregiver is required'),
  receivingCaregiverName: z.string().min(1, 'Receiving caregiver name is required'),
  shiftStartTime: z.string().min(1, 'Shift start time is required'),
  shiftEndTime: z.string().min(1, 'Shift end time is required'),
  notes: z.string().min(2, 'Handover notes are required'),
  patientConditionSummary: z.string().min(2, 'Patient condition summary is required'),
  pendingTasksSummary: z.array(z.string()).default([]),
  vitalSignsSnapshot: z
    .object({
      bloodPressure: z.string().optional(),
      bloodSugar: z.string().optional(),
      pulseRate: z.string().optional(),
      temperature: z.string().optional(),
    })
    .optional(),
});

// GET /api/patients/[id]/handovers - List shift handovers
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await verifyPatientAccess(request, params.id, [
      'primary_family',
      'family_member',
      'caregiver',
      'patient',
    ]);

    const handovers = await listCaregiverHandovers(params.id);
    return NextResponse.json({ handovers }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch handovers' },
      { status: error.statusCode || 500 }
    );
  }
}

// POST /api/patients/[id]/handovers - Initiate shift handover
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, member } = await verifyPatientAccess(request, params.id, [
      'primary_family',
      'caregiver',
    ]);

    const body = await request.json();
    const validated = CreateHandoverSchema.parse(body);

    const db = adminFirestore();

    // Cross-Patient & Role Validation: Receiving caregiver must be an active member of this patient's care circle
    const receiverRef = db
      .collection('patients')
      .doc(params.id)
      .collection('members')
      .doc(validated.receivingCaregiverUid);
    const receiverDoc = await receiverRef.get();

    if (!receiverDoc.exists) {
      return NextResponse.json(
        { error: 'The receiving caregiver is not a member of this patient care circle.' },
        { status: 400 }
      );
    }
    const receiverData = receiverDoc.data() as CareCircleMember;
    if (receiverData.status !== 'active') {
      return NextResponse.json(
        { error: 'The receiving caregiver has revoked access to this care circle.' },
        { status: 403 }
      );
    }
    if (receiverData.role !== 'caregiver' && receiverData.role !== 'primary_family') {
      return NextResponse.json(
        { error: 'Handovers can only be assigned to caregivers or primary family members.' },
        { status: 400 }
      );
    }

    const receivingCaregiverName = receiverData.displayName || validated.receivingCaregiverName;

    const handover = await initiateCaregiverHandover({
      patientId: params.id,
      givingCaregiverUid: user.uid,
      givingCaregiverName: user.name || user.email || 'Outgoing Caregiver',
      receivingCaregiverUid: validated.receivingCaregiverUid,
      receivingCaregiverName,
      shiftStartTime: validated.shiftStartTime,
      shiftEndTime: validated.shiftEndTime,
      notes: validated.notes,
      patientConditionSummary: validated.patientConditionSummary,
      pendingTasksSummary: validated.pendingTasksSummary,
      vitalSignsSnapshot: validated.vitalSignsSnapshot,
    });

    return NextResponse.json({ handover }, { status: 201 });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors.map((e) => e.message).join(', ') }, { status: 400 });
    }
    return NextResponse.json(
      { error: error.message || 'Failed to initiate handover' },
      { status: error.statusCode || 500 }
    );
  }
}
