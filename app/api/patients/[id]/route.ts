import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import { recordCareEvent } from '@/lib/audit/care-events';
import * as admin from 'firebase-admin';

export const runtime = 'nodejs';

const UpdatePatientSchema = z.object({
  fullName: z.string().min(2).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  bloodGroup: z.string().min(1).optional(),
  allergies: z.array(z.string()).optional(),
  chronicConditions: z.array(z.string()).optional(),
  primaryLanguage: z.string().optional(),
  timezone: z.string().optional(),
  emergencyContact: z
    .object({
      name: z.string().min(1),
      phone: z.string().min(7),
      relation: z.string().min(1),
    })
    .optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});

// GET /api/patients/[id] - Fetch shared healthcare profile (any active member)
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { member, patientId } = await verifyPatientAccess(request, params.id);
    const db = adminFirestore();

    const patientDoc = await db.collection('patients').doc(patientId).get();
    if (!patientDoc.exists) {
      return NextResponse.json({ error: 'Patient profile not found' }, { status: 404 });
    }

    const data = patientDoc.data()!;

    // Restrict sensitive information by role
    let patientDataResponse: Record<string, any>;
    if (member.role === 'caregiver') {
      // Caregivers receive clinical necessities and emergency contact only
      patientDataResponse = {
        id: patientDoc.id,
        fullName: data.fullName,
        dateOfBirth: data.dateOfBirth,
        bloodGroup: data.bloodGroup,
        timezone: data.timezone || 'Asia/Kolkata',
        allergies: data.allergies || [],
        chronicConditions: data.chronicConditions || [],
        emergencyContact: data.emergencyContact,
        primaryLanguage: data.primaryLanguage,
      };
    } else {
      // Family members receive full healthcare profile including notes and residence address
      patientDataResponse = {
        id: patientDoc.id,
        ...data,
        timezone: data.timezone || 'Asia/Kolkata',
      };
    }

    return NextResponse.json({
      patient: patientDataResponse,
      myMembership: {
        role: member.role,
        status: member.status,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch patient profile' },
      { status: error.statusCode || 500 }
    );
  }
}

// PATCH /api/patients/[id] - Update healthcare profile (primary_family or family_member)
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, member, patientId } = await verifyPatientAccess(request, params.id, [
      'primary_family',
      'family_member',
    ]);
    const body = await request.json();
    const validatedData = UpdatePatientSchema.parse(body);

    const db = adminFirestore();
    const patientRef = db.collection('patients').doc(patientId);
    const existingDoc = await patientRef.get();

    if (!existingDoc.exists) {
      return NextResponse.json({ error: 'Patient profile not found' }, { status: 404 });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const updatePayload = {
      ...validatedData,
      updatedAt: now,
    };

    await patientRef.update(updatePayload);

    // Record append-only audit event
    await recordCareEvent({
      patientId,
      eventType: 'PATIENT_UPDATED',
      actorUid: user.uid,
      actorName: user.name || user.email,
      actorRole: member.role,
      action: `Updated healthcare profile details`,
      entitySnapshot: validatedData,
    });

    return NextResponse.json({
      success: true,
      updatedFields: Object.keys(validatedData),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors.map((e) => e.message).join(', ') }, { status: 400 });
    }
    return NextResponse.json(
      { error: error.message || 'Failed to update patient profile' },
      { status: error.statusCode || 500 }
    );
  }
}
