import { NextResponse } from 'next/server';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import { CareEvent } from '@/types/timeline';
import * as admin from 'firebase-admin';

export const runtime = 'nodejs';

// GET /api/patients/[id]/timeline - Chronological audit timeline of all patient events
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await verifyPatientAccess(request, params.id, [
      'primary_family',
      'family_member',
      'caregiver',
      'patient',
    ]);

    const url = new URL(request.url);
    const category = url.searchParams.get('category');
    const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
    const limit = Math.min(Math.max(limitParam, 1), 100);

    const db = adminFirestore();
    // NOTE: care-events.ts (lib/audit/care-events.ts) writes to the patient-scoped
    // subcollection `/patients/{patientId}/care_events`. Read from the same location
    // so the timeline shows real events rather than an empty list.
    let query: admin.firestore.Query = db
      .collection('patients')
      .doc(params.id)
      .collection('care_events');

    // Apply category filter if provided
    if (category === 'medication') {
      query = query.where('eventType', 'in', [
        'MEDICATION_CREATED',
        'MEDICATION_UPDATED',
        'MEDICATION_TAKEN',
        'MEDICATION_SKIPPED',
        'MEDICATION_MISSED',
        'MEDICATION_CORRECTED',
      ]);
    } else if (category === 'appointment') {
      query = query.where('eventType', 'in', [
        'APPOINTMENT_SCHEDULED',
        'APPOINTMENT_UPDATED',
        'APPOINTMENT_COMPLETED',
        'APPOINTMENT_CANCELLED',
      ]);
    } else if (category === 'continuity') {
      query = query.where('eventType', 'in', [
        'TASK_CREATED',
        'TASK_UPDATED',
        'TASK_COMPLETED',
        'TASK_CANCELLED',
        'HANDOVER_INITIATED',
        'HANDOVER_ACKNOWLEDGED',
      ]);
    }

    // Try orderBy serverTimestamp descending for most recent events first; fallback safely if composite index is pending
    let snap: admin.firestore.QuerySnapshot;
    try {
      snap = await query.orderBy('serverTimestamp', 'desc').limit(limit).get();
    } catch {
      snap = await query.limit(limit).get();
    }

    const events: CareEvent[] = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        patientId: data.patientId,
        eventType: data.eventType,
        actorUid: data.actorUid,
        actorName: data.actorName || 'Care Circle Member',
        actorRole: data.actorRole || 'member',
        action: data.action,
        serverTimestamp: data.serverTimestamp?.toDate
          ? data.serverTimestamp.toDate().toISOString()
          : data.serverTimestamp || new Date().toISOString(),
        clientTimestamp: data.clientTimestamp,
        source: data.source || 'manual',
        entitySnapshot: data.entitySnapshot,
        refEventId: data.refEventId,
      };
    });

    // Safety net: server-side limit already bounded the read; sort the page.
    events.sort((a, b) => new Date(b.serverTimestamp).getTime() - new Date(a.serverTimestamp).getTime());

    return NextResponse.json({ events: events.slice(0, limit) }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch timeline' },
      { status: error.statusCode || 500 }
    );
  }
}
