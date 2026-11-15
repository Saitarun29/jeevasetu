'use client';

import React, { useState, useEffect } from 'react';
import {
  Heart,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  Plus,
  RefreshCw,
  Wifi,
  WifiOff,
  ChevronLeft,
  ChevronRight,
  Archive,
  Edit2,
  Calendar,
  Pill,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { auth } from '@/lib/firebase/client';
import {
  queueMedicationAction,
  getPendingOutbox,
  markOutboxItemSynced,
  markOutboxItemConflict,
  cachePatientSchedule,
  getCachedPatientSchedule,
  OutboxItem,
} from '@/lib/offline/idb-outbox';
import { syncService } from '@/lib/offline/sync-service';
import { ExpectedDose, Medication, MedicationCertaintyState } from '@/types/medication';

export default function MedicationsPage() {
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  });

  const [doses, setDoses] = useState<ExpectedDose[]>([]);
  const [metrics, setMetrics] = useState<any>({
    totalScheduled: 0,
    confirmedTaken: 0,
    skipped: 0,
    missed: 0,
    unconfirmed: 0,
    adherencePercentage: 100,
  });

  const [medications, setMedications] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingOutboxCount, setPendingOutboxCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingMed, setEditingMed] = useState<Medication | null>(null);
  const [showSkipModal, setShowSkipModal] = useState<ExpectedDose | null>(null);
  const [skipReason, setSkipReason] = useState('Elder feeling nauseous');
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // Form states for Add/Edit
  const [medName, setMedName] = useState('');
  const [medDosage, setMedDosage] = useState('');
  const [medForm, setMedForm] = useState<any>('tablet');
  const [medInstructions, setMedInstructions] = useState('');
  const [medPrescribedBy, setMedPrescribedBy] = useState('');
  const [medFrequency, setMedFrequency] = useState<'daily' | 'specific_days' | 'as_needed'>('daily');
  const [medTimes, setMedTimes] = useState<string[]>(['08:00', '20:00']);
  const [newTimeInput, setNewTimeInput] = useState('14:00');
  const [medStartDate, setMedStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [medEndDate, setMedEndDate] = useState('');
  const [formError, setFormError] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Online / Offline listeners
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => {
      setIsOnline(true);
      triggerOutboxSync();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [patientId]);

  // Load initial patient context
  useEffect(() => {
    const savedId = localStorage.getItem('jeevasetu_active_patient');
    if (savedId) {
      setPatientId(savedId);
    } else {
      // Fallback: fetch patients list
      const fetchFirstPatient = async () => {
        const user = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        const res = await fetch('/api/patients', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.patients && data.patients.length > 0) {
            setPatientId(data.patients[0].id);
            setPatientName(data.patients[0].fullName);
            localStorage.setItem('jeevasetu_active_patient', data.patients[0].id);
          }
        }
      };
      fetchFirstPatient();
    }
  }, []);

  // Fetch Doses & Medications
  const loadScheduleData = async () => {
    if (!patientId) return;
    setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();

      // Check pending outbox
      const pendingItems = await getPendingOutbox(patientId);
      setPendingOutboxCount(pendingItems.length);

      // Fetch expanded doses for selected date
      const dosesRes = await fetch(`/api/patients/${patientId}/medications/doses?date=${selectedDate}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (dosesRes.ok) {
        const dosesData = await dosesRes.json();
        setDoses(dosesData.doses || []);
        setMetrics(dosesData.metrics || {});
      }

      // Fetch medication definitions
      const medsRes = await fetch(
        `/api/patients/${patientId}/medications?includeArchived=${showArchived}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (medsRes.ok) {
        const medsData = await medsRes.json();
        setMedications(medsData.medications || []);
        // Cache to IndexedDB for offline resilience
        await cachePatientSchedule(patientId, medsData.medications || []);
      }
    } catch (e) {
      console.warn('Network fetch failed, attempting cached schedule:', e);
      // Fallback to IndexedDB cache when offline
      const cached = await getCachedPatientSchedule(patientId);
      if (cached) {
        setMedications(cached);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadScheduleData();
  }, [patientId, selectedDate, showArchived]);

  // Outbox Sync Engine via unified version-aware sync service
  const triggerOutboxSync = async () => {
    if (!patientId || syncing) return;
    setSyncing(true);

    try {
      const user = auth.currentUser;
      const tokenProvider = user ? async () => user.getIdToken() : undefined;
      await syncService.syncAll(tokenProvider);

      const updatedPending = await getPendingOutbox(patientId);
      setPendingOutboxCount(updatedPending.length);
      await loadScheduleData();
    } catch (syncErr) {
      console.error('Sync failed:', syncErr);
    } finally {
      setSyncing(false);
    }
  };

  // Record TAKEN or SKIPPED
  const handleRecordAction = async (
    dose: ExpectedDose,
    status: 'TAKEN' | 'SKIPPED',
    note?: string
  ) => {
    if (!patientId) return;
    const actionKey = `${dose.medicationId}_${dose.scheduledTime}`;
    setActionLoadingKey(actionKey);

    try {
      // 1. Enqueue action in IndexedDB outbox FIRST (authoritative action UUID)
      const expectedVersion = (dose as any).medicationVersion || (dose as any).version || 1;
      const outboxItem = await queueMedicationAction(
        patientId,
        dose.medicationId,
        dose.medicationName,
        dose.dosage,
        dose.scheduledDate,
        dose.scheduledTime,
        status,
        note,
        expectedVersion
      );

      // Optimistically update UI immediately
      setDoses((prev) =>
        prev.map((d) =>
          d.doseKey === dose.doseKey
            ? { ...d, status, event: { ...d.event, status, note, actorName: 'You' } as any }
            : d
        )
      );

      // 2. If online, sync immediately via unified syncService
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        const user = auth.currentUser;
        const tokenProvider = user ? async () => user.getIdToken() : undefined;
        await syncService.syncAll(tokenProvider);
      }

      const remainingPending = await getPendingOutbox(patientId);
      setPendingOutboxCount(remainingPending.length);
      await loadScheduleData();
    } catch (e: any) {
      console.error('Action failed:', e);
    } finally {
      setActionLoadingKey(null);
      setShowSkipModal(null);
    }
  };

  // Open Edit Modal
  const openEditModal = (med: Medication) => {
    setEditingMed(med);
    setMedName(med.name);
    setMedDosage(med.dosage);
    setMedForm(med.form);
    setMedInstructions(med.instructions);
    setMedPrescribedBy(med.prescribedBy || '');
    setMedFrequency(med.frequency);
    setMedTimes(med.times || ['08:00']);
    setMedStartDate(med.startDate);
    setMedEndDate(med.endDate || '');
    setFormError('');
    setShowAddModal(true);
  };

  // Open Create Modal
  const openCreateModal = () => {
    setEditingMed(null);
    setMedName('');
    setMedDosage('');
    setMedForm('tablet');
    setMedInstructions('Take after meals with warm water');
    setMedPrescribedBy('Dr. Sharma');
    setMedFrequency('daily');
    setMedTimes(['08:00', '20:00']);
    setMedStartDate(new Date().toISOString().slice(0, 10));
    setMedEndDate('');
    setFormError('');
    setShowAddModal(true);
  };

  // Submit Add or Edit Schedule
  const handleSubmitSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientId) return;
    setFormError('');
    setFormSubmitting(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');
      const token = await user.getIdToken();

      if (medFrequency !== 'as_needed' && medTimes.length === 0) {
        throw new Error('Please add at least one scheduled dosing time.');
      }

      if (editingMed) {
        // PATCH: Pass expectedVersion to guarantee conflict detection!
        const payload = {
          expectedVersion: editingMed.version,
          name: medName,
          dosage: medDosage,
          form: medForm,
          instructions: medInstructions,
          prescribedBy: medPrescribedBy,
          frequency: medFrequency,
          times: medTimes,
          startDate: medStartDate,
          endDate: medEndDate || null,
        };

        const res = await fetch(`/api/patients/${patientId}/medications/${editingMed.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to update schedule');
        }
      } else {
        // POST: Create medication
        const payload = {
          name: medName,
          dosage: medDosage,
          form: medForm,
          instructions: medInstructions,
          prescribedBy: medPrescribedBy,
          frequency: medFrequency,
          times: medTimes,
          startDate: medStartDate,
          endDate: medEndDate || undefined,
        };

        const res = await fetch(`/api/patients/${patientId}/medications`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to create medication');
        }
      }

      setShowAddModal(false);
      await loadScheduleData();
    } catch (err: any) {
      setFormError(err.message || 'Operation failed');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Archive Medication
  const handleArchive = async (medId: string, name: string) => {
    if (
      !confirm(
        `Archive ${name}? Active schedules will stop, but past medication logs and adherence history will remain permanently preserved.`
      )
    ) {
      return;
    }

    try {
      const user = auth.currentUser;
      if (!user || !patientId) return;
      const token = await user.getIdToken();

      const res = await fetch(`/api/patients/${patientId}/medications/${medId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to archive');
      }

      await loadScheduleData();
    } catch (e: any) {
      alert(e.message || 'Archive failed');
    }
  };

  const handleAddTime = () => {
    if (newTimeInput && !medTimes.includes(newTimeInput)) {
      setMedTimes([...medTimes, newTimeInput].sort());
    }
  };

  const handleRemoveTime = (t: string) => {
    setMedTimes(medTimes.filter((item) => item !== t));
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Top Banner: Network & Offline Outbox Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}
          >
            {isOnline ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-slate-900">
                {isOnline ? 'Online Connection Active' : 'Offline Mode Active'}
              </span>
              {pendingOutboxCount > 0 && (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">
                  {pendingOutboxCount} {pendingOutboxCount === 1 ? 'Action' : 'Actions'} Queued
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 font-medium">
              {pendingOutboxCount > 0
                ? 'Actions saved in local IndexedDB outbox with client UUIDs. Will synchronize safely on reconnect.'
                : 'All medication events synchronized with authoritative care record.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {pendingOutboxCount > 0 && isOnline && (
            <Button
              onClick={triggerOutboxSync}
              isLoading={syncing}
              size="sm"
              variant="outline"
              className="gap-2 text-brand-700 border-brand-300"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Sync Now</span>
            </Button>
          )}

          <Button onClick={openCreateModal} size="md" className="gap-2 shadow-sm">
            <Plus className="w-5 h-5" />
            <span>Add Medication</span>
          </Button>
        </div>
      </div>

      {/* Date Navigator & Adherence Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Medication Adherence Tracker</h1>
          <p className="text-base text-slate-600 font-medium mt-1">
            4-state certainty engine: <span className="font-bold text-emerald-700">TAKEN</span>,{' '}
            <span className="font-bold text-amber-700">SKIPPED</span>,{' '}
            <span className="font-bold text-rose-700">MISSED</span> (2h grace cutoff), and{' '}
            <span className="font-bold text-slate-700">UNCONFIRMED</span>.
          </p>
        </div>

        {/* Date Selector */}
        <div className="flex items-center gap-2 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm">
          <button
            onClick={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() - 1);
              setSelectedDate(d.toISOString().slice(0, 10));
            }}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-700 transition"
            title="Previous Day"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 rounded-xl text-base font-bold text-slate-800 border-0 focus:ring-0 outline-none"
          />

          <button
            onClick={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() + 1);
              setSelectedDate(d.toISOString().slice(0, 10));
            }}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-700 transition"
            title="Next Day"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          <button
            onClick={() => {
              const d = new Date();
              setSelectedDate(
                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
                  d.getDate()
                ).padStart(2, '0')}`
              );
            }}
            className="text-xs px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 transition"
          >
            Today
          </button>
        </div>
      </div>

      {/* Adherence Certainty Metrics Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Metric 1: Taken */}
        <Card className="p-5 border-emerald-200 bg-emerald-50/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">Confirmed Taken</span>
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="mt-3">
            <span className="text-3xl font-black text-emerald-900">{metrics.confirmedTaken || 0}</span>
            <span className="text-xs text-emerald-700 block mt-0.5">Explicit human action</span>
          </div>
        </Card>

        {/* Metric 2: Skipped */}
        <Card className="p-5 border-amber-200 bg-amber-50/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-800">Skipped (Reason)</span>
            <XCircle className="w-5 h-5 text-amber-600" />
          </div>
          <div className="mt-3">
            <span className="text-3xl font-black text-amber-900">{metrics.skipped || 0}</span>
            <span className="text-xs text-amber-700 block mt-0.5">Documented explanation</span>
          </div>
        </Card>

        {/* Metric 3: Missed */}
        <Card className="p-5 border-rose-200 bg-rose-50/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-800">Missed Doses</span>
            <AlertTriangle className="w-5 h-5 text-rose-600" />
          </div>
          <div className="mt-3">
            <span className="text-3xl font-black text-rose-900">{metrics.missed || 0}</span>
            <span className="text-xs text-rose-700 block mt-0.5">Past 2h grace window</span>
          </div>
        </Card>

        {/* Metric 4: Unconfirmed */}
        <Card className="p-5 border-slate-200 bg-slate-50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Unconfirmed</span>
            <HelpCircle className="w-5 h-5 text-slate-400" />
          </div>
          <div className="mt-3">
            <span className="text-3xl font-black text-slate-900">{metrics.unconfirmed || 0}</span>
            <span className="text-xs text-slate-500 block mt-0.5">Scheduled or pending</span>
          </div>
        </Card>

        {/* Metric 5: Daily Adherence */}
        <Card className="p-5 border-brand-200 bg-brand-50/50 col-span-2 lg:col-span-1 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-800">Daily Adherence</span>
            <ShieldCheck className="w-5 h-5 text-brand-600" />
          </div>
          <div className="mt-3">
            <span className="text-3xl font-black text-brand-900">{metrics.adherencePercentage || 0}%</span>
            <span className="text-xs text-brand-700 block mt-0.5">
              {metrics.confirmedTaken} of {metrics.totalScheduled} doses
            </span>
          </div>
        </Card>
      </div>

      {/* Doses Timeline Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <Clock className="w-6 h-6 text-brand-600" />
            <span>Scheduled Doses for {selectedDate}</span>
          </h2>
          <span className="text-sm font-semibold text-slate-500">
            {doses.length} {doses.length === 1 ? 'dose scheduled' : 'doses scheduled'}
          </span>
        </div>

        {doses.length === 0 ? (
          <Card className="text-center py-12">
            <Pill className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-xl font-bold text-slate-800">No scheduled medication doses for this date</h3>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              There are no active prescriptions scheduled for {selectedDate}. Click &quot;Add Medication&quot; above to set up daily or weekly schedules.
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {doses.map((dose) => {
              const actionKey = `${dose.medicationId}_${dose.scheduledTime}`;
              const isActionLoading = actionLoadingKey === actionKey;

              return (
                <Card
                  key={dose.doseKey}
                  className={`p-6 transition border-2 ${
                    dose.status === 'TAKEN'
                      ? 'border-emerald-300 bg-emerald-50/20'
                      : dose.status === 'SKIPPED'
                      ? 'border-amber-300 bg-amber-50/20'
                      : dose.status === 'MISSED'
                      ? 'border-rose-300 bg-rose-50/20'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    {/* Left: Time & Medicine Info */}
                    <div className="flex items-start gap-5">
                      <div className="flex flex-col items-center justify-center w-20 h-20 rounded-2xl bg-slate-900 text-white font-mono shrink-0 shadow-sm">
                        <Clock className="w-5 h-5 text-brand-400 mb-0.5" />
                        <span className="text-xl font-black">{dose.scheduledTime}</span>
                      </div>

                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-2xl font-black text-slate-900">{dose.medicationName}</h3>
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-bold uppercase tracking-wider">
                            {dose.form}
                          </span>
                        </div>

                        <p className="text-lg font-bold text-brand-800 mt-1">{dose.dosage}</p>
                        <p className="text-base text-slate-700 font-medium mt-1">
                          Instructions: {dose.instructions}
                        </p>

                        {dose.prescribedBy && (
                          <p className="text-xs text-slate-500 mt-1">Prescribed by: {dose.prescribedBy}</p>
                        )}

                        {/* Audit Attribution Label */}
                        {dose.event && (
                          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 text-xs text-slate-700 font-medium">
                            <ShieldCheck className="w-4 h-4 text-brand-600" />
                            <span>
                              Recorded by <span className="font-bold">{dose.event.actorName}</span> (
                              {dose.event.actorRole}) • {dose.event.source === 'offline_sync' ? 'Synced Offline' : 'Online'}
                            </span>
                            {dose.event.note && (
                              <span className="font-semibold text-amber-800">
                                — Note: &quot;{dose.event.note}&quot;
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: State Pill & Elderly-Friendly Actions */}
                    <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">
                      {/* State Badges */}
                      {dose.status === 'TAKEN' && (
                        <div className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-emerald-100 text-emerald-800 text-base font-black">
                          <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                          <span>CONFIRMED TAKEN</span>
                        </div>
                      )}

                      {dose.status === 'SKIPPED' && (
                        <div className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-amber-100 text-amber-800 text-base font-black">
                          <XCircle className="w-6 h-6 text-amber-600" />
                          <span>SKIPPED</span>
                        </div>
                      )}

                      {dose.status === 'MISSED' && (
                        <div className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-rose-100 text-rose-800 text-base font-black">
                          <AlertTriangle className="w-6 h-6 text-rose-600" />
                          <span>MISSED (GRACE EXPIRED)</span>
                        </div>
                      )}

                      {/* Large Action Controls (Available when UNCONFIRMED, or can record correction) */}
                      {dose.status === 'UNCONFIRMED' && (
                        <div className="flex items-center gap-3 w-full sm:w-auto">
                          <Button
                            onClick={() => handleRecordAction(dose, 'TAKEN')}
                            isLoading={isActionLoading}
                            size="lg"
                            aria-label={`Mark ${dose.medicationName} scheduled for ${dose.scheduledTime} as taken`}
                            className="flex-1 sm:flex-initial text-lg bg-emerald-600 hover:bg-emerald-700 text-white min-w-[160px] min-h-[52px] shadow-md shadow-emerald-600/20 font-bold"
                          >
                            <CheckCircle2 className="w-6 h-6 mr-2 shrink-0" />
                            <span>Took Dose</span>
                          </Button>

                          <Button
                            onClick={() => setShowSkipModal(dose)}
                            variant="outline"
                            size="lg"
                            aria-label={`Record skip reason for ${dose.medicationName} scheduled for ${dose.scheduledTime}`}
                            className="flex-1 sm:flex-initial text-base border-2 border-amber-400 text-amber-900 bg-amber-50/50 hover:bg-amber-100 min-h-[52px] font-bold"
                          >
                            <XCircle className="w-5 h-5 mr-1.5 shrink-0 text-amber-700" />
                            <span>Skip</span>
                          </Button>
                        </div>
                      )}

                      {/* Override option for MISSED */}
                      {dose.status === 'MISSED' && (
                        <Button
                          onClick={() => handleRecordAction(dose, 'TAKEN', 'Late administration override')}
                          variant="outline"
                          size="sm"
                          className="text-xs text-slate-600 hover:text-emerald-700"
                        >
                          Record Late Administration
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Medication Regimen Management Section */}
      <Card className="mt-12">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Pill className="w-6 h-6 text-brand-600" />
              <span>Prescribed Regimens & Version History</span>
            </CardTitle>
            <CardDescription>
              Active and archived prescriptions. Updates automatically increment version numbers to prevent stale overwrites.
            </CardDescription>
          </div>
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="text-xs px-3 py-1.5 rounded-xl border border-slate-300 font-bold text-slate-700 hover:bg-slate-100 transition"
          >
            {showArchived ? 'Hide Archived' : 'Show Archived Regimens'}
          </button>
        </CardHeader>

        <div className="divide-y divide-slate-100">
          {medications.map((med) => (
            <div key={med.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-lg font-bold text-slate-900">{med.name}</h4>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono font-bold">
                    v{med.version}
                  </span>
                  {med.isArchived && (
                    <span className="text-xs px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold uppercase">
                      Archived
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-600 font-medium mt-0.5">
                  {med.dosage} ({med.form}) • Frequency: <span className="capitalize">{med.frequency}</span> • Times:{' '}
                  {med.times?.join(', ') || 'PRN'}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Instructions: {med.instructions}</p>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                {!med.isArchived && (
                  <>
                    <Button
                      onClick={() => openEditModal(med)}
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                    >
                      <Edit2 className="w-4 h-4" />
                      <span>Edit (v{med.version})</span>
                    </Button>
                    <Button
                      onClick={() => handleArchive(med.id, med.name)}
                      variant="outline"
                      size="sm"
                      className="text-rose-600 border-rose-200 hover:bg-rose-50"
                    >
                      <Archive className="w-4 h-4 mr-1" />
                      <span>Archive</span>
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Modal: Skip Dose Reason */}
      {showSkipModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mb-4">
              <XCircle className="w-6 h-6" />
            </div>

            <h3 className="text-2xl font-black text-slate-900 mb-1">Skip Medication Dose</h3>
            <p className="text-sm text-slate-500 mb-6">
              Record a reason for skipping {showSkipModal.medicationName} ({showSkipModal.scheduledTime}). This explanation will be preserved in the auditable care timeline.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-2">Select Reason</label>
                <select
                  value={skipReason}
                  onChange={(e) => setSkipReason(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base font-semibold focus:ring-2 focus:ring-amber-500 outline-none"
                >
                  <option value="Elder feeling nauseous or unwell">Elder feeling nauseous or unwell</option>
                  <option value="Advised to hold by doctor">Advised to hold by doctor</option>
                  <option value="Elder refused medication">Elder refused medication</option>
                  <option value="Currently asleep / resting">Currently asleep / resting</option>
                  <option value="Fasting for lab blood work">Fasting for lab blood work</option>
                  <option value="Medication out of stock / awaiting refill">Medication out of stock / refill</option>
                  <option value="Other clinical reason">Other clinical reason</option>
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowSkipModal(null)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => handleRecordAction(showSkipModal, 'SKIPPED', skipReason)}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  Confirm Skip
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add / Edit Medication Schedule */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl my-8">
            <h3 className="text-2xl font-black text-slate-900 mb-1">
              {editingMed ? `Edit Medication Schedule (v${editingMed.version})` : 'Add Medication Schedule'}
            </h3>
            <p className="text-sm text-slate-500 mb-6">
              {editingMed
                ? 'Editing will increment the version number to v' +
                  (editingMed.version + 1) +
                  ' and verify against concurrent changes.'
                : 'Define prescribed dosage, scheduled dosing times, and instructions.'}
            </p>

            {formError && (
              <div className="mb-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmitSchedule} className="space-y-4">
              <div>
                <label className="block text-base font-bold text-slate-800 mb-1">Medication Name</label>
                <input
                  type="text"
                  required
                  value={medName}
                  onChange={(e) => setMedName(e.target.value)}
                  placeholder="e.g. Metformin Hydrochloride"
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1">Dosage</label>
                  <input
                    type="text"
                    required
                    value={medDosage}
                    onChange={(e) => setMedDosage(e.target.value)}
                    placeholder="e.g. 500mg, 1 tablet"
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1">Form</label>
                  <select
                    value={medForm}
                    onChange={(e) => setMedForm(e.target.value as any)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                  >
                    <option value="tablet">Tablet</option>
                    <option value="capsule">Capsule</option>
                    <option value="liquid">Liquid / Syrup</option>
                    <option value="injection">Injection</option>
                    <option value="inhaler">Inhaler</option>
                    <option value="topical">Topical Cream</option>
                    <option value="drops">Eye / Ear Drops</option>
                    <option value="patch">Patch</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-base font-bold text-slate-800 mb-1">Prescribed Instructions</label>
                <input
                  type="text"
                  required
                  value={medInstructions}
                  onChange={(e) => setMedInstructions(e.target.value)}
                  placeholder="e.g. Take immediately after breakfast with warm water"
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1">Prescribing Doctor</label>
                  <input
                    type="text"
                    value={medPrescribedBy}
                    onChange={(e) => setMedPrescribedBy(e.target.value)}
                    placeholder="e.g. Dr. Rajesh Sharma"
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1">Frequency</label>
                  <select
                    value={medFrequency}
                    onChange={(e) => setMedFrequency(e.target.value as any)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                  >
                    <option value="daily">Daily Schedule</option>
                    <option value="specific_days">Specific Days</option>
                    <option value="as_needed">As Needed (PRN)</option>
                  </select>
                </div>
              </div>

              {/* Scheduled Times Selection */}
              {medFrequency !== 'as_needed' && (
                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1">
                    Scheduled Dosing Times (24h HH:mm)
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {medTimes.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-100 text-brand-900 font-mono font-bold text-sm"
                      >
                        <span>{t}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveTime(t)}
                          className="text-brand-600 hover:text-brand-900 text-xs font-black"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="time"
                      value={newTimeInput}
                      onChange={(e) => setNewTimeInput(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-slate-300 text-base font-mono"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={handleAddTime}>
                      Add Time
                    </Button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1">Start Date</label>
                  <input
                    type="date"
                    required
                    value={medStartDate}
                    onChange={(e) => setMedStartDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1">End Date (Optional)</label>
                  <input
                    type="date"
                    value={medEndDate}
                    onChange={(e) => setMedEndDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-6 border-t border-slate-100 mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button type="submit" isLoading={formSubmitting} className="flex-1">
                  {editingMed ? 'Save Changes' : 'Create Regimen'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
