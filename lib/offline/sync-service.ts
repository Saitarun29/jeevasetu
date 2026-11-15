import {
  getPendingOutbox,
  markOutboxItemSynced,
  markOutboxItemConflict,
  setLastSyncedTimestamp,
  OutboxItem,
} from './idb-outbox';

export type SyncState = 'online' | 'offline' | 'syncing' | 'error';

type SyncListener = (state: SyncState, pendingCount: number) => void;

class SyncService {
  private listeners: Set<SyncListener> = new Set();
  private isSyncing = false;
  private currentStatus: SyncState = typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline';

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.currentStatus = 'online';
        this.notify();
        this.syncAll();
      });

      window.addEventListener('offline', () => {
        this.currentStatus = 'offline';
        this.notify();
      });
    }
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    this.notifySingle(listener);
    return () => this.listeners.delete(listener);
  }

  private async notifySingle(listener: SyncListener) {
    const pending = await getPendingOutbox();
    listener(this.currentStatus, pending.length);
  }

  public async notify() {
    const pending = await getPendingOutbox();
    this.listeners.forEach((l) => l(this.currentStatus, pending.length));
  }

  public getStatus(): SyncState {
    return this.currentStatus;
  }

  /**
   * Synchronizes all pending outbox items to the server.
   * Enforces action UUID idempotency, detects stale schedule versions, and prevents double logs.
   */
  public async syncAll(tokenProvider?: () => Promise<string | null>): Promise<{
    synced: number;
    conflicts: number;
    failed: number;
  }> {
    if (typeof window === 'undefined' || !navigator.onLine || this.isSyncing) {
      return { synced: 0, conflicts: 0, failed: 0 };
    }

    this.isSyncing = true;
    this.currentStatus = 'syncing';
    this.notify();

    let synced = 0;
    let conflicts = 0;
    let failed = 0;

    try {
      const pendingItems = await getPendingOutbox();

      for (const item of pendingItems) {
        try {
          let token: string | null = null;
          if (tokenProvider) {
            token = await tokenProvider();
          }

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }

          const response = await fetch(`/api/patients/${item.patientId}/medications/events`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              actionId: item.id, // Authoritative client UUID (must match server `actionId` contract)
              medicationId: item.medicationId,
              status: item.status,
              scheduledDate: item.scheduledDate,
              scheduledTime: item.scheduledTime,
              note: item.note || '',
              source: 'offline_sync',
              expectedVersion: item.expectedVersion,
            }),
          });

          if (response.ok) {
            await markOutboxItemSynced(item.id);
            await setLastSyncedTimestamp(item.patientId, new Date().toISOString());
            synced++;
          } else if (response.status === 409) {
            // Version Conflict Detected: schedule changed while offline
            const errData = await response.json().catch(() => ({}));
            await markOutboxItemConflict(
              item.id,
              errData.error || 'Schedule version conflict: The prescription was modified on the server.'
            );
            conflicts++;
          } else {
            failed++;
          }
        } catch (itemErr) {
          failed++;
        }
      }

      this.currentStatus = navigator.onLine ? 'online' : 'offline';
    } catch (err) {
      this.currentStatus = 'error';
    } finally {
      this.isSyncing = false;
      this.notify();
    }

    return { synced, conflicts, failed };
  }
}

export const syncService = new SyncService();

export async function syncPendingOutbox() {
  const result = await syncService.syncAll();
  return {
    syncedCount: result.synced,
    conflictCount: result.conflicts,
    failedCount: result.failed,
  };
}
