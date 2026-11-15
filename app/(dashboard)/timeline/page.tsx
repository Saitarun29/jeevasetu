'use client';

import { useState, useEffect } from 'react';
import { CareEvent } from '@/types/timeline';
import { auth } from '@/lib/firebase/client';
import { SyncStatusBadge } from '@/components/offline/SyncStatusBadge';
import { SeniorModeToggle } from '@/components/elderly/SeniorModeToggle';
import {
  Clock,
  Pill,
  Calendar,
  UserCheck,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileText,
  User,
  Filter,
} from 'lucide-react';

export default function TimelinePage() {
  const [events, setEvents] = useState<CareEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [category, setCategory] = useState<string>('all');
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [patients, setPatients] = useState<any[]>([]);

  useEffect(() => {
    loadPatients();
  }, []);

  useEffect(() => {
    if (selectedPatientId) {
      loadTimeline(selectedPatientId, category);
    }
  }, [selectedPatientId, category]);

  const loadPatients = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const res = await fetch('/api/patients', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPatients(data.patients || []);
        if (data.patients && data.patients.length > 0) {
          setSelectedPatientId(data.patients[0].id);
        }
      }
    } catch (e) {
      console.warn('Failed loading patients for timeline:', e);
    }
  };

  const loadTimeline = async (patientId: string, cat: string) => {
    setLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const url =
        cat === 'all'
          ? `/api/patients/${patientId}/timeline`
          : `/api/patients/${patientId}/timeline?category=${cat}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch (e) {
      console.warn('Failed loading timeline events:', e);
    } finally {
      setLoading(false);
    }
  };

  const getEventIcon = (type: string) => {
    if (type.startsWith('MEDICATION_TAKEN')) {
      return <CheckCircle className="w-5 h-5 text-emerald-600" />;
    }
    if (type.startsWith('MEDICATION_SKIPPED') || type.startsWith('MEDICATION_MISSED')) {
      return <AlertTriangle className="w-5 h-5 text-amber-600" />;
    }
    if (type.startsWith('MEDICATION')) {
      return <Pill className="w-5 h-5 text-sky-600" />;
    }
    if (type.startsWith('APPOINTMENT')) {
      return <Calendar className="w-5 h-5 text-purple-600" />;
    }
    if (type.startsWith('HANDOVER')) {
      return <UserCheck className="w-5 h-5 text-indigo-600" />;
    }
    return <FileText className="w-5 h-5 text-slate-600" />;
  };

  const formatTimestamp = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-6 h-6 text-sky-600" />
            Shared Care Timeline
          </h1>
          <p className="text-sm text-slate-600">
            Append-only chronological audit log of all care events with verified actor attribution.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SyncStatusBadge patientId={selectedPatientId} />
          <SeniorModeToggle />
        </div>
      </div>

      {/* Patient Selector & Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-lg border shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase">Patient:</span>
          <select
            value={selectedPatientId}
            onChange={(e) => setSelectedPatientId(e.target.value)}
            className="text-sm font-semibold text-slate-900 border rounded px-2.5 py-1.5 bg-slate-50"
          >
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          {['all', 'medication', 'appointment', 'continuity'].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-colors ${
                category === cat
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline Stream */}
      {loading ? (
        <div className="p-12 text-center text-slate-500 text-sm">Loading care event history...</div>
      ) : events.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center text-slate-500">
          <Clock className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <p className="text-sm font-medium">No care events recorded in this category yet.</p>
        </div>
      ) : (
        <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
          {events.map((ev) => (
            <div key={ev.id} className="relative flex items-start gap-4 group">
              <div className="absolute -left-6 mt-1 w-6 h-6 rounded-full bg-white border-2 border-slate-300 flex items-center justify-center group-hover:border-sky-500 shadow-sm">
                {getEventIcon(ev.eventType)}
              </div>

              <div className="flex-1 bg-white border rounded-lg p-4 shadow-sm hover:border-slate-300 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {ev.eventType.replace(/_/g, ' ')}
                    </span>
                    <h3 className="text-sm font-semibold text-slate-900 mt-0.5">{ev.action}</h3>
                  </div>
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    {formatTimestamp(ev.serverTimestamp)}
                  </span>
                </div>

                <div className="mt-2.5 pt-2 border-t flex items-center justify-between text-xs text-slate-600">
                  <div className="flex items-center gap-1.5 font-medium">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      {ev.actorName} ({ev.actorRole.replace('_', ' ')})
                    </span>
                  </div>
                  <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[11px] font-mono">
                    {ev.source}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
