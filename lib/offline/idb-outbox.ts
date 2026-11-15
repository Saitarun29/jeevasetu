import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { MedicationCertaintyState } from '@/types/medication';
import { generateUUID } from '@/lib/utils';

export interface OutboxItem {
  id: string; // Action UUID
  patientId: string;
  medicationId: string;
  medicationName: string;
  dosage: string;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: string; // HH:mm
  status: MedicationCertaintyState;
  expectedVersion?: number;
  note?: string;
  clientTimestamp: string;
  retryCount: number;
  synced: boolean;
  isConflict?: boolean;
  conflictReason?: string;
  error?: string;
}

export interface CachedSchedule {
  patientId: string;
  medications: any[];
  version: number;
  cachedAt: string;
}

export interface CachedAppointments {
  patientId: string;
  appointments: any[];
  cachedAt: string;
}

export interface SyncMeta {
  key: string;
  value: string;
}

interface JeevasetuDB extends DBSchema {
  outbox: {
    key: string;
    value: OutboxItem;
    indexes: { 'by-patient': string; 'by-synced': number };
  };
  schedules_cache: {
    key: string; // patientId
    value: CachedSchedule;
  };
  appointments_cache: {
    key: string; // patientId
    value: CachedAppointments;
  };
  sync_meta: {
    key: string;
    value: SyncMeta;
  };
}

const DB_NAME = 'jeevasetu-offline-db';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<JeevasetuDB>> | null = null;

export function getOfflineDB(): Promise<IDBPDatabase<JeevasetuDB>> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB is only available in browser environments.'));
  }

  if (!dbPromise) {
    dbPromise = openDB<JeevasetuDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('outbox')) {
          const outboxStore = db.createObjectStore('outbox', { keyPath: 'id' });
          outboxStore.createIndex('by-patient', 'patientId');
          outboxStore.createIndex('by-synced', 'synced');
        }

        if (!db.objectStoreNames.contains('schedules_cache')) {
          db.createObjectStore('schedules_cache', { keyPath: 'patientId' });
        }

        if (!db.objectStoreNames.contains('appointments_cache')) {
          db.createObjectStore('appointments_cache', { keyPath: 'patientId' });
        }

        if (!db.objectStoreNames.contains('sync_meta')) {
          db.createObjectStore('sync_meta', { keyPath: 'key' });
        }
      },
    });
  }

  return dbPromise;
}

/**
 * Enqueues a medication action with an authoritative client-generated action UUID.
 * Saved immediately to IndexedDB before any network request.
 * Never shows pending events as server-confirmed.
 */
export async function queueMedicationAction(
  patientId: string,
  medicationId: string,
  medicationName: string,
  dosage: string,
  scheduledDate: string,
  scheduledTime: string,
  status: MedicationCertaintyState,
  note?: string,
  expectedVersion?: number
): Promise<OutboxItem> {
  const db = await getOfflineDB();
  const actionUUID = generateUUID();

  const item: OutboxItem = {
    id: actionUUID,
    patientId,
    medicationId,
    medicationName,
    dosage,
    scheduledDate,
    scheduledTime,
    status,
    expectedVersion,
    note,
    clientTimestamp: new Date().toISOString(),
    retryCount: 0,
    synced: false,
    isConflict: false,
  };

  await db.put('outbox', item);
  return item;
}

export async function getPendingOutbox(patientId?: string): Promise<OutboxItem[]> {
  try {
    const db = await getOfflineDB();
    const all = await db.getAll('outbox');
    return all.filter((item) => !item.synced && !item.isConflict && (!patientId || item.patientId === patientId));
  } catch (e) {
    console.warn('Failed reading outbox:', e);
    return [];
  }
}

export async function getConflictedOutbox(patientId?: string): Promise<OutboxItem[]> {
  try {
    const db = await getOfflineDB();
    const all = await db.getAll('outbox');
    return all.filter((item) => item.isConflict && (!patientId || item.patientId === patientId));
  } catch (e) {
    console.warn('Failed reading conflicted outbox:', e);
    return [];
  }
}

export async function markOutboxItemSynced(id: string): Promise<void> {
  const db = await getOfflineDB();
  const item = await db.get('outbox', id);
  if (item) {
    item.synced = true;
    item.isConflict = false;
    await db.put('outbox', item);
  }
}

export async function markOutboxItemConflict(id: string, reason: string): Promise<void> {
  const db = await getOfflineDB();
  const item = await db.get('outbox', id);
  if (item) {
    item.isConflict = true;
    item.conflictReason = reason;
    await db.put('outbox', item);
  }
}

export async function cachePatientSchedule(
  patientId: string,
  medications: any[],
  version: number = 1
): Promise<void> {
  try {
    const db = await getOfflineDB();
    await db.put('schedules_cache', {
      patientId,
      medications,
      version,
      cachedAt: new Date().toISOString(),
    });
    await setLastSyncedTimestamp(patientId, new Date().toISOString());
  } catch (e) {
    console.warn('Failed caching schedule:', e);
  }
}

export async function getCachedPatientSchedule(patientId: string): Promise<any[] | null> {
  try {
    const db = await getOfflineDB();
    const cache = await db.get('schedules_cache', patientId);
    return cache ? cache.medications : null;
  } catch (e) {
    return null;
  }
}

export async function cachePatientAppointments(
  patientId: string,
  appointments: any[]
): Promise<void> {
  try {
    const db = await getOfflineDB();
    await db.put('appointments_cache', {
      patientId,
      appointments,
      cachedAt: new Date().toISOString(),
    });
    await setLastSyncedTimestamp(patientId, new Date().toISOString());
  } catch (e) {
    console.warn('Failed caching appointments:', e);
  }
}

export async function getCachedPatientAppointments(patientId: string): Promise<any[] | null> {
  try {
    const db = await getOfflineDB();
    const cache = await db.get('appointments_cache', patientId);
    return cache ? cache.appointments : null;
  } catch (e) {
    return null;
  }
}

export async function setLastSyncedTimestamp(patientId: string, timestamp: string): Promise<void> {
  try {
    const db = await getOfflineDB();
    await db.put('sync_meta', {
      key: `last_synced_${patientId}`,
      value: timestamp,
    });
  } catch (e) {
    console.warn('Failed setting last sync timestamp:', e);
  }
}

export async function getLastSyncedTimestamp(patientId: string): Promise<string | null> {
  try {
    const db = await getOfflineDB();
    const meta = await db.get('sync_meta', `last_synced_${patientId}`);
    return meta ? meta.value : null;
  } catch (e) {
    return null;
  }
}

/**
 * Security: purge ALL locally cached PHI (outbox, medication schedules,
 * appointments, sync metadata) on sign-out. On shared devices this prevents
 * the next user from reading a previous patient's cached data without a login.
 */
export async function purgeOfflineData(): Promise<void> {
  try {
    const db = await getOfflineDB();
    const tx = db.transaction(['outbox', 'schedules_cache', 'appointments_cache', 'sync_meta'], 'readwrite');
    await Promise.all([
      tx.objectStore('outbox').clear(),
      tx.objectStore('schedules_cache').clear(),
      tx.objectStore('appointments_cache').clear(),
      tx.objectStore('sync_meta').clear(),
    ]);
    await tx.done;
  } catch (e) {
    console.warn('Failed purging offline cache:', e);
  }
}
