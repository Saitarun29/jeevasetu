'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Users,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Printer,
  ShieldAlert,
  TrendingUp,
  UserCheck,
  Phone,
  ArrowRight,
  UserPlus,
  Activity,
} from 'lucide-react';
import { PatientProfile } from '@/types/patient';
import { ExpectedDose, Medication } from '@/types/medication';
import { Appointment } from '@/types/appointment';
import { CareGap } from '@/types/care-gap';
import { CaregiverHandover } from '@/types/handover';
import { CareCircleMember } from '@/types/auth';
import { EmergencyCareCard } from '@/components/emergency/EmergencyCareCard';

interface FamilyCommandCenterProps {
  patient: PatientProfile;
  doses: ExpectedDose[];
  medications: Medication[];
  appointments: Appointment[];
  members: CareCircleMember[];
  careGaps: CareGap[];
  handovers: CaregiverHandover[];
  onOpenInviteModal?: () => void;
}

export function FamilyCommandCenter({
  patient,
  doses = [],
  medications = [],
  appointments = [],
  members = [],
  careGaps = [],
  handovers = [],
  onOpenInviteModal,
}: FamilyCommandCenterProps) {
  const [showEmergencyCardModal, setShowEmergencyCardModal] = useState<boolean>(false);

  // Compute 4-state adherence metrics
  const totalScheduled = doses.length;
  const confirmedTaken = doses.filter((d) => d.status === 'TAKEN').length;
  const skipped = doses.filter((d) => d.status === 'SKIPPED').length;
  const missed = doses.filter((d) => d.status === 'MISSED').length;
  const unconfirmed = doses.filter((d) => d.status === 'UNCONFIRMED').length;
  const adherenceRate =
    totalScheduled > 0 ? Math.round((confirmedTaken / totalScheduled) * 100) : 100;

  // Recent Handover
  const latestHandover = handovers[0] || null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-2 sm:px-4 overflow-x-hidden">
      {/* Care Gap Detector Alert Banner (High Priority) */}
      {careGaps.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-amber-900 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-600" />
              Care Gap Detector ({careGaps.length} unresolved alerts)
            </span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-200 text-amber-900">
              Immediate Review Required
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {careGaps.map((gap) => (
              <div
                key={gap.id}
                className="bg-white border rounded-xl p-3.5 shadow-sm flex items-start gap-3"
              >
                <AlertTriangle
                  className={`w-5 h-5 shrink-0 mt-0.5 ${
                    gap.severity === 'critical' ? 'text-rose-600' : 'text-amber-500'
                  }`}
                />
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-slate-900">{gap.title}</h4>
                  <p className="text-xs text-slate-600">{gap.description}</p>
                  <p className="text-xs font-semibold text-brand-700">Action: {gap.actionRequired}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Quick Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-brand-600 text-white flex items-center justify-center font-black text-xl shadow-md shadow-brand-600/20">
            {patient.fullName.charAt(0)}
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900">{patient.fullName}</h1>
            <p className="text-xs font-semibold text-slate-500">
              Care Circle Command Centre • Blood Group: {patient.bloodGroup} • DOB:{' '}
              {patient.dateOfBirth}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowEmergencyCardModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm shadow-sm transition min-h-[44px] cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>Emergency Care Card</span>
          </button>

          {onOpenInviteModal && (
            <button
              onClick={onOpenInviteModal}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-50 hover:bg-brand-100 text-brand-800 border border-brand-200 font-bold text-sm transition min-h-[44px] cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>Invite Member</span>
            </button>
          )}
        </div>
      </div>

      {/* 3-Column Desktop Grid Layout / Single-Column Prioritized Mobile Stack */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ================= COLUMN 1 (Desktop 3 cols): Patient Profile & Circle ================= */}
        <div className="lg:col-span-3 space-y-6 order-2 lg:order-1">
          {/* Patient Overview Card */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-base font-black text-slate-900 uppercase tracking-wide flex items-center gap-2">
              <Activity className="w-4 h-4 text-brand-600" />
              <span>Clinical Profile</span>
            </h3>

            {/* Emergency Contact */}
            {patient.emergencyContact && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-1">
                <span className="text-[11px] font-bold text-rose-800 uppercase block">
                  Primary Emergency Contact
                </span>
                <span className="text-sm font-black text-slate-900 block">
                  {patient.emergencyContact.name} ({patient.emergencyContact.relation})
                </span>
                <a
                  href={`tel:${patient.emergencyContact.phone}`}
                  className="text-xs font-bold text-rose-700 flex items-center gap-1 hover:underline pt-0.5"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>{patient.emergencyContact.phone}</span>
                </a>
              </div>
            )}

            {/* Allergies & Conditions */}
            <div className="space-y-3 text-xs">
              <div>
                <span className="font-bold text-slate-500 uppercase block mb-1">
                  Documented Allergies
                </span>
                <div className="flex flex-wrap gap-1">
                  {patient.allergies?.length > 0 ? (
                    patient.allergies.map((a, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded bg-rose-100 text-rose-900 font-bold text-[11px]"
                      >
                        {a}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-400 italic">None recorded</span>
                  )}
                </div>
              </div>

              <div>
                <span className="font-bold text-slate-500 uppercase block mb-1">
                  Chronic Conditions
                </span>
                <div className="flex flex-wrap gap-1">
                  {patient.chronicConditions?.length > 0 ? (
                    patient.chronicConditions.map((c, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-semibold text-[11px]"
                      >
                        {c}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-400 italic">None recorded</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Care Circle Members */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-brand-600" />
                <span>Care Circle ({members.length})</span>
              </h3>
            </div>

            <div className="divide-y divide-slate-100 space-y-2">
              {members.map((m) => (
                <div key={m.userId} className="pt-2 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-900 block">{m.displayName}</span>
                    <span className="text-slate-500 text-[11px]">{m.email}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 capitalize">
                    {m.role.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ================= COLUMN 2 (Desktop 5 cols): Today's Schedule & Timeline ================= */}
        <div className="lg:col-span-5 space-y-6 order-1 lg:order-2">
          {/* Today's Medication Schedule Timeline */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-brand-600" />
                <h2 className="text-lg font-black text-slate-900">Today&apos;s Medication Timeline</h2>
              </div>
              <Link
                href="/medications"
                className="text-xs font-bold text-brand-700 hover:text-brand-900 flex items-center gap-1"
              >
                <span>Full Regimen</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {doses.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">
                No medication doses scheduled for today.
              </p>
            ) : (
              <div className="space-y-3">
                {doses.map((dose) => (
                  <div
                    key={dose.doseKey}
                    className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 transition ${
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
                      <span className="font-mono font-black text-sm bg-slate-900 text-white px-2.5 py-1 rounded-lg">
                        {dose.scheduledTime}
                      </span>
                      <div>
                        <span className="font-bold text-sm text-slate-900 block">
                          {dose.medicationName}
                        </span>
                        <span className="text-xs text-slate-500 font-medium">
                          {dose.dosage} ({dose.form})
                        </span>
                      </div>
                    </div>

                    {/* 4-State Pill */}
                    <div>
                      {dose.status === 'TAKEN' && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>TAKEN</span>
                        </span>
                      )}
                      {dose.status === 'SKIPPED' && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-800 flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5 text-amber-600" />
                          <span>SKIPPED</span>
                        </span>
                      )}
                      {dose.status === 'MISSED' && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-black bg-rose-100 text-rose-800 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                          <span>MISSED</span>
                        </span>
                      )}
                      {dose.status === 'UNCONFIRMED' && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600 flex items-center gap-1">
                          <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                          <span>PENDING</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming Consultations */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-black text-slate-900">Appointments</h3>
              </div>
              <Link
                href="/appointments"
                className="text-xs font-bold text-blue-700 hover:text-blue-900 flex items-center gap-1"
              >
                <span>View All</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {appointments.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">
                No doctor visits currently scheduled.
              </p>
            ) : (
              <div className="space-y-3">
                {appointments.slice(0, 2).map((app) => (
                  <div key={app.id} className="p-3 bg-blue-50/50 border border-blue-200 rounded-xl space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-900">{app.doctorName}</span>
                      <span className="font-mono font-bold text-blue-800">{app.localDate} at {app.localTime}</span>
                    </div>
                    <p className="text-xs text-slate-600">{app.clinicName}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ================= COLUMN 3 (Desktop 4 cols): 4-State Certainty, Shift Handover & Trends ================= */}
        <div className="lg:col-span-4 space-y-6 order-3">
          {/* 4-State Adherence Breakdown Widget */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-brand-600" />
                <span>Adherence Certainty</span>
              </h3>
              <span className="text-xs font-bold text-brand-800 bg-brand-50 px-2 py-0.5 rounded-full border border-brand-200">
                {adherenceRate}% Today
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <span className="text-[10px] font-bold uppercase text-emerald-800 block">Confirmed Taken</span>
                <span className="text-2xl font-black text-emerald-950 mt-1 block">{confirmedTaken}</span>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <span className="text-[10px] font-bold uppercase text-amber-800 block">Skipped (Reason)</span>
                <span className="text-2xl font-black text-amber-950 mt-1 block">{skipped}</span>
              </div>

              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl">
                <span className="text-[10px] font-bold uppercase text-rose-800 block">Missed (&gt;2h Grace)</span>
                <span className="text-2xl font-black text-rose-950 mt-1 block">{missed}</span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="text-[10px] font-bold uppercase text-slate-600 block">Unconfirmed</span>
                <span className="text-2xl font-black text-slate-900 mt-1 block">{unconfirmed}</span>
              </div>
            </div>
          </div>

          {/* Caregiver Shift Handover Status Card */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-indigo-600" />
                <span>Shift Handover Status</span>
              </h3>
              <Link
                href="/tasks"
                className="text-xs font-bold text-indigo-700 hover:text-indigo-900 flex items-center gap-1"
              >
                <span>Handovers</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {latestHandover ? (
              <div className="p-3 bg-indigo-50/50 border border-indigo-200 rounded-xl space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-800">
                    {latestHandover.givingCaregiverName} ➔ {latestHandover.receivingCaregiverName}
                  </span>
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      latestHandover.status === 'acknowledged'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800 animate-pulse'
                    }`}
                  >
                    {latestHandover.status.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-slate-600 italic">&quot;{latestHandover.patientConditionSummary}&quot;</p>
                <span className="text-[10px] text-slate-400 block">
                  Shift: {latestHandover.shiftStartTime} - {latestHandover.shiftEndTime}
                </span>
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-3 text-center">
                No shift handovers initiated today.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Emergency Care Card Modal */}
      {showEmergencyCardModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="emergency-card-title"
        >
          <div className="bg-white rounded-3xl max-w-3xl w-full p-4 sm:p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 id="emergency-card-title" className="text-lg font-black text-slate-900">Emergency Care Continuity Card</h3>
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
