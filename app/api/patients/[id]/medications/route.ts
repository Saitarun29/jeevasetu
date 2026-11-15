import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import { recordCareEvent } from '@/lib/audit/care-events';
import * as admin from 'firebase-admin';

export const runtime = 'nodejs';

const CreateMedicationSchema = z.object({
  name: z.string().min(2, 'Medication name must be at least 2 characters'),
  dosage: z.string().min(1, 'Dosage is required (e.g. 500mg, 1 tablet)'),
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
  ]).default('tablet'),
  instructions: z.string().min(1, 'Instructions are required (e.g. After breakfast with warm water)'),
  prescribedBy: z.string().optional(),
  frequency: z.enum(['daily', 'specific_days', 'as_needed']).default('daily'),
  times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Times must be HH:mm format')).default([]),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
});

// GET /api/patients/[id]/medications - List medications for a patient
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { patientId } = await verifyPatientAccess(request, params.id);
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get('includeArchived') === 'true';

    const db = adminFirestore();
    let query: admin.firestore.Query = db
      .collection('patients')
      .doc(patientId)
      .collection('medications');

    if (!includeArchived) {
      query = query.where('isArchived', '==', false);
    }

    const snapshot = await query.get();
    const medications = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ medications });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch medications' },
      { status: error.statusCode || 500 }
    );
  }
}

// POST /api/patients/[id]/medications - Create a new medication schedule
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, member, patientId } = await verifyPatientAccess(request, params.id, [
      'primary_family',
      'family_member',
      'caregiver',
    ]);
    const body = await request.json();
    const validatedData = CreateMedicationSchema.parse(body);

    if (validatedData.frequency !== 'as_needed' && validatedData.times.length === 0) {
      return NextResponse.json(
        { error: 'At least one scheduled time (HH:mm) is required for scheduled medications.' },
        { status: 400 }
      );
    }

    if (validatedData.endDate && validatedData.endDate < validatedData.startDate) {
      return NextResponse.json(
        { error: 'End date cannot be earlier than start date.' },
        { status: 400 }
      );
    }

    const db = adminFirestore();
    const medRef = db.collection('patients').doc(patientId).collection('medications').doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    const medicationRecord = {
      id: medRef.id,
      patientId,
      ...validatedData,
      version: 1, // Start with version 1
      isActive: true,
      isArchived: false,
      createdBy: user.uid,
      updatedBy: user.uid,
      createdAt: now,
      updatedAt: now,
    };

    await medRef.set(medicationRecord);

    // Record append-only care event
    await recordCareEvent({
      patientId,
      eventType: 'MEDICATION_CREATED',
      actorUid: user.uid,
      actorName: member.displayName || user.email,
      actorRole: member.role,
      action: `Created medication schedule: ${validatedData.name} (${validatedData.dosage})`,
      entitySnapshot: {
        medicationId: medRef.id,
        name: validatedData.name,
        dosage: validatedData.dosage,
        frequency: validatedData.frequency,
        times: validatedData.times,
        version: 1,
      },
    });

    return NextResponse.json(
      {
        success: true,
        medicationId: medRef.id,
        medication: {
          id: medRef.id,
          ...validatedData,
          version: 1,
          isActive: true,
          isArchived: false,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors.map((e) => e.message).join(', ') }, { status: 400 });
    }
    return NextResponse.json(
      { error: error.message || 'Failed to create medication' },
      { status: error.statusCode || 500 }
    );
  }
}
