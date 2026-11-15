'use client';

import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  User,
  Plus,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Building,
  ShieldCheck,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { auth } from '@/lib/firebase/client';
import { Appointment } from '@/types/appointment';
import { formatAppointmentDateTime } from '@/lib/appointment/engine';
import {
  cachePatientAppointments,
  getCachedPatientAppointments,
} from '@/lib/offline/idb-outbox';

export default function AppointmentsPage() {
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState<string>('');
  const [patientTimezone, setPatientTimezone] = useState<string>('Asia/Kolkata');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'scheduled' | 'completed' | 'cancelled'>('scheduled');

  // Modals
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [showCancelModal, setShowCancelModal] = useState<Appointment | null>(null);
  const [cancellationReason, setCancellationReason] = useState('Doctor rescheduled consultation');
  const [cancelLoading, setCancelLoading] = useState(false);

  // Form states
  const [doctorName, setDoctorName] = useState('');
  const [specialty, setSpecialty] = useState('General Medicine');
  const [clinicName, setClinicName] = useState('');
  const [clinicAddress, setClinicAddress] = useState('');
  const [localDate, setLocalDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2); // Default to 2 days ahead
    return d.toISOString().slice(0, 10);
  });
  const [localTime, setLocalTime] = useState('10:30');
  const [notes, setNotes] = useState('Bring recent prescription and blood report');
  const [accompaniedBy, setAccompaniedBy] = useState('');
  const [email24h, setEmail24h] = useState(true);
  const [email2h, setEmail2h] = useState(true);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Load patient context
  useEffect(() => {
    const savedId = localStorage.getItem('jeevasetu_active_patient');
    if (savedId) {
      setPatientId(savedId);
    } else {
      const fetchPatient = async () => {
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
            setPatientTimezone(data.patients[0].timezone || 'Asia/Kolkata');
            localStorage.setItem('jeevasetu_active_patient', data.patients[0].id);
          }
        }
      };
      fetchPatient();
    }
  }, []);

  const loadAppointments = async () => {
    if (!patientId) return;

    // 1. Read offline cache immediately
    const cached = await getCachedPatientAppointments(patientId);
    if (cached && cached.length > 0) {
      setAppointments(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    // 2. Fetch over network and update cache
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();

      const res = await fetch(`/api/patients/${patientId}/appointments`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        const fresh = data.appointments || [];
        setAppointments(fresh);
        await cachePatientAppointments(patientId, fresh);
      }
    } catch (e) {
      console.warn('Network fetch failed, preserving cached appointments:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAppointments();
  }, [patientId]);

  const openScheduleModal = () => {
    setEditingAppointment(null);
    setDoctorName('');
    setSpecialty('General Medicine');
    setClinicName('');
    setClinicAddress('');
    const d = new Date();
    d.setDate(d.getDate() + 2);
    setLocalDate(d.toISOString().slice(0, 10));
    setLocalTime('10:30');
    setNotes('Bring recent lab reports and fasting sugar reading');
    setAccompaniedBy('Family member');
    setEmail24h(true);
    setEmail2h(true);
    setConflictWarning(null);
    setFormError('');
    setShowScheduleModal(true);
  };

  const openEditModal = (app: Appointment) => {
    setEditingAppointment(app);
    setDoctorName(app.doctorName);
    setSpecialty(app.specialty);
    setClinicName(app.clinicName);
    setClinicAddress(app.clinicAddress);
    setLocalDate(app.localDate);
    setLocalTime(app.localTime);
    setNotes(app.notes || '');
    setAccompaniedBy(app.accompaniedBy || '');
    setEmail24h(app.reminderPreferences?.email24h ?? true);
    setEmail2h(app.reminderPreferences?.email2h ?? true);
    setConflictWarning(null);
    setFormError('');
    setShowScheduleModal(true);
  };

  const handleSubmitAppointment = async (e: React.FormEvent, allowOverride: boolean = false) => {
    e.preventDefault();
    if (!patientId) return;
    setFormError('');
    setConflictWarning(null);
    setFormSubmitting(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');
      const token = await user.getIdToken();

      const payload = {
        doctorName,
        specialty,
        clinicName,
        clinicAddress,
        localDate,
        localTime,
        notes,
        accompaniedBy,
        reminderPreferences: {
          email24h,
          email2h,
        },
        allowConflictOverride: allowOverride,
      };

      let res: Response;
      if (editingAppointment) {
        res = await fetch(`/api/patients/${patientId}/appointments/${editingAppointment.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/patients/${patientId}/appointments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json();

      if (res.status === 409 && data.conflicts) {
        // Conflict detected
        setConflictWarning(data.error);
        setFormSubmitting(false);
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save appointment');
      }

      setShowScheduleModal(false);
      await loadAppointments();
    } catch (err: any) {
      setFormError(err.message || 'Error saving appointment');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleMarkCompleted = async (appointmentId: string) => {
    if (!patientId) return;

    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();

      const res = await fetch(`/api/patients/${patientId}/appointments/${appointmentId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: 'completed' }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to complete appointment');
      }

      await loadAppointments();
    } catch (e: any) {
      alert(e.message || 'Error completing appointment');
    }
  };

  const handleConfirmCancel = async () => {
    if (!patientId || !showCancelModal) return;
    setCancelLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();

      const res = await fetch(`/api/patients/${patientId}/appointments/${showCancelModal.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: 'cancelled',
          cancellationReason,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to cancel appointment');
      }

      setShowCancelModal(null);
      await loadAppointments();
    } catch (e: any) {
      alert(e.message || 'Error cancelling appointment');
    } finally {
      setCancelLoading(false);
    }
  };

  // Filtered appointments
  const filteredAppointments = appointments.filter((app) => {
    if (filter === 'all') return true;
    return app.status === filter;
  });

  const scheduledCount = appointments.filter((a) => a.status === 'scheduled').length;
  const completedCount = appointments.filter((a) => a.status === 'completed').length;
  const cancelledCount = appointments.filter((a) => a.status === 'cancelled').length;

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Doctor Appointments & Visits</h1>
          <p className="text-base text-slate-600 font-medium mt-1">
            Clinical consultations, hospital checkups, and accompaniment tracking.
          </p>
        </div>

        <Button onClick={openScheduleModal} size="lg" className="gap-2 shadow-md shadow-brand-600/20">
          <Plus className="w-5 h-5" />
          <span>Schedule Appointment</span>
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setFilter('scheduled')}
          className={`px-4 py-2 rounded-xl text-base font-bold transition flex items-center gap-2 ${
            filter === 'scheduled'
              ? 'bg-brand-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Upcoming Scheduled ({scheduledCount})</span>
        </button>

        <button
          onClick={() => setFilter('completed')}
          className={`px-4 py-2 rounded-xl text-base font-bold transition flex items-center gap-2 ${
            filter === 'completed'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>Completed Visits ({completedCount})</span>
        </button>

        <button
          onClick={() => setFilter('cancelled')}
          className={`px-4 py-2 rounded-xl text-base font-bold transition flex items-center gap-2 ${
            filter === 'cancelled'
              ? 'bg-rose-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <XCircle className="w-4 h-4" />
          <span>Cancelled ({cancelledCount})</span>
        </button>

        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-xl text-base font-bold transition ${
            filter === 'all'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <span>All History ({appointments.length})</span>
        </button>
      </div>

      {/* Appointments List */}
      {loading ? (
        <div className="py-16 text-center text-slate-500 font-medium" aria-live="polite">
          <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-base text-slate-700 font-semibold">Loading doctor appointments...</p>
        </div>
      ) : filteredAppointments.length === 0 ? (
        <Card className="text-center py-12 px-4 border-dashed border-2 border-slate-300">
          <Calendar className="w-14 h-14 text-brand-300 mx-auto mb-3" />
          <h3 className="text-2xl font-black text-slate-800">No {filter} appointments found</h3>
          <p className="text-base text-slate-600 mt-2 max-w-md mx-auto">
            {filter === 'scheduled'
              ? 'No upcoming doctor visits are currently scheduled. Plan consultations early to prevent gaps in senior care.'
              : `There are no ${filter} appointment records in this patient's history.`}
          </p>
          {filter === 'scheduled' && (
            <div className="mt-6">
              <Button onClick={openScheduleModal} size="lg" className="gap-2 shadow-md">
                <Plus className="w-5 h-5" />
                <span>Schedule First Doctor Visit</span>
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredAppointments.map((app) => {
            const { formattedDate, formattedTime, isUpcoming } = formatAppointmentDateTime(
              app.appointmentDate,
              app.timezone || patientTimezone
            );

            return (
              <Card
                key={app.id}
                className={`p-6 transition border-2 ${
                  app.status === 'scheduled'
                    ? 'border-brand-200 hover:border-brand-400 bg-white shadow-sm'
                    : app.status === 'completed'
                    ? 'border-emerald-200 bg-emerald-50/20'
                    : 'border-rose-200 bg-rose-50/20'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                  {/* Left: Date pill & Details */}
                  <div className="flex items-start gap-5">
                    {/* Date Block */}
                    <div
                      className={`flex flex-col items-center justify-center w-24 h-24 rounded-2xl shrink-0 text-center font-bold shadow-sm ${
                        app.status === 'scheduled'
                          ? 'bg-brand-50 text-brand-900 border-2 border-brand-200'
                          : app.status === 'completed'
                          ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                          : 'bg-rose-100 text-rose-900 border border-rose-300'
                      }`}
                    >
                      <span className="text-xs uppercase font-extrabold tracking-wider">
                        {app.localDate ? new Date(app.localDate + 'T12:00:00Z').toLocaleString('en-US', { month: 'short' }) : 'VISIT'}
                      </span>
                      <span className="text-3xl font-black">
                        {app.localDate ? app.localDate.slice(8, 10) : '—'}
                      </span>
                      <span className="text-xs font-semibold text-slate-600 font-mono">
                        {app.localTime || ''}
                      </span>
                    </div>

                    {/* Information */}
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-2xl font-black text-slate-900">{app.doctorName}</h3>
                        <span className="text-xs px-2.5 py-1 rounded-lg bg-blue-100 text-blue-800 font-bold uppercase tracking-wider">
                          {app.specialty}
                        </span>
                        <span
                          className={`text-xs px-2.5 py-1 rounded-lg font-bold uppercase tracking-wider ${
                            app.status === 'scheduled'
                              ? 'bg-brand-100 text-brand-800'
                              : app.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {app.status}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 font-semibold mt-2">
                        <span className="flex items-center gap-1.5">
                          <Building className="w-4 h-4 text-slate-400" />
                          <span>{app.clinicName}</span>
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1.5">
                          <MapPin className="w-4 h-4 text-slate-400" />
                          <span>{app.clinicAddress}</span>
                        </span>
                      </div>

                      {app.accompaniedBy && (
                        <p className="text-sm text-slate-700 font-medium mt-2 flex items-center gap-1.5">
                          <User className="w-4 h-4 text-brand-600" />
                          <span>Accompanied by: <span className="font-bold">{app.accompaniedBy}</span></span>
                        </p>
                      )}

                      {app.notes && (
                        <p className="text-sm text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 mt-3 font-medium">
                          <span className="font-bold text-slate-800">Visit Notes:</span> {app.notes}
                        </p>
                      )}

                      {/* Cancellation reason if cancelled */}
                      {app.status === 'cancelled' && app.cancellationReason && (
                        <div className="mt-3 p-3 rounded-xl bg-rose-100/70 border border-rose-200 text-rose-900 text-sm font-semibold flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                          <span>Cancellation Reason: {app.cancellationReason}</span>
                        </div>
                      )}

                      {/* Reminder status badges (Prepared for M4) */}
                      {app.status === 'scheduled' && (
                        <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-500">
                          <ShieldCheck className="w-4 h-4 text-brand-600" />
                          <span>Reminders configured: 24h & 2h before visit via Resend</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex flex-wrap sm:flex-col items-end gap-2 shrink-0">
                    {app.status === 'scheduled' && (
                      <>
                        <Button
                          onClick={() => handleMarkCompleted(app.id)}
                          size="md"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 w-full sm:w-auto"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Mark Completed</span>
                        </Button>

                        <Button
                          onClick={() => openEditModal(app)}
                          variant="outline"
                          size="sm"
                          className="w-full sm:w-auto"
                        >
                          <span>Reschedule / Edit</span>
                        </Button>

                        <Button
                          onClick={() => setShowCancelModal(app)}
                          variant="outline"
                          size="sm"
                          className="text-rose-600 border-rose-200 hover:bg-rose-50 w-full sm:w-auto"
                        >
                          <XCircle className="w-4 h-4 mr-1" />
                          <span>Cancel Visit</span>
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal: Schedule / Edit Appointment */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl my-8">
            <h3 className="text-2xl font-black text-slate-900 mb-1">
              {editingAppointment ? 'Reschedule Doctor Appointment' : 'Schedule Doctor Appointment'}
            </h3>
            <p className="text-sm text-slate-500 mb-6">
              Enter doctor and clinic details. Time is automatically scheduled in the elder&apos;s local timezone ({patientTimezone}).
            </p>

            {formError && (
              <div className="mb-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold">
                {formError}
              </div>
            )}

            {conflictWarning && (
              <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-sm font-semibold">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Schedule Overlap Detected:</p>
                    <p className="mt-0.5">{conflictWarning}</p>
                    <div className="mt-3">
                      <Button
                        type="button"
                        size="sm"
                        onClick={(e) => handleSubmitAppointment(e, true)}
                        className="bg-amber-700 hover:bg-amber-800 text-white"
                      >
                        Confirm Overlap & Proceed
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={(e) => handleSubmitAppointment(e, false)} className="space-y-4">
              <div>
                <label className="block text-base font-bold text-slate-800 mb-1">Doctor Name</label>
                <input
                  type="text"
                  required
                  value={doctorName}
                  onChange={(e) => setDoctorName(e.target.value)}
                  placeholder="e.g. Dr. Rajesh Sharma"
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-base font-bold text-slate-800 mb-1">Medical Specialty</label>
                <input
                  type="text"
                  required
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  placeholder="e.g. Cardiology, Orthopedics, Ophthalmology"
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1">Clinic / Hospital</label>
                  <input
                    type="text"
                    required
                    value={clinicName}
                    onChange={(e) => setClinicName(e.target.value)}
                    placeholder="e.g. Apollo Hospital"
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1">Clinic Address</label>
                  <input
                    type="text"
                    required
                    value={clinicAddress}
                    onChange={(e) => setClinicAddress(e.target.value)}
                    placeholder="e.g. 12th Main, Indiranagar"
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1">Appointment Date</label>
                  <input
                    type="date"
                    required
                    value={localDate}
                    onChange={(e) => setLocalDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1">Appointment Time</label>
                  <input
                    type="time"
                    required
                    value={localTime}
                    onChange={(e) => setLocalTime(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base font-mono focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-base font-bold text-slate-800 mb-1">Accompanied By</label>
                <input
                  type="text"
                  value={accompaniedBy}
                  onChange={(e) => setAccompaniedBy(e.target.value)}
                  placeholder="e.g. Anita Sharma (Daughter) or Nurse Sita"
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-base font-bold text-slate-800 mb-1">Preparation & Clinical Notes</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Fasting required for 10 hours before visit. Bring previous ECG report."
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                />
              </div>

              <div className="border-t border-slate-100 pt-3">
                <span className="block text-sm font-bold text-slate-800 mb-2">Automated Email Reminders</span>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={email24h}
                      onChange={(e) => setEmail24h(e.target.checked)}
                      className="w-4 h-4 text-brand-600 rounded"
                    />
                    <span>24 hours before</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={email2h}
                      onChange={(e) => setEmail2h(e.target.checked)}
                      className="w-4 h-4 text-brand-600 rounded"
                    />
                    <span>2 hours before</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-3 pt-6 border-t border-slate-100 mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowScheduleModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button type="submit" isLoading={formSubmitting} className="flex-1">
                  {editingAppointment ? 'Save Changes' : 'Confirm Visit'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Cancel Appointment with Mandatory Reason */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mb-4">
              <XCircle className="w-6 h-6" />
            </div>

            <h3 className="text-2xl font-black text-slate-900 mb-1">Cancel Appointment</h3>
            <p className="text-sm text-slate-500 mb-4">
              Cancelling visit with <span className="font-bold text-slate-800">{showCancelModal.doctorName}</span> ({showCancelModal.specialty}) on {showCancelModal.localDate}.
            </p>
            <p className="text-xs text-slate-400 mb-4">
              Note: This will not delete the consultation history. The cancellation reason will be preserved in the care timeline.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1">Cancellation Reason</label>
                <textarea
                  required
                  rows={3}
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                  placeholder="e.g. Doctor unavailable, Elder unwell to travel, Rescheduling for next week"
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-rose-500 outline-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCancelModal(null)}
                  className="flex-1"
                >
                  Keep Appointment
                </Button>
                <Button
                  onClick={handleConfirmCancel}
                  isLoading={cancelLoading}
                  className="flex-1 bg-rose-600 hover:bg-rose-700 text-white"
                >
                  Confirm Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
