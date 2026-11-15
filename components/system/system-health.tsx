'use client';

import React, { useState, useEffect } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Mail,
  Server,
  ShieldAlert,
  Terminal,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { auth } from '@/lib/firebase/client';
import { SystemHealthMetrics } from '@/types/reminder';

export function SystemHealthCard() {
  const [metrics, setMetrics] = useState<SystemHealthMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();

        const res = await fetch('/api/system/health', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const data = await res.json();
          setMetrics(data.metrics);
        }
      } catch (e) {
        console.warn('Failed fetching health metrics:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchHealth();
  }, []);

  if (loading || !metrics) {
    return null;
  }

  const isConfigured = metrics.providerConfigured;
  const lastRunTime = metrics.lastRunTimestamp
    ? new Date(metrics.lastRunTimestamp).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })
    : 'No runs recorded yet';

  return (
    <Card className="border-slate-200/90 shadow-sm">
      <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <CardTitle className="text-xl flex items-center gap-2">
            <Activity className="w-5 h-5 text-brand-600" />
            <span>Reminder Engine & System Health</span>
          </CardTitle>
          <CardDescription>
            Proactive 5-minute heartbeat monitor, transactional email delivery, and idempotency tracking.
          </CardDescription>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1.5 ${
              metrics.schedulerStatus === 'operational'
                ? 'bg-emerald-100 text-emerald-800'
                : metrics.schedulerStatus === 'degraded'
                ? 'bg-rose-100 text-rose-800'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {metrics.schedulerStatus === 'operational' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            )}
            <span>
              {metrics.schedulerStatus === 'operational'
                ? 'OPERATIONAL'
                : metrics.schedulerStatus === 'degraded'
                ? 'DEGRADED'
                : 'AWAITING RESEND CONFIG'}
            </span>
          </span>
        </div>
      </CardHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
          <span className="text-xs font-bold uppercase text-slate-500 block">Cloud Scheduler</span>
          <span className="text-sm font-bold text-slate-900 block mt-1">Every 5 Minutes</span>
          <span className="text-xs text-slate-400 block mt-0.5">Last: {lastRunTime}</span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
          <span className="text-xs font-bold uppercase text-slate-500 block">Transactional Email</span>
          <span className="text-sm font-bold text-slate-900 block mt-1">
            {isConfigured ? 'Resend Active' : 'API Key Needed'}
          </span>
          <span className="text-xs text-slate-400 block mt-0.5">
            {isConfigured ? 'Direct API' : 'Unconfigured'}
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
          <span className="text-xs font-bold uppercase text-slate-500 block">Reminders Dispatched</span>
          <span className="text-xl font-black text-brand-900 block mt-0.5">
            {metrics.totalSentReminders}
          </span>
          <span className="text-xs text-slate-400 block">Idempotently tracked</span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
          <span className="text-xs font-bold uppercase text-slate-500 block">Delivery Failures</span>
          <span className="text-xl font-black text-rose-900 block mt-0.5">
            {metrics.totalFailedReminders}
          </span>
          <span className="text-xs text-slate-400 block">Bounded retries (max 3)</span>
        </div>
      </div>

      {!isConfigured && (
        <div className="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Production Reminder Setup Required:</p>
            <p className="mt-0.5">
              To send real emails to care circle members, set <code className="bg-amber-100 px-1 py-0.5 rounded font-mono font-bold">RESEND_API_KEY</code> and <code className="bg-amber-100 px-1 py-0.5 rounded font-mono font-bold">CRON_SECRET</code> in Google Cloud Run environment variables. The server avoids fake simulations and strictly tracks unconfigured states.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
