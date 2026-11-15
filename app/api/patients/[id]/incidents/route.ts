import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import { recordCareEvent } from '@/lib/audit/care-events';

export const runtime = 'nodejs';

const ReportIncidentSchema = z.object({
  category: z.enum([
    'fall',
    'confusion',
    'medication_refusal',
    'pain_complaint',
    'adverse_reaction',
    'mood_change',
    'general_observation',
  ]),
  severity: z.enum(['routine', 'unusual', 'urgent']),
  description: z.string().min(3, 'Description must be at least 3 characters').max(1000),
  actionTaken: z.string().max(1000).optional(),
  familyNotified: z.boolean().default(false),
});

// GET /api/patients/[id]/incidents - List recent incidents & observations
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { patientId } = await verifyPatientAccess(request, params.id, [
      'patient',
      'caregiver',
      'family_member',
      'primary_family',
    ]);

    const db = adminFirestore();
    const snap = await db
      .collection('patients')
      .doc(patientId)
      .collection('incidents')
      .orderBy('reportedAt', 'desc')
      .limit(30)
      .get();

    const incidents = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ incidents });
  } catch (error: any) {
    const status = error.statusCode || 500;
    return NextResponse.json({ error: error.message || 'Failed to fetch incidents' }, { status });
  }
}

// POST /api/patients/[id]/incidents - Record an observation or clinical incident
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, member, patientId } = await verifyPatientAccess(request, params.id, [
      'caregiver',
      'family_member',
      'primary_family',
    ]);

    const body = await request.json();
    const validated = ReportIncidentSchema.parse(body);

    const now = new Date().toISOString();
    const db = adminFirestore();
    const incidentRef = db.collection('patients').doc(patientId).collection('incidents').doc();

    const report = {
      id: incidentRef.id,
      patientId,
      ...validated,
      reportedByUid: user.uid,
      reportedByName: member.displayName || user.email || 'Caregiver',
      reportedByRole: member.role,
      reportedAt: now,
    };

    await incidentRef.set(report);

    await recordCareEvent({
      patientId,
      eventType: 'INCIDENT_REPORTED' as any,
      actorUid: user.uid,
      actorName: member.displayName || user.email || 'Caregiver',
      actorRole: member.role,
      action: `Reported [${validated.severity.toUpperCase()}] ${validated.category.replace('_', ' ')}: "${validated.description.slice(0, 60)}${validated.description.length > 60 ? '...' : ''}"`,
      entitySnapshot: report,
    });

    return NextResponse.json({ success: true, incident: report }, { status: 201 });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: error.errors[0]?.message || 'Validation error' }, { status: 400 });
    }
    const status = error.statusCode || 500;
    return NextResponse.json({ error: error.message || 'Failed to report incident' }, { status });
  }
}
