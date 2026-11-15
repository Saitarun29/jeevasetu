import { adminFirestore } from '@/lib/firebase/admin';
import { CareEvent, CareEventType } from '@/types/timeline';
import * as admin from 'firebase-admin';

export interface RecordCareEventInput {
  patientId: string;
  eventType: CareEventType;
  actorUid: string;
  actorName?: string;
  actorRole: string;
  action: string;
  source?: 'manual' | 'system' | 'offline_sync';
  clientTimestamp?: string;
  entitySnapshot?: Record<string, any>;
  refEventId?: string; // Links correction to prior event
}

/**
 * Appends an auditable care event to `/patients/{patientId}/care_events`.
 * Server-side trusted write only. No update or delete operations are ever exposed.
 */
export async function recordCareEvent(input: RecordCareEventInput): Promise<string> {
  const db = adminFirestore();
  const eventsCollection = db.collection('patients').doc(input.patientId).collection('care_events');
  const eventRef = eventsCollection.doc();

  const eventRecord = {
    id: eventRef.id,
    patientId: input.patientId,
    eventType: input.eventType,
    actorUid: input.actorUid,
    actorName: input.actorName || 'System',
    actorRole: input.actorRole,
    action: input.action,
    serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
    clientTimestamp: input.clientTimestamp || null,
    source: input.source || 'manual',
    entitySnapshot: input.entitySnapshot || null,
    refEventId: input.refEventId || null,
  };

  await eventRef.set(eventRecord);
  return eventRef.id;
}
