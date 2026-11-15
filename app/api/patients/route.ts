import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyAuthUser } from '@/lib/auth/server-auth';
import { recordCareEvent } from '@/lib/audit/care-events';
import * as admin from 'firebase-admin';

export const runtime = 'nodejs';

const CreatePatientSchema = z.object({
  fullName: z.string().min(2, 'Full name is required (min 2 chars)'),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be YYYY-MM-DD'),
  bloodGroup: z.string().min(1, 'Blood group is required'),
  timezone: z.string().default('Asia/Kolkata'),
  allergies: z.array(z.string()).default([]),
  chronicConditions: z.array(z.string()).default([]),
  primaryLanguage: z.string().default('English'),
  emergencyContact: z.object({
    name: z.string().min(1, 'Contact name is required'),
    phone: z.string().min(7, 'Valid contact phone is required'),
    relation: z.string().min(1, 'Relationship is required'),
  }),
  address: z.string().optional(),
  notes: z.string().optional(),
});

// POST /api/patients - Create a new patient profile and assign creator as primary_family
export async function POST(request: Request) {
  try {
    const user = await verifyAuthUser(request);
    const body = await request.json();
    const validatedData = CreatePatientSchema.parse(body);

    const db = adminFirestore();
    const patientRef = db.collection('patients').doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    const patientDoc = {
      id: patientRef.id,
      ...validatedData,
      createdBy: user.uid,
      createdAt: now,
      updatedAt: now,
    };

    const batch = db.batch();

    // 1. Create Patient document
    batch.set(patientRef, patientDoc);

    // 2. Authoritative membership: creator is primary_family with active status
    const memberRef = patientRef.collection('members').doc(user.uid);
    batch.set(memberRef, {
      userId: user.uid,
      email: user.email || '',
      displayName: user.name || 'Primary Caregiver',
      role: 'primary_family',
      status: 'active',
      joinedAt: now,
      invitedBy: user.uid,
    });

    // 3. User reverse lookup index for fast listing of patient circles
    const userAccessRef = db.collection('users').doc(user.uid).collection('accessible_patients').doc(patientRef.id);
    batch.set(userAccessRef, {
      patientId: patientRef.id,
      fullName: validatedData.fullName,
      role: 'primary_family',
      status: 'active',
      linkedAt: now,
    });

    await batch.commit();

    // Append-only audit care event
    await recordCareEvent({
      patientId: patientRef.id,
      eventType: 'PATIENT_CREATED',
      actorUid: user.uid,
      actorName: user.name || user.email,
      actorRole: 'primary_family',
      action: `Created healthcare profile for ${validatedData.fullName}`,
      entitySnapshot: { fullName: validatedData.fullName, dateOfBirth: validatedData.dateOfBirth },
    });

    return NextResponse.json(
      {
        success: true,
        patientId: patientRef.id,
        patient: { id: patientRef.id, ...validatedData },
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors.map((e) => e.message).join(', ') }, { status: 400 });
    }
    return NextResponse.json(
      { error: error.message || 'Failed to create patient profile' },
      { status: error.statusCode || 500 }
    );
  }
}

// GET /api/patients - List patients the authenticated user is an active member of
export async function GET(request: Request) {
  try {
    const user = await verifyAuthUser(request);
    const db = adminFirestore();

    const accessSnapshot = await db
      .collection('users')
      .doc(user.uid)
      .collection('accessible_patients')
      .where('status', '==', 'active')
      .get();

    if (accessSnapshot.empty) {
      return NextResponse.json({ patients: [] });
    }

    const patientIds = accessSnapshot.docs.map((doc) => doc.id);
    const patientPromises = patientIds.map((id) => db.collection('patients').doc(id).get());
    const patientDocs = await Promise.all(patientPromises);

    const patients = patientDocs
      .filter((doc) => doc.exists)
      .map((doc) => {
        const data = doc.data()!;
        const accessDoc = accessSnapshot.docs.find((a) => a.id === doc.id);
        return {
          id: doc.id,
          fullName: data.fullName,
          dateOfBirth: data.dateOfBirth,
          bloodGroup: data.bloodGroup,
          allergies: data.allergies || [],
          chronicConditions: data.chronicConditions || [],
          emergencyContact: data.emergencyContact,
          primaryLanguage: data.primaryLanguage,
          timezone: data.timezone || 'Asia/Kolkata',
          myRole: accessDoc?.data().role,
        };
      });

    return NextResponse.json({ patients });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch patients' },
      { status: error.statusCode || 500 }
    );
  }
}
