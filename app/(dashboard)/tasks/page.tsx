'use client';

import { useState, useEffect } from 'react';
import { CaregiverTask } from '@/types/task';
import { CaregiverHandover } from '@/types/handover';
import { CareGap } from '@/types/care-gap';
import { auth } from '@/lib/firebase/client';
import { SyncStatusBadge } from '@/components/offline/SyncStatusBadge';
import { SeniorModeToggle } from '@/components/elderly/SeniorModeToggle';
import {
  CheckSquare,
  UserCheck,
  AlertOctagon,
  Plus,
  Clock,
  CheckCircle,
  AlertTriangle,
  User,
  ShieldAlert,
} from 'lucide-react';

export default function TasksAndHandoverPage() {
  const [patients, setPatients] = useState<any[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [tasks, setTasks] = useState<CaregiverTask[]>([]);
  const [handovers, setHandovers] = useState<CaregiverHandover[]>([]);
  const [gaps, setGaps] = useState<CareGap[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [members, setMembers] = useState<any[]>([]);

  // Task creation state
  const [showTaskModal, setShowTaskModal] = useState<boolean>(false);
  const [taskTitle, setTaskTitle] = useState<string>('');
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [taskDueDate, setTaskDueDate] = useState<string>('');
  const [taskAssigneeUid, setTaskAssigneeUid] = useState<string>('');

  // Handover state
  const [showHandoverModal, setShowHandoverModal] = useState<boolean>(false);
  const [handoverReceiverUid, setHandoverReceiverUid] = useState<string>('');
  const [handoverNotes, setHandoverNotes] = useState<string>('');
  const [patientCondition, setPatientCondition] = useState<string>('');
  const [shiftStart, setShiftStart] = useState<string>('08:00');
  const [shiftEnd, setShiftEnd] = useState<string>('20:00');

  useEffect(() => {
    loadPatients();
  }, []);

  useEffect(() => {
    if (selectedPatientId) {
      loadData(selectedPatientId);
    }
  }, [selectedPatientId]);

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
      console.warn('Failed loading patients:', e);
    }
  };

  const loadData = async (patientId: string) => {
    setLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const headers = { Authorization: `Bearer ${token}` };

      const [tasksRes, handoversRes, gapsRes, membersRes] = await Promise.all([
        fetch(`/api/patients/${patientId}/tasks`, { headers }),
        fetch(`/api/patients/${patientId}/handovers`, { headers }),
        fetch(`/api/patients/${patientId}/gaps`, { headers }),
        fetch(`/api/patients/${patientId}/members`, { headers }),
      ]);

      if (tasksRes.ok) setTasks((await tasksRes.json()).tasks || []);
      if (handoversRes.ok) setHandovers((await handoversRes.json()).handovers || []);
      if (gapsRes.ok) setGaps((await gapsRes.json()).gaps || []);
      if (membersRes.ok) {
        const mData = await membersRes.json();
        setMembers(mData.members || []);
        if (mData.members?.length > 0) {
          setTaskAssigneeUid(mData.members[0].userId);
          setHandoverReceiverUid(mData.members[0].userId);
        }
      }
    } catch (e) {
      console.warn('Failed loading continuity data:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const assignee = members.find((m) => m.userId === taskAssigneeUid);

      const res = await fetch(`/api/patients/${selectedPatientId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: taskTitle,
          priority: taskPriority,
          dueDate: taskDueDate,
          assignedToUid: taskAssigneeUid,
          assignedToName: assignee?.displayName || 'Caregiver',
        }),
      });

      if (res.ok) {
        setShowTaskModal(false);
        setTaskTitle('');
        await loadData(selectedPatientId);
      }
    } catch (e) {
      console.warn('Task creation failed:', e);
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();

      const res = await fetch(`/api/patients/${selectedPatientId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'completed' }),
      });

      if (res.ok) {
        await loadData(selectedPatientId);
      }
    } catch (e) {
      console.warn('Task completion failed:', e);
    }
  };

  const handleInitiateHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const receiver = members.find((m) => m.userId === handoverReceiverUid);

      const res = await fetch(`/api/patients/${selectedPatientId}/handovers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          receivingCaregiverUid: handoverReceiverUid,
          receivingCaregiverName: receiver?.displayName || 'Incoming Caregiver',
          shiftStartTime: shiftStart,
          shiftEndTime: shiftEnd,
          notes: handoverNotes,
          patientConditionSummary: patientCondition,
          pendingTasksSummary: tasks.filter((t) => t.status === 'pending').map((t) => t.title),
        }),
      });

      if (res.ok) {
        setShowHandoverModal(false);
        setHandoverNotes('');
        setPatientCondition('');
        await loadData(selectedPatientId);
      }
    } catch (e) {
      console.warn('Handover initiation failed:', e);
    }
  };

  const handleAcknowledgeHandover = async (handoverId: string) => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();

      const res = await fetch(`/api/patients/${selectedPatientId}/handovers/${handoverId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'acknowledge' }),
      });

      if (res.ok) {
        await loadData(selectedPatientId);
      }
    } catch (e) {
      console.warn('Handover acknowledgement failed:', e);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <UserCheck className="w-6 h-6 text-indigo-600" />
            Care Continuity & Handover
          </h1>
          <p className="text-sm text-slate-600">
            Caregiver assignments, explicit shift handovers, and real-time care gap alerts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SyncStatusBadge patientId={selectedPatientId} />
          <SeniorModeToggle />
        </div>
      </div>

      {/* Patient Selector */}
      <div className="flex items-center gap-3 bg-white p-3 rounded-lg border shadow-sm">
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

      {/* Care Gap Detector Alert Banner */}
      {gaps.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-amber-900 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-600" />
              Care Gap Detector ({gaps.length} unresolved items)
            </span>
            <span className="text-xs font-bold text-amber-800">Requires Attention</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {gaps.map((gap) => (
              <div
                key={gap.id}
                className="bg-white border rounded-lg p-3 shadow-sm flex items-start gap-3"
              >
                <AlertTriangle
                  className={`w-5 h-5 mt-0.5 ${
                    gap.severity === 'critical' ? 'text-red-600' : 'text-amber-500'
                  }`}
                />
                <div>
                  <h4 className="text-sm font-bold text-slate-900">{gap.title}</h4>
                  <p className="text-xs text-slate-600 mt-0.5">{gap.description}</p>
                  <p className="text-xs font-semibold text-sky-700 mt-1">
                    Action: {gap.actionRequired}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Grid: Tasks & Handovers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Caregiver Tasks Column */}
        <div className="bg-white rounded-xl border p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-sky-600" />
              <h2 className="text-base font-bold text-slate-900">Caregiver Tasks</h2>
            </div>
            <button
              onClick={() => setShowTaskModal(true)}
              className="flex items-center gap-1.5 text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 rounded-lg shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Assign Task
            </button>
          </div>

          {tasks.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">No active tasks assigned.</div>
          ) : (
            <div className="space-y-2.5">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className={`border rounded-lg p-3 flex items-start justify-between gap-3 ${
                    task.status === 'completed' ? 'bg-slate-50 opacity-60' : 'bg-white'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900">{task.title}</span>
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          task.priority === 'urgent'
                            ? 'bg-red-100 text-red-800'
                            : task.priority === 'high'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {task.priority}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 flex items-center gap-3">
                      <span>Assigned to: {task.assignedToName}</span>
                      <span>Due: {task.dueDate}</span>
                    </div>
                  </div>

                  {task.status !== 'completed' && (
                    <button
                      onClick={() => handleCompleteTask(task.id)}
                      className="text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded"
                    >
                      Done
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Shift Handover Column */}
        <div className="bg-white rounded-xl border p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base font-bold text-slate-900">Shift Handover</h2>
            </div>
            <button
              onClick={() => setShowHandoverModal(true)}
              className="flex items-center gap-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Initiate Handover
            </button>
          </div>

          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2.5 text-xs text-indigo-900 font-medium">
            <strong>Care Invariant:</strong> Shift responsibility remains with outgoing caregiver until receiving caregiver explicitly acknowledges.
          </div>

          {handovers.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">No handovers recorded.</div>
          ) : (
            <div className="space-y-3">
              {handovers.map((ho) => (
                <div key={ho.id} className="border rounded-lg p-3 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">
                      {ho.givingCaregiverName} ➔ {ho.receivingCaregiverName}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        ho.status === 'acknowledged'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800 animate-pulse'
                      }`}
                    >
                      {ho.status.replace('_', ' ')}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded border">
                    {ho.patientConditionSummary}
                  </p>

                  <div className="flex items-center justify-between text-xs pt-1">
                    <span className="text-slate-500">
                      Shift: {ho.shiftStartTime} - {ho.shiftEndTime}
                    </span>
                    {ho.status === 'pending_acknowledgement' && (
                      <button
                        onClick={() => handleAcknowledgeHandover(ho.id)}
                        className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1 rounded shadow-sm"
                      >
                        Acknowledge & Accept
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Task Modal */}
      {showTaskModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleCreateTask}
            className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl"
          >
            <h3 className="text-lg font-bold text-slate-900">Assign Caregiver Task</h3>
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase block mb-1">Title</label>
              <input
                type="text"
                required
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="e.g. Check morning blood pressure"
                className="w-full text-sm border rounded-lg p-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-600 uppercase block mb-1">Priority</label>
                <select
                  value={taskPriority}
                  onChange={(e) => setTaskPriority(e.target.value as any)}
                  className="w-full text-sm border rounded-lg p-2"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 uppercase block mb-1">Due Date</label>
                <input
                  type="date"
                  required
                  value={taskDueDate}
                  onChange={(e) => setTaskDueDate(e.target.value)}
                  className="w-full text-sm border rounded-lg p-2"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase block mb-1">
                Assign Caregiver
              </label>
              <select
                value={taskAssigneeUid}
                onChange={(e) => setTaskAssigneeUid(e.target.value)}
                className="w-full text-sm border rounded-lg p-2"
              >
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName} ({m.role})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowTaskModal(false)}
                className="text-xs font-semibold px-4 py-2 border rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="text-xs font-bold bg-sky-600 text-white px-4 py-2 rounded-lg"
              >
                Save Task
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Handover Modal */}
      {showHandoverModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleInitiateHandover}
            className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl"
          >
            <h3 className="text-lg font-bold text-slate-900">Initiate Shift Handover</h3>
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase block mb-1">
                Incoming Caregiver
              </label>
              <select
                value={handoverReceiverUid}
                onChange={(e) => setHandoverReceiverUid(e.target.value)}
                className="w-full text-sm border rounded-lg p-2"
              >
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName} ({m.role})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase block mb-1">
                Patient Status & Vital Signs
              </label>
              <textarea
                required
                rows={2}
                value={patientCondition}
                onChange={(e) => setPatientCondition(e.target.value)}
                placeholder="Elder had breakfast well, BP 120/80, resting quietly."
                className="w-full text-sm border rounded-lg p-2"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase block mb-1">
                Handover Notes / Instructions
              </label>
              <textarea
                required
                rows={2}
                value={handoverNotes}
                onChange={(e) => setHandoverNotes(e.target.value)}
                placeholder="Give 2pm medication on time. Doctor appointment at 4pm."
                className="w-full text-sm border rounded-lg p-2"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowHandoverModal(false)}
                className="text-xs font-semibold px-4 py-2 border rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="text-xs font-bold bg-indigo-600 text-white px-4 py-2 rounded-lg"
              >
                Initiate Handover
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
