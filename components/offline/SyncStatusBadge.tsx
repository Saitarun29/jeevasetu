'use client';

import { useState, useEffect } from 'react';
import { syncService, SyncState } from '@/lib/offline/sync-service';
import { getLastSyncedTimestamp } from '@/lib/offline/idb-outbox';
import { Wifi, WifiOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { auth } from '@/lib/firebase/client';

export function SyncStatusBadge({ patientId }: { patientId?: string }) {
  const [status, setStatus] = useState<SyncState>('online');
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [isManualSyncing, setIsManualSyncing] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = syncService.subscribe((newStatus, count) => {
      setStatus(newStatus);
      setPendingCount(count);
    });

    if (patientId) {
      getLastSyncedTimestamp(patientId).then(setLastSynced);
    }

    return () => unsubscribe();
  }, [patientId]);

  const handleManualSync = async () => {
    setIsManualSyncing(true);
    await syncService.syncAll(async () => {
      const user = auth.currentUser;
      return user ? user.getIdToken() : null;
    });
    if (patientId) {
      const ts = await getLastSyncedTimestamp(patientId);
      setLastSynced(ts);
    }
    setIsManualSyncing(false);
  };

  const formatLastSync = (iso: string | null) => {
    if (!iso) return 'Not yet synced';
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors shadow-sm"
      role="status"
      aria-live="polite"
    >
      {status === 'online' && pendingCount === 0 && (
        <span className="flex items-center gap-1.5 text-emerald-800 bg-emerald-50 border-emerald-200">
          <Wifi className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
          <span>Synced ({formatLastSync(lastSynced)})</span>
        </span>
      )}

      {status === 'online' && pendingCount > 0 && (
        <div className="flex items-center gap-2 text-amber-800 bg-amber-50 border-amber-200 px-2 py-0.5 rounded-full">
          <RefreshCw
            className={`w-3.5 h-3.5 text-amber-600 ${isManualSyncing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>{pendingCount} pending</span>
          <button
            onClick={handleManualSync}
            disabled={isManualSyncing}
            className="underline font-semibold hover:text-amber-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
            title="Sync pending items now"
          >
            Sync Now
          </button>
        </div>
      )}

      {status === 'offline' && (
        <span className="flex items-center gap-1.5 text-rose-800 bg-rose-50 border-rose-200 px-2 py-0.5 rounded-full font-semibold">
          <WifiOff className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
          <span>Offline Mode ({pendingCount} queued)</span>
        </span>
      )}

      {status === 'syncing' && (
        <span className="flex items-center gap-1.5 text-sky-800 bg-sky-50 border-sky-200 px-2 py-0.5 rounded-full">
          <RefreshCw className="w-3.5 h-3.5 text-sky-600 animate-spin" aria-hidden="true" />
          <span>Syncing changes...</span>
        </span>
      )}

      {status === 'error' && (
        <span className="flex items-center gap-1.5 text-red-800 bg-red-50 border-red-200 px-2 py-0.5 rounded-full">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600" aria-hidden="true" />
          <span>Sync issue</span>
        </span>
      )}
    </div>
  );
}
