'use client';

import React, { useState, useEffect } from 'react';
import {
  Users,
  Heart,
  Calendar,
  Clock,
  Activity,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  PlusCircle,
  Printer,
  ChevronRight,
  ArrowRight,
  Phone,
  CheckSquare,
  Sparkles,
} from 'lucide-react';
import { PatientProfile } from '@/types/patient';
import { ExpectedDose, Medication } from '@/types/medication';
import { CaregiverTask } from '@/types/task';
import { CaregiverHandover } from '@/types/handover';
import { CareCircleMember } from '@/types/auth';
import { Button } from '@/components/ui/button';
import { EmergencyCareCard } from '@/components/emergency/EmergencyCareCard';
import { VitalsLoggerModal } from './VitalsLoggerModal';
import { IncidentReportModal } from './IncidentReportModal';
import { queueMedicationAction, markOutboxItemSynced, getPendingOutbox } from '@/lib/offline/idb-outbox';
import { auth } from '@/lib/firebase/client';

interface CaregiverShiftWorkspaceProps {
  patient: PatientProfile;
  patientsList?: PatientProfile[];
  onSelectPatient?: (patient: PatientProfile) => void;
  doses: ExpectedDose[];
  medications: Medication[];
  tasks: CaregiverTask[];
  handovers: CaregiverHandover[];
  members: CareCircleMember[];
  onRefreshData?: () => void;
}

export function CaregiverShiftWorkspace({
  patient,
  patientsList = [],
  onSelectPatient,
  doses = [],
  medications = [],
  tasks = [],
  handovers = [],
  members = [],
  onRefreshData,
}: CaregiverShiftWorkspaceProps) {
  // Modals
  const [showVitalsModal, setShowVitalsModal] = useState<boolean>(false);
  const [showIncidentModal, setShowIncidentModal] = useState<boolean>(false);
  const [showEmergencyCardModal, setShowEmergencyCardModal] = useState<boolean>(false);
  const [showInitiateHandoverModal, setShowInitiateHandoverModal] = useState<boolean>(false);

  // Shift & Task Action States
  const [isOnDuty, setIsOnDuty] = useState<boolean>(true);
  const [activeShiftTime, setActiveShiftTime] = useState<string>('08:00 - 16:00 (Day Shift)');
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [acceptingHandoverId, setAcceptingHandoverId] = useState<string | null>(null);
  const [handoverSuccess, setHandoverSuccess] = useState<string>('');
  const [actionMessage, setActionMessage] = useState<string>('');

  // Handover Initiation Form State
  const [receivingCaregiverUid, setReceivingCaregiverUid] = useState<string>('');
  const [conditionSummary, setConditionSummary] = useState<string>('');
  const [handoverTasksNotes, setHandoverTasksNotes] = useState<string>('');
  const [initiateLoading, setInitiateLoading] = useState<boolean>(false);
  const [initiateError, setInitiateError] = useState<string>('');

  // Pending Handover awaiting incoming caregiver acknowledgement
  const currentUid = auth.currentUser?.uid;
  const pendingIncomingHandover = handovers.find(
    (h) => h.status === 'pending_acknowledgement' && h.receivingCaregiverUid === currentUid
  );

  // Active tasks for today
  const pendingTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');

  // Caregivers available for handover (excluding current user)
  const availableCaregivers = members.filter(
    (m) => (m.role === 'caregiver' || m.role === 'primary_family') && m.userId !== currentUid
  );

  // Quick 1-Tap Medication Action (TAKEN)
  const handleQuickDoseConfirm = async (dose: ExpectedDose) => {
    try {
      const outboxItem = await queueMedicationAction(
        patient.id,
        dose.medicationId,
        dose.medicationName,
        dose.dosage,
        dose.scheduledDate,
        dose.scheduledTime,
        'TAKEN'
      );

      setActionMessage(`Recorded TAKEN for ${dose.medicationName}`);

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        const user = auth.currentUser;
        if (user) {
          const token = await user.getIdToken();
          const res = await fetch(`/api/patients/${patient.id}/medications/events`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              actionId: outboxItem.id,
              medicationId: dose.medicationId,
              scheduledDate: dose.scheduledDate,
              scheduledTime: dose.scheduledTime,
              status: 'TAKEN',
              clientTimestamp: outboxItem.clientTimestamp,
              source: 'online',
            }),
          });
          if (res.ok) {
            await markOutboxItemSynced(outboxItem.id);
          }
        }
      }

      if (onRefreshData) onRefreshData();
      setTimeout(() => setActionMessage(''), 3000);
    } catch (e) {
      console.error('Failed dose confirmation:', e);
    }
  };

  // Complete a Task
  const handleCompleteTask = async (taskId: string) => {
    setCompletingTaskId(taskId);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');
      const token = await user.getIdToken();

      const res = await fetch(`/api/patients/${patient.id}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: 'completed',
          notes: 'Completed during active caregiver shift.',
        }),
      });

      if (res.ok) {
        setActionMessage('Caregiver task marked as completed!');
        if (onRefreshData) onRefreshData();
      }
    } catch (e) {
      console.error('Failed completing task:', e);
    } finally {
      setCompletingTaskId(null);
      setTimeout(() => setActionMessage(''), 3000);
    }
  };

  // Incoming Caregiver Handover Acceptance
  const handleAcceptHandover = async (handoverId: string) => {
    setAcceptingHandoverId(handoverId);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');
      const token = await user.getIdToken();

      const res = await fetch(`/api/patients/${patient.id}/handovers/${handoverId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'acknowledge',
          acknowledgementNotes: 'Shift responsibility accepted. Reviewed elder vitals and pending tasks.',
        }),
      });

      if (res.ok) {
        setHandoverSuccess('Handover officially accepted! You are now the on-duty caregiver.');
        if (onRefreshData) onRefreshData();
      }
    } catch (e) {
      console.error('Failed accepting handover:', e);
    } finally {
      setAcceptingHandoverId(null);
      setTimeout(() => setHandoverSuccess(''), 4000);
    }
  };

  // Initiate Outgoing Handover
  const handleInitiateHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    setInitiateError('');
    setInitiateLoading(true);

    try {
      if (!receivingCaregiverUid) {
        throw new Error('Please select an incoming caregiver');
      }

      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');
      const token = await user.getIdToken();

      const payload = {
        receivingCaregiverUid,
        shiftStartTime: '08:00',
        shiftEndTime: '16:00',
        patientConditionSummary: conditionSummary.trim(),
        pendingTasksNotes: handoverTasksNotes.trim() || undefined,
      };

      const res = await fetch(`/api/patients/${patient.id}/handovers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed initiating handover');
      }

      setHandoverSuccess('Shift handover initiated! Awaiting incoming caregiver acceptance.');
      setShowInitiateHandoverModal(false);
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      setInitiateError(err.message || 'Failed initiating handover');
    } finally {
      setInitiateLoading(false);
      setTimeout(() => setHandoverSuccess(''), 4000);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto px-2 sm:px-4 pb-20">
      {/* Active Shift Header Banner */}
      <div className="p-4 sm:p-5 rounded-2xl bg-slate-900 text-white shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-black uppercase tracking-widest text-emerald-400">
              Caregiver Shift Workspace
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 font-mono text-slate-300">
              {handovers[0]
                ? `${handovers[0].shiftStartTime} - ${handovers[0].shiftEndTime} (${handovers[0].status === 'acknowledged' ? 'Active Shift' : 'Handover Pending'})`
                : 'Current Shift'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black mt-1">
            Active Care: {patient.fullName}
          </h1>
          <p className="text-xs text-slate-400 font-medium">
            Blood Group: {patient.bloodGroup} • Emergency Direct Dial:{' '}
            {patient.emergencyContact?.phone || 'None listed'}
          </p>
        </div>

        {/* Patient Switcher & Quick Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {patientsList.length > 1 && onSelectPatient && (
            <select
              value={patient.id}
              onChange={(e) => {
                const found = patientsList.find((p) => p.id === e.target.value);
                if (found) onSelectPatient(found);
              }}
              className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-white outline-none min-h-[44px]"
            >
              {patientsList.map((p) => (
                <option key={p.id} value={p.id}>
                  Switch: {p.fullName}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={() => setShowEmergencyCardModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition min-h-[44px] cursor-pointer"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Emergency Card</span>
          </button>
        </div>
      </div>

      {/* Action / Feedback Banner */}
      {actionMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-black flex items-center gap-2 shadow-sm animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* Incoming Handover Acceptance Alert Banner */}
      {pendingIncomingHandover && (
        <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 border-2 border-amber-300 shadow-md space-y-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-amber-900 flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-amber-600" />
              Incoming Shift Handover Awaiting Your Acceptance
            </span>
            <span className="text-xs font-bold text-amber-800">Duty Transfer</span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-amber-200 text-xs space-y-1 text-slate-800">
            <div className="font-bold">
              Outgoing Caregiver: {pendingIncomingHandover.givingCaregiverName}
            </div>
            <p className="text-slate-600 italic">
              &quot;{pendingIncomingHandover.patientConditionSummary}&quot;
            </p>
            {pendingIncomingHandover.notes && (
              <p className="text-slate-700 font-medium">
                Pending Tasks / Notes: {pendingIncomingHandover.notes}
              </p>
            )}
          </div>

          <Button
            onClick={() => handleAcceptHandover(pendingIncomingHandover.id)}
            isLoading={acceptingHandoverId === pendingIncomingHandover.id}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm min-h-[48px]"
          >
            Accept Handover & Assume Shift Responsibility
          </Button>
        </div>
      )}

      {handoverSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-100 border border-emerald-300 text-emerald-950 text-xs font-black flex items-center gap-2 shadow-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{handoverSuccess}</span>
        </div>
      )}

      {/* Primary Shift Quickpad Actions Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => setShowVitalsModal(true)}
          className="flex flex-col items-center justify-center p-4 rounded-2xl bg-white border-2 border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50/50 shadow-sm transition min-h-[88px] cursor-pointer group"
        >
          <Activity className="w-6 h-6 text-emerald-600 mb-1 group-hover:scale-110 transition" />
          <span className="text-xs font-black text-slate-900">Log Vitals</span>
          <span className="text-[10px] text-slate-500 font-semibold">BP, Sugar, SpO2</span>
        </button>

        <button
          onClick={() => setShowIncidentModal(true)}
          className="flex flex-col items-center justify-center p-4 rounded-2xl bg-white border-2 border-rose-200 hover:border-rose-400 hover:bg-rose-50/50 shadow-sm transition min-h-[88px] cursor-pointer group"
        >
          <ShieldAlert className="w-6 h-6 text-rose-600 mb-1 group-hover:scale-110 transition" />
          <span className="text-xs font-black text-slate-900">Report Observation</span>
          <span className="text-[10px] text-slate-500 font-semibold">Fall, Mood, Pain</span>
        </button>

        <button
          onClick={() => setShowInitiateHandoverModal(true)}
          className="flex flex-col items-center justify-center p-4 rounded-2xl bg-white border-2 border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/50 shadow-sm transition min-h-[88px] cursor-pointer group"
        >
          <RotateCcw className="w-6 h-6 text-indigo-600 mb-1 group-hover:scale-110 transition" />
          <span className="text-xs font-black text-slate-900">Initiate Handover</span>
          <span className="text-[10px] text-slate-500 font-semibold">Transfer Shift</span>
        </button>

        <a
          href={patient.emergencyContact?.phone ? `tel:${patient.emergencyContact.phone}` : '#'}
          className="flex flex-col items-center justify-center p-4 rounded-2xl bg-white border-2 border-blue-200 hover:border-blue-400 hover:bg-blue-50/50 shadow-sm transition min-h-[88px] cursor-pointer group"
        >
          <Phone className="w-6 h-6 text-blue-600 mb-1 group-hover:scale-110 transition" />
          <span className="text-xs font-black text-slate-900">Call Family</span>
          <span className="text-[10px] text-slate-500 font-semibold">
            {patient.emergencyContact?.name || 'Emergency'}
          </span>
        </a>
      </div>

      {/* Two Column Workboard: Medications Checklist & Shift Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Column 1: Today's Medication Checklist (1-Tap Took Confirmation) */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <Heart className="w-5 h-5 text-rose-600" />
              <h2 className="text-base font-black text-slate-900">Medication Administration</h2>
            </div>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
              {doses.filter((d) => d.status === 'TAKEN').length}/{doses.length} Taken
            </span>
          </div>

          {doses.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              No medications scheduled for today.
            </p>
          ) : (
            <div className="space-y-2.5">
              {doses.map((dose) => (
                <div
                  key={dose.doseKey}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition ${
                    dose.status === 'TAKEN'
                      ? 'border-emerald-200 bg-emerald-50/40'
                      : dose.status === 'SKIPPED'
                      ? 'border-amber-200 bg-amber-50/40'
                      : dose.status === 'MISSED'
                      ? 'border-rose-200 bg-rose-50/40'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-xs bg-slate-900 text-white px-2 py-1 rounded">
                      {dose.scheduledTime}
                    </span>
                    <div>
                      <span className="font-bold text-xs text-slate-900 block">
                        {dose.medicationName}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {dose.dosage} ({dose.form})
                      </span>
                    </div>
                  </div>

                  {dose.status === 'UNCONFIRMED' ? (
                    <button
                      onClick={() => handleQuickDoseConfirm(dose)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-sm min-h-[38px] cursor-pointer"
                    >
                      Took Dose
                    </button>
                  ) : (
                    <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      {dose.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Column 2: Shift Caregiver Tasks */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-blue-600" />
              <h2 className="text-base font-black text-slate-900">Shift Caregiver Tasks</h2>
            </div>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-800">
              {pendingTasks.length} Pending
            </span>
          </div>

          {pendingTasks.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-1" />
              <p className="text-xs font-bold text-slate-700">All shift tasks are complete</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {pendingTasks.map((task) => (
                <div
                  key={task.id}
                  className="p-3 rounded-xl border border-slate-200 bg-white flex items-center justify-between gap-3 shadow-sm"
                >
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-900 block">{task.title}</span>
                    <span className="text-[11px] text-slate-500 font-medium">
                      Assigned by: {task.assignedByName} • Due: {task.dueDate}
                    </span>
                  </div>

                  <button
                    onClick={() => handleCompleteTask(task.id)}
                    disabled={completingTaskId === task.id}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition min-h-[38px] cursor-pointer shrink-0"
                  >
                    {completingTaskId === task.id ? 'Saving...' : 'Mark Done'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal: Initiate Shift Handover */}
      {showInitiateHandoverModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl my-8 relative">
            <div className="flex items-center justify-between border-b pb-3 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
                  <RotateCcw className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900">Initiate Shift Handover</h3>
                  <p className="text-xs text-slate-500">Transfer care duty to incoming caregiver</p>
                </div>
              </div>
              <button
                onClick={() => setShowInitiateHandoverModal(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            {initiateError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
                {initiateError}
              </div>
            )}

            <form onSubmit={handleInitiateHandover} className="space-y-4 text-xs font-semibold text-slate-800">
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
                  Incoming Receiving Caregiver
                </label>
                <select
                  required
                  value={receivingCaregiverUid}
                  onChange={(e) => setReceivingCaregiverUid(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500 min-h-[48px] bg-white"
                >
                  <option value="">Select incoming caregiver...</option>
                  {availableCaregivers.map((cg) => (
                    <option key={cg.userId} value={cg.userId}>
                      {cg.displayName} ({cg.role.replace('_', ' ')})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
                  Patient Condition & Shift Summary
                </label>
                <textarea
                  required
                  rows={3}
                  value={conditionSummary}
                  onChange={(e) => setConditionSummary(e.target.value)}
                  placeholder="Summary of patient status during shift..."
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
                  Pending Tasks for Incoming Shift (Optional)
                </label>
                <textarea
                  rows={2}
                  value={handoverTasksNotes}
                  onChange={(e) => setHandoverTasksNotes(e.target.value)}
                  placeholder="Notes on tasks for next shift..."
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex gap-3 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowInitiateHandoverModal(false)}
                  className="flex-1 min-h-[48px]"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  isLoading={initiateLoading}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 min-h-[48px]"
                >
                  Submit Handover
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Vitals Logger Modal */}
      <VitalsLoggerModal
        isOpen={showVitalsModal}
        onClose={() => setShowVitalsModal(false)}
        patientId={patient.id}
        patientName={patient.fullName}
        onSuccess={onRefreshData}
      />

      {/* Incident Report Modal */}
      <IncidentReportModal
        isOpen={showIncidentModal}
        onClose={() => setShowIncidentModal(false)}
        patientId={patient.id}
        patientName={patient.fullName}
        onSuccess={onRefreshData}
      />

      {/* Emergency Care Card Modal */}
      {showEmergencyCardModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-4 sm:p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-black text-slate-900">Emergency Care Continuity Card</h3>
              <button
                onClick={() => setShowEmergencyCardModal(false)}
                className="text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
            <EmergencyCareCard patient={patient} medications={medications} />
          </div>
        </div>
      )}
    </div>
  );
}
