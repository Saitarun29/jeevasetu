'use client';

import React, { useState, useEffect } from 'react';
import { OutboxItem, getPendingOutbox, getConflictedOutbox, getOfflineDB } from '@/lib/offline/idb-outbox';
import { syncPendingOutbox } from '@/lib/offline/sync-service';
import { X, RefreshCw, CheckCircle2, AlertTriangle, Clock, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface OfflineQueueDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  patientId?: string;
  onSyncComplete?: () => void;
}

export function OfflineQueueDrawer({
  isOpen,
  onClose,
  patientId,
  onSyncComplete,
}: OfflineQueueDrawerProps) {
  const [pendingItems, setPendingItems] = useState<OutboxItem[]>([]);
  const [conflictItems, setConflictItems] = useState<OutboxItem[]>([]);
  const [allRecent, setAllRecent] = useState<OutboxItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState('');

  const loadItems = async () => {
    try {
      const [pending, conflicts] = await Promise.all([
        getPendingOutbox(patientId),
        getConflictedOutbox(patientId),
      ]);
      setPendingItems(pending);
      setConflictItems(conflicts);

      const db = await getOfflineDB();
      const all = await db.getAll('outbox');
      setAllRecent(all.slice(-10).reverse());
    } catch (e) {
      console.warn('Failed loading offline drawer items:', e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadItems();
    }
  }, [isOpen, patientId]);

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncStatusMsg('Connecting and synchronizing outbox...');
    try {
      const result = await syncPendingOutbox();
      setSyncStatusMsg(
        `Sync completed: ${result.syncedCount} uploaded, ${result.conflictCount} conflicts.`
      );
      await loadItems();
      if (onSyncComplete) onSyncComplete();
    } catch (err: any) {
      setSyncStatusMsg(`Sync failed: ${err.message || 'Network unavailable'}`);
    } finally {
      setIsSyncing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex justify-end">
      <div className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col justify-between overflow-hidden animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
              <Clock className="w-5 h-5 text-brand-600" />
              Offline Sync Outbox
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Locally queued care events stored in IndexedDB
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          {/* Status Message */}
          {syncStatusMsg && (
            <div className="p-3 rounded-xl bg-brand-50 border border-brand-200 text-brand-900 text-xs font-semibold">
              {syncStatusMsg}
            </div>
          )}

          {/* Conflict Warnings */}
          {conflictItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-rose-700 text-xs font-bold uppercase tracking-wide">
                <ShieldAlert className="w-4 h-4" />
                <span>Version Conflicts ({conflictItems.length})</span>
              </div>
              <div className="space-y-2">
                {conflictItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900"
                  >
                    <div className="font-bold flex items-center justify-between">
                      <span>{item.medicationName} ({item.dosage})</span>
                      <span className="px-1.5 py-0.5 rounded bg-rose-200 text-rose-800 text-[10px] font-black">
                        CONFLICT (409)
                      </span>
                    </div>
                    <p className="text-rose-700 mt-1">
                      Reason: {item.conflictReason || 'Prescription schedule was modified on server.'}
                    </p>
                    <span className="text-[10px] text-rose-500 block mt-1 font-mono">
                      Action UUID: {item.id.slice(0, 8)}...
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending Sync Queue */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700 uppercase tracking-wide">
              <span>Pending Replay Queue ({pendingItems.length})</span>
              {pendingItems.length > 0 && (
                <span className="text-amber-600 font-semibold lowercase">waiting for internet</span>
              )}
            </div>

            {pendingItems.length === 0 ? (
              <div className="p-6 rounded-2xl bg-emerald-50/60 border border-emerald-200/80 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-emerald-950">Outbox is clean</h4>
                <p className="text-xs text-emerald-700 mt-0.5">
                  All local care events are confirmed with cloud servers.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900"
                  >
                    <div className="font-bold flex items-center justify-between">
                      <span>{item.medicationName}</span>
                      <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[10px] font-black">
                        {item.status}
                      </span>
                    </div>
                    <div className="text-slate-600 text-[11px] mt-1">
                      Scheduled: {item.scheduledDate} at {item.scheduledTime}
                    </div>
                    {item.note && (
                      <p className="text-slate-600 italic mt-1">&quot;{item.note}&quot;</p>
                    )}
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mt-2 font-mono">
                      <span>UUID: {item.id.slice(0, 8)}...</span>
                      <span>Recorded: {new Date(item.clientTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent History */}
          {allRecent.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-200">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                Recent Outbox Cache (Last 10)
              </h4>
              <div className="space-y-1.5">
                {allRecent.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-slate-50 text-xs text-slate-700"
                  >
                    <div className="flex items-center gap-2">
                      {item.synced ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      ) : item.isConflict ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      )}
                      <span className="font-medium truncate max-w-[180px]">{item.medicationName}</span>
                    </div>
                    <span className="text-[11px] text-slate-500 font-medium">
                      {item.synced ? 'Synced' : item.isConflict ? 'Conflict' : 'Queued'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Drawer Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
          <Button
            onClick={handleManualSync}
            isLoading={isSyncing}
            className="flex-1 text-sm font-bold flex items-center justify-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>Sync Now</span>
          </Button>
          <Button onClick={onClose} variant="outline" className="text-sm">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
