'use client';

import React, { useState, useEffect } from 'react';
import {
  Heart,
  Phone,
  AlertTriangle,
  Clock,
  Calendar,
  CheckCircle2,
  XCircle,
  Volume2,
  Wifi,
  WifiOff,
  Smile,
  Meh,
  Frown,
  ShieldAlert,
  Droplet,
  Pill,
  Sparkles,
} from 'lucide-react';
import { PatientProfile } from '@/types/patient';
import { ExpectedDose, Medication, MedicationForm } from '@/types/medication';
import { Appointment } from '@/types/appointment';
import { useCareMode } from '@/context/CareModeContext';
import { queueMedicationAction, markOutboxItemSynced, getPendingOutbox } from '@/lib/offline/idb-outbox';
import { syncService } from '@/lib/offline/sync-service';
import { auth } from '@/lib/firebase/client';

interface ElderlyPatientDashboardProps {
  patient: PatientProfile;
  doses: ExpectedDose[];
  appointments: Appointment[];
  medications: Medication[];
  onActionComplete?: () => void;
}

export function ElderlyPatientDashboard({
  patient,
  doses = [],
  appointments = [],
  medications = [],
  onActionComplete,
}: ElderlyPatientDashboardProps) {
  const { speakText } = useCareMode();

  // Live Clock & Date
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDateStr, setCurrentDateStr] = useState<string>('');
  const [greeting, setGreeting] = useState<string>('Namaste');

  // Network & Sync State
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);

  // Health Mood State
  const [selectedMood, setSelectedMood] = useState<'energetic' | 'normal' | 'unwell' | null>(null);
  const [moodSavedToast, setMoodSavedToast] = useState<boolean>(false);

  // Medication Action States
  const [skipModalDose, setSkipModalDose] = useState<ExpectedDose | null>(null);
  const [skipReason, setSkipReason] = useState<string>('Elder feeling nauseous or unwell');
  const [actionInProgress, setActionInProgress] = useState<boolean>(false);
  const [lastActionMessage, setLastActionMessage] = useState<string | null>(null);

  // SOS Emergency Dialog & Countdown State
  const [showSosModal, setShowSosModal] = useState<boolean>(false);
  const [sosCountdown, setSosCountdown] = useState<number>(3);
  const [sosActivated, setSosActivated] = useState<boolean>(false);

  // Clock & Greeting update
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
      );
      setCurrentDateStr(
        now.toLocaleDateString('en-US', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })
      );

      const hour = now.getHours();
      const firstName = patient.fullName.split(' ')[0] || patient.fullName;
      if (hour >= 4 && hour < 12) {
        setGreeting(`Namaste, ${firstName} ji — Good Morning`);
      } else if (hour >= 12 && hour < 17) {
        setGreeting(`Namaste, ${firstName} ji — Good Afternoon`);
      } else {
        setGreeting(`Namaste, ${firstName} ji — Good Evening`);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [patient.fullName]);

  // Online / Offline & Outbox listener
  useEffect(() => {
    setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const updateOnline = () => setIsOnline(true);
    const updateOffline = () => setIsOnline(false);

    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOffline);

    const checkPending = async () => {
      if (patient.id) {
        const pending = await getPendingOutbox(patient.id);
        setPendingSyncCount(pending.length);
      }
    };
    checkPending();

    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOffline);
    };
  }, [patient.id]);

  // SOS 3-Second Timer
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showSosModal && sosCountdown > 0 && !sosActivated) {
      timer = setTimeout(() => {
        setSosCountdown((prev) => prev - 1);
      }, 1000);
    } else if (showSosModal && sosCountdown === 0 && !sosActivated) {
      setSosActivated(true);
      speakText('Emergency call initiated to family.');
      if (patient.emergencyContact?.phone) {
        window.location.href = `tel:${patient.emergencyContact.phone}`;
      }
    }
    return () => clearTimeout(timer);
  }, [showSosModal, sosCountdown, sosActivated, patient.emergencyContact?.phone, speakText]);

  // Find next dose requiring action
  const nextDose = doses.find((d) => d.status === 'UNCONFIRMED') || doses[0] || null;

  // Medicine Icon Helper
  const getMedFormIcon = (form: MedicationForm) => {
    switch (form) {
      case 'liquid':
      case 'drops':
        return <Droplet className="w-10 h-10 text-emerald-600" />;
      default:
        return <Pill className="w-10 h-10 text-emerald-600" />;
    }
  };

  // Safe Audio Read-Aloud (Clinical Safety Invariant: NEVER records as taken)
  const handleReadDose = () => {
    if (!nextDose) {
      speakText('You have no medicine to take right now.');
      return;
    }
    const text = `Next medicine is ${nextDose.medicationName}, dosage ${nextDose.dosage}. Scheduled for ${nextDose.scheduledTime}. Instructions: ${nextDose.instructions || 'Take with water after food.'}`;
    speakText(text);
  };

  // Record Dose TAKEN or SKIPPED
  const handleConfirmAction = async (status: 'TAKEN' | 'SKIPPED', note?: string) => {
    if (!nextDose) return;
    setActionInProgress(true);

    try {
      // 1. Enqueue in local IndexedDB outbox immediately with version awareness
      const expectedVersion = (nextDose as any).medicationVersion || (nextDose as any).version || 1;
      const outboxItem = await queueMedicationAction(
        patient.id,
        nextDose.medicationId,
        nextDose.medicationName,
        nextDose.dosage,
        nextDose.scheduledDate,
        nextDose.scheduledTime,
        status,
        note,
        expectedVersion
      );

      // Audio & Visual Affirmation
      if (status === 'TAKEN') {
        setLastActionMessage(`Great job! You took ${nextDose.medicationName}.`);
        speakText(`Thank you. We have recorded your dose of ${nextDose.medicationName}.`);
      } else {
        setLastActionMessage(`Dose of ${nextDose.medicationName} marked as skipped.`);
        speakText(`Understood. ${nextDose.medicationName} is skipped.`);
      }

      // 2. Synchronize via unified version-aware syncService
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        const user = auth.currentUser;
        const tokenProvider = user ? async () => user.getIdToken() : undefined;
        await syncService.syncAll(tokenProvider);
      }

      const pending = await getPendingOutbox(patient.id);
      setPendingSyncCount(pending.length);

      if (onActionComplete) {
        onActionComplete();
      }
    } catch (e) {
      console.error('Action error:', e);
    } finally {
      setActionInProgress(false);
      setSkipModalDose(null);
      setTimeout(() => setLastActionMessage(null), 5000);
    }
  };

  // Daily Health Check selection
  const handleSelectMood = (mood: 'energetic' | 'normal' | 'unwell') => {
    setSelectedMood(mood);
    setMoodSavedToast(true);
    if (mood === 'energetic') {
      speakText('Wonderful! Glad to hear you are feeling energetic today.');
    } else if (mood === 'normal') {
      speakText('Good to know you are feeling comfortable.');
    } else {
      speakText('We will let your family know you need some rest.');
    }
    setTimeout(() => setMoodSavedToast(false), 4000);
  };

  const upcomingAppointment = appointments.find((a) => a.status === 'scheduled') || null;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12 px-2 sm:px-4">
      {/* Real-Time Calming Network & Sync Status Banner */}
      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white border-2 border-slate-300 shadow-sm text-slate-800">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
              isOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
            }`}
          >
            {isOnline ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
          </div>
          <div>
            <span className="text-base font-extrabold block">
              {isOnline ? 'Connected with Family' : 'Offline Mode Active'}
            </span>
            <span className="text-xs text-slate-600 font-semibold block">
              {pendingSyncCount > 0
                ? `${pendingSyncCount} action saved safely on phone. Will sync automatically.`
                : 'All medication records are safe and up to date.'}
            </span>
          </div>
        </div>

        <button
          onClick={handleReadDose}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-950 font-bold text-sm border border-sky-300 transition shadow-sm min-h-[48px]"
          title="Read instructions aloud"
        >
          <Volume2 className="w-5 h-5 text-sky-800" />
          <span>Read Aloud</span>
        </button>
      </div>

      {/* Greeting & Giant Readable Clock Card */}
      <div className="bg-gradient-to-br from-emerald-800 to-teal-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl border-4 border-emerald-700">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="text-emerald-200 text-lg font-bold block mb-1">
              {currentDateStr || 'Today'}
            </span>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight">{greeting}</h1>
          </div>

          <div className="bg-black/30 backdrop-blur-md px-6 py-4 rounded-2xl border-2 border-emerald-400/40 text-center self-start md:self-auto min-w-[200px]">
            <span className="text-xs font-black uppercase tracking-widest text-emerald-200 block">
              Current Time
            </span>
            <span className="text-4xl sm:text-5xl font-mono font-black text-white block mt-1">
              {currentTime || '--:--'}
            </span>
          </div>
        </div>
      </div>

      {/* Affirmation Toast Banner */}
      {lastActionMessage && (
        <div className="p-4 rounded-2xl bg-emerald-100 border-2 border-emerald-500 text-emerald-950 font-black text-lg flex items-center gap-3 shadow-md animate-fade-in">
          <CheckCircle2 className="w-7 h-7 text-emerald-700 shrink-0" />
          <span>{lastActionMessage}</span>
        </div>
      )}

      {/* Hero Card: Next Upcoming Medicine */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border-4 border-slate-300 shadow-xl space-y-6">
        <div className="flex items-center justify-between border-b-2 border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center">
              <Clock className="w-7 h-7 text-emerald-700" />
            </div>
            <div>
              <span className="text-xs font-black text-slate-500 uppercase tracking-widest">
                Upcoming Schedule
              </span>
              <h2 className="text-2xl sm:text-3xl font-black text-slate-900">
                {nextDose && nextDose.status === 'UNCONFIRMED'
                  ? 'Time to Take Your Medicine'
                  : 'Today’s Medication Summary'}
              </h2>
            </div>
          </div>

          {nextDose && (
            <span className="text-xl sm:text-2xl font-mono font-black bg-slate-900 text-white px-4 py-2 rounded-2xl shadow-inner">
              {nextDose.scheduledTime}
            </span>
          )}
        </div>

        {nextDose ? (
          <div className="space-y-6">
            <div className="flex items-start gap-4 p-5 rounded-2xl bg-slate-50 border-2 border-slate-200">
              <div className="p-3 bg-white rounded-2xl border-2 border-slate-300 shadow-sm shrink-0">
                {getMedFormIcon(nextDose.form)}
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl sm:text-3xl font-black text-slate-900">
                  {nextDose.medicationName}
                </h3>
                <p className="text-xl font-bold text-emerald-800">{nextDose.dosage}</p>
                <p className="text-lg font-semibold text-slate-700">
                  Instructions: {nextDose.instructions || 'Take with water after meals.'}
                </p>
              </div>
            </div>

            {/* Massive One-Touch TAKEN & SKIPPED Buttons */}
            {nextDose.status === 'UNCONFIRMED' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                {/* Massive Took Button (min 68px touch target) */}
                <button
                  onClick={() => handleConfirmAction('TAKEN')}
                  disabled={actionInProgress}
                  className="flex items-center justify-center gap-3 px-6 py-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-black text-2xl min-h-[68px] shadow-lg shadow-emerald-700/30 border-2 border-emerald-500 transition-all cursor-pointer"
                >
                  <CheckCircle2 className="w-8 h-8" />
                  <span>I Took It</span>
                </button>

                {/* Massive Skip Button (min 68px touch target) */}
                <button
                  onClick={() => setSkipModalDose(nextDose)}
                  disabled={actionInProgress}
                  className="flex items-center justify-center gap-3 px-6 py-5 rounded-2xl bg-amber-100 hover:bg-amber-200 active:scale-[0.98] text-amber-950 font-black text-xl min-h-[68px] border-2 border-amber-400 transition-all cursor-pointer"
                >
                  <XCircle className="w-7 h-7 text-amber-700" />
                  <span>Skip Dose</span>
                </button>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-100 border-2 border-slate-300 text-center font-bold text-slate-700 text-lg">
                Status: {nextDose.status} • All doses confirmed for this hour.
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-600 font-bold text-xl">
            No pending medicines for today! You are all caught up.
          </div>
        )}
      </div>

      {/* Two-Column Utility: Appointments & Daily Health Check */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Doctor Appointment Card */}
        <div className="bg-white rounded-3xl p-6 border-2 border-slate-300 shadow-md space-y-4">
          <div className="flex items-center gap-3 border-b-2 border-slate-100 pb-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <Calendar className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-black text-slate-900">Upcoming Doctor Visit</h3>
          </div>

          {upcomingAppointment ? (
            <div className="space-y-3 bg-blue-50/60 border border-blue-200 rounded-2xl p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="text-xl font-bold text-slate-900">
                    {upcomingAppointment.doctorName}
                  </h4>
                  <p className="text-sm font-semibold text-blue-800">
                    {upcomingAppointment.specialty}
                  </p>
                </div>
                <span className="text-sm font-mono font-bold bg-blue-600 text-white px-3 py-1 rounded-xl">
                  {upcomingAppointment.localTime}
                </span>
              </div>

              <p className="text-sm text-slate-700 font-medium">
                Clinic: {upcomingAppointment.clinicName} ({upcomingAppointment.clinicAddress})
              </p>

              {upcomingAppointment.accompaniedBy && (
                <div className="text-xs font-bold text-slate-800 bg-white p-2 rounded-lg border">
                  Going with: {upcomingAppointment.accompaniedBy}
                </div>
              )}
            </div>
          ) : (
            <p className="text-slate-500 font-semibold py-4 text-center">
              No appointments scheduled for today or tomorrow.
            </p>
          )}
        </div>

        {/* Daily Health Check Widget */}
        <div className="bg-white rounded-3xl p-6 border-2 border-slate-300 shadow-md space-y-4">
          <div className="flex items-center gap-3 border-b-2 border-slate-100 pb-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
              <Sparkles className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-black text-slate-900">How Are You Feeling?</h3>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              onClick={() => handleSelectMood('energetic')}
              className={`flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition min-h-[80px] cursor-pointer ${
                selectedMood === 'energetic'
                  ? 'border-emerald-500 bg-emerald-100 text-emerald-900 ring-2 ring-emerald-500 font-black'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 font-bold'
              }`}
            >
              <Smile className="w-8 h-8 text-emerald-600 mb-1" />
              <span className="text-xs sm:text-sm text-center">Feeling Good</span>
            </button>

            <button
              onClick={() => handleSelectMood('normal')}
              className={`flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition min-h-[80px] cursor-pointer ${
                selectedMood === 'normal'
                  ? 'border-sky-500 bg-sky-100 text-sky-900 ring-2 ring-sky-500 font-black'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 font-bold'
              }`}
            >
              <Meh className="w-8 h-8 text-sky-600 mb-1" />
              <span className="text-xs sm:text-sm text-center">Okay</span>
            </button>

            <button
              onClick={() => handleSelectMood('unwell')}
              className={`flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition min-h-[80px] cursor-pointer ${
                selectedMood === 'unwell'
                  ? 'border-amber-500 bg-amber-100 text-amber-900 ring-2 ring-amber-500 font-black'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 font-bold'
              }`}
            >
              <Frown className="w-8 h-8 text-amber-600 mb-1" />
              <span className="text-xs sm:text-sm text-center">Need Rest</span>
            </button>
          </div>

          {moodSavedToast && (
            <p className="text-xs font-bold text-center text-emerald-800 bg-emerald-50 py-1.5 rounded-lg border border-emerald-200 animate-fade-in">
              Recorded! Your family will be updated.
            </p>
          )}
        </div>
      </div>

      {/* Emergency Contact & Call Family Action Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
        {/* Call Family Button */}
        {patient.emergencyContact?.phone ? (
          <a
            href={`tel:${patient.emergencyContact.phone}`}
            className="flex items-center justify-center gap-3 px-6 py-5 rounded-2xl bg-indigo-700 hover:bg-indigo-800 active:scale-[0.98] text-white font-black text-xl min-h-[64px] shadow-lg shadow-indigo-900/20 border-2 border-indigo-600 transition"
          >
            <Phone className="w-7 h-7" />
            <span>Call {patient.emergencyContact.name}</span>
          </a>
        ) : (
          <div className="p-4 bg-slate-100 rounded-2xl text-center text-slate-600 font-bold">
            No family telephone number listed.
          </div>
        )}

        {/* SOS Emergency Button */}
        <button
          onClick={() => {
            setShowSosModal(true);
            setSosCountdown(3);
            setSosActivated(false);
          }}
          className="flex items-center justify-center gap-3 px-6 py-5 rounded-2xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white font-black text-xl min-h-[64px] shadow-lg shadow-rose-900/30 border-2 border-rose-500 transition cursor-pointer"
        >
          <ShieldAlert className="w-8 h-8" />
          <span>Emergency SOS</span>
        </button>
      </div>

      {/* Mandatory Skip Explanation Modal */}
      {skipModalDose && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="skip-modal-title"
        >
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border-4 border-amber-300 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center">
                <XCircle className="w-8 h-8" />
              </div>
              <div>
                <h3 id="skip-modal-title" className="text-2xl font-black text-slate-900">Why are you skipping?</h3>
                <p className="text-sm font-semibold text-slate-600">
                  Please choose a reason so your family doctor knows.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {[
                'Elder feeling nauseous or unwell',
                'Advised to hold by doctor',
                'Elder refused medication',
                'Currently resting / sleeping',
                'Medication out of stock / awaiting refill',
                'Other clinical reason',
              ].map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setSkipReason(reason)}
                  className={`w-full text-left p-4 rounded-2xl border-2 text-base font-bold transition min-h-[56px] cursor-pointer ${
                    skipReason === reason
                      ? 'border-amber-600 bg-amber-50 text-amber-950 font-black'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  {reason}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <button
                type="button"
                onClick={() => setSkipModalDose(null)}
                className="py-4 px-6 rounded-2xl border-2 border-slate-300 font-bold text-lg text-slate-700 min-h-[56px] hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleConfirmAction('SKIPPED', skipReason)}
                className="py-4 px-6 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-black text-lg min-h-[56px] shadow-md shadow-amber-600/30 cursor-pointer"
              >
                Confirm Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SOS 3-Second Confirmation Dialog */}
      {showSosModal && (
        <div
          className="fixed inset-0 z-50 bg-rose-950/80 backdrop-blur-md flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sos-modal-title"
        >
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border-4 border-rose-600 text-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto shadow-inner">
              <ShieldAlert className="w-12 h-12" />
            </div>

            <div className="space-y-2">
              <h3 id="sos-modal-title" className="text-3xl font-black text-slate-900">
                {sosActivated ? 'Connecting Emergency Call' : 'Contacting Emergency Contacts'}
              </h3>
              <p className="text-base font-bold text-slate-600">
                {sosActivated
                  ? 'Connecting to ' + (patient.emergencyContact?.name || 'Emergency Services') + '...'
                  : 'Dialing in progress. Tap cancel if pressed by accident.'}
              </p>
            </div>

            {!sosActivated && (
              <div className="text-6xl font-black font-mono text-rose-600 py-2">
                {sosCountdown}
              </div>
            )}

            <button
              onClick={() => {
                setShowSosModal(false);
                setSosActivated(false);
                setSosCountdown(3);
                speakText('Emergency call cancelled.');
              }}
              className="w-full py-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xl min-h-[60px] shadow-lg cursor-pointer"
            >
              Cancel Call
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
