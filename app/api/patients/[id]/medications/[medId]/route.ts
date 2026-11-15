import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import { recordCareEvent } from '@/lib/audit/care-events';
import * as admin from 'firebase-admin';

export const runtime = 'nodejs';

const UpdateMedicationSchema = z.object({
  expectedVersion: z.number().int().min(1, 'expectedVersion is required for conflict detection'),
  name: z.string().min(2).optional(),
  dosage: z.string().min(1).optional(),
  form: z.enum([
    'tablet',
    'capsule',
    'liquid',
    'injection',
    'topical',
    'inhaler',
    'drops',
    'patch',
    'other',
  ]).optional(),
  instructions: z.string().min(1).optional(),
  prescribedBy: z.string().optional(),
  frequency: z.enum(['daily', 'specific_days', 'as_needed']).optional(),
  times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  isActive: z.boolean().optional(),
});

// GET /api/patients/[id]/medications/[medId] - Get single medication
export async function GET(
  request: Request,
  { params }: { params: { id: string; medId: string } }
) {
  try {
    const { patientId } = await verifyPatientAccess(request, params.id);
    const db = adminFirestore();

    const medDoc = await db
      .collection('patients')
      .doc(patientId)
      .collection('medications')
      .doc(params.medId)
      .get();

    if (!medDoc.exists) {
      return NextResponse.json({ error: 'Medication not found' }, { status: 404 });
    }

    return NextResponse.json({
      medication: {
        id: medDoc.id,
        ...medDoc.data(),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch medication' },
      { status: error.statusCode || 500 }
    );
  }
}

// PATCH /api/patients/[id]/medications/[medId] - Edit medication schedule with conflict detection
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; medId: string } }
) {
  try {
    const { user, member, patientId } = await verifyPatientAccess(request, params.id, [
      'primary_family',
      'family_member',
      'caregiver',
    ]);
    const body = await request.json();
    const validatedData = UpdateMedicationSchema.parse(body);

    const db = adminFirestore();
    const medRef = db.collection('patients').doc(patientId).collection('medications').doc(params.medId);

    let updatedVersion = 1;
    let updatedMedData: any = null;

    // Use Firestore transaction to guarantee version check and update atomicity
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(medRef);
      if (!doc.exists) {
        throw new Error('NOT_FOUND');
      }

      const currentData = doc.data()!;
      const currentVersion = currentData.version || 1;

      // Strict conflict check: never silently overwrite a conflicting schedule version
      if (currentVersion !== validatedData.expectedVersion) {
        const conflictErr: any = new Error(
          `Version conflict: Medication schedule was modified by another user. Current version is ${currentVersion}, but your client expected version ${validatedData.expectedVersion}. Please refresh.`
        );
        conflictErr.statusCode = 409;
        throw conflictErr;
      }

      updatedVersion = currentVersion + 1;

      const { expectedVersion, ...fieldsToUpdate } = validatedData;
      const updatePayload: any = {
        ...fieldsToUpdate,
        version: updatedVersion,
        updatedBy: user.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      transaction.update(medRef, updatePayload);
      updatedMedData = { ...currentData, ...updatePayload };
    });

    // Record append-only care event
    await recordCareEvent({
      patientId,
      eventType: 'MEDICATION_UPDATED',
      actorUid: user.uid,
      actorName: member.displayName || user.email,
      actorRole: member.role,
      action: `Updated medication schedule to version ${updatedVersion}`,
      entitySnapshot: {
        medicationId: params.medId,
        newVersion: updatedVersion,
        updatedFields: Object.keys(validatedData).filter((k) => k !== 'expectedVersion'),
      },
    });

    return NextResponse.json({
      success: true,
      version: updatedVersion,
      medication: updatedMedData,
    });
  } catch (error: any) {
    if (error.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Medication not found' }, { status: 404 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors.map((e) => e.message).join(', ') }, { status: 400 });
    }
    return NextResponse.json(
      { error: error.message || 'Failed to update medication' },
      { status: error.statusCode || 500 }
    );
  }
}

// DELETE /api/patients/[id]/medications/[medId] - Archive medication without destroying historical records
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; medId: string } }
) {
  try {
    const { user, member, patientId } = await verifyPatientAccess(request, params.id, [
      'primary_family',
      'family_member',
    ]);
    const db = adminFirestore();
    const medRef = db.collection('patients').doc(patientId).collection('medications').doc(params.medId);

    const doc = await medRef.get();
    if (!doc.exists) {
      return NextResponse.json({ error: 'Medication not found' }, { status: 404 });
    }

    const currentData = doc.data()!;
    const newVersion = (currentData.version || 1) + 1;

    // Archive without deleting
    await medRef.update({
      isArchived: true,
      isActive: false,
      version: newVersion,
      updatedBy: user.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Record append-only care event
    await recordCareEvent({
      patientId,
      eventType: 'MEDICATION_UPDATED',
      actorUid: user.uid,
      actorName: member.displayName || user.email,
      actorRole: member.role,
      action: `Archived medication ${currentData.name} (version ${newVersion})`,
      entitySnapshot: { medicationId: params.medId, isArchived: true, version: newVersion },
    });

    return NextResponse.json({
      success: true,
      message: `Medication '${currentData.name}' archived successfully. Historical dose records are preserved.`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to archive medication' },
      { status: error.statusCode || 500 }
    );
  }
}
