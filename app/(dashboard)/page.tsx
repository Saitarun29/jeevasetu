'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Heart,
  Users,
  Calendar,
  Clock,
  PlusCircle,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Phone,
  ShieldAlert,
  ArrowRight,
  Activity,
  CheckSquare,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { auth } from '@/lib/firebase/client';
import { SystemHealthCard } from '@/components/system/system-health';
import { EmergencyCareCard } from '@/components/emergency/EmergencyCareCard';
import { ElderlyPatientDashboard } from '@/components/elderly/ElderlyPatientDashboard';
import { FamilyCommandCenter } from '@/components/family/FamilyCommandCenter';
import { CaregiverShiftWorkspace } from '@/components/caregiver/CaregiverShiftWorkspace';
import { useCareMode } from '@/context/CareModeContext';

export default function DashboardPage() {
  const { mode } = useCareMode();
  const [patients, setPatients] = useState<any[]>([]);
  const [activePatient, setActivePatient] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  // Experience Switcher: 'elderly' | 'family' | 'caregiver'
  const [activeView, setActiveView] = useState<'elderly' | 'family' | 'caregiver'>('family');

  // Continuity Data States
  const [doses, setDoses] = useState<any[]>([]);
  const [medications, setMedications] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [handovers, setHandovers] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [gaps, setGaps] = useState<any[]>([]);

  // Modals
  const [showCreatePatientModal, setShowCreatePatientModal] = useState(false);
  const [showRedeemModal, setShowRedeemModal] = useState(false);

  // Form states: Create Patient
  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('1948-06-15');
  const [bloodGroup, setBloodGroup] = useState('B+');
  const [allergies, setAllergies] = useState('Penicillin, Peanuts');
  const [chronicConditions, setChronicConditions] = useState('Hypertension, Type 2 Diabetes');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [emergencyRelation, setEmergencyRelation] = useState('Daughter');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Form states: Redeem Passcode
  const [passcode, setPasscode] = useState('');
  const [redeemInviteId, setRedeemInviteId] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemError, setRedeemError] = useState('');
  const [redeemSuccess, setRedeemSuccess] = useState('');

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
          const savedId = localStorage.getItem('jeevasetu_active_patient');
          const found = data.patients.find((p: any) => p.id === savedId) || data.patients[0];
          setActivePatient(found);
          localStorage.setItem('jeevasetu_active_patient', found.id);

          // Initial view selection based on login role choice or Firestore role
          const savedPreferredView = localStorage.getItem('jeevasetu_default_view');
          if (savedPreferredView === 'elderly' || savedPreferredView === 'caregiver' || savedPreferredView === 'family') {
            setActiveView(savedPreferredView);
          } else if (found.myRole === 'patient') {
            setActiveView('elderly');
          } else if (found.myRole === 'caregiver') {
            setActiveView('caregiver');
          } else {
            setActiveView('family');
          }
        } else {
          setActivePatient(null);
        }
      }
    } catch (e) {
      console.error('Failed fetching patients:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadContinuityData = async () => {
    if (!activePatient?.id) return;
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const headers = { Authorization: `Bearer ${token}` };
      const today = new Date().toISOString().split('T')[0];

      const [dosesRes, medsRes, apptsRes, tasksRes, handoversRes, membersRes, gapsRes] =
        await Promise.all([
          fetch(`/api/patients/${activePatient.id}/medications/doses?date=${today}`, { headers }),
          fetch(`/api/patients/${activePatient.id}/medications`, { headers }),
          fetch(`/api/patients/${activePatient.id}/appointments`, { headers }),
          fetch(`/api/patients/${activePatient.id}/tasks`, { headers }),
          fetch(`/api/patients/${activePatient.id}/handovers`, { headers }),
          fetch(`/api/patients/${activePatient.id}/members`, { headers }),
          fetch(`/api/patients/${activePatient.id}/gaps`, { headers }),
        ]);

      if (dosesRes.ok) {
        const d = await dosesRes.json();
        setDoses(d.doses || []);
      }
      if (medsRes.ok) {
        const m = await medsRes.json();
        setMedications(m.medications || []);
      }
      if (apptsRes.ok) {
        const a = await apptsRes.json();
        setAppointments(a.appointments || []);
      }
      if (tasksRes.ok) {
        const t = await tasksRes.json();
        setTasks(t.tasks || []);
      }
      if (handoversRes.ok) {
        const h = await handoversRes.json();
        setHandovers(h.handovers || []);
      }
      if (membersRes.ok) {
        const mem = await membersRes.json();
        setMembers(mem.members || []);
      }
      if (gapsRes.ok) {
        const g = await gapsRes.json();
        setGaps(g.gaps || []);
      }
    } catch (e) {
      console.warn('Failed loading continuity data:', e);
    }
  };

  useEffect(() => {
    loadPatients();
  }, []);

  useEffect(() => {
    if (activePatient?.id) {
      loadContinuityData();
    }
  }, [activePatient?.id]);

  // Synchronize Senior Mode with Elderly View
  useEffect(() => {
    if (mode === 'senior') {
      setActiveView('elderly');
    }
  }, [mode]);

  const handleCreatePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setCreateLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');
      const token = await user.getIdToken();

      const payload = {
        fullName,
        dateOfBirth: dob,
        bloodGroup,
        allergies: allergies.split(',').map((s) => s.trim()).filter(Boolean),
        chronicConditions: chronicConditions.split(',').map((s) => s.trim()).filter(Boolean),
        primaryLanguage: 'English',
        emergencyContact: {
          name: emergencyName,
          phone: emergencyPhone,
          relation: emergencyRelation,
        },
      };

      const res = await fetch('/api/patients', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create patient');
      }

      setShowCreatePatientModal(false);
      setFullName('');
      await loadPatients();
    } catch (err: any) {
      setCreateError(err.message || 'Creation failed');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleRedeemPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    setRedeemError('');
    setRedeemSuccess('');
    setRedeemLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');
      const token = await user.getIdToken();

      const res = await fetch('/api/invitations/redeem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          passcode: passcode.trim(),
          invitationId: redeemInviteId.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to redeem passcode');
      }

      setRedeemSuccess(data.message || 'Successfully joined care circle!');
      setPasscode('');
      setRedeemInviteId('');
      setTimeout(async () => {
        setShowRedeemModal(false);
        setRedeemSuccess('');
        await loadPatients();
      }, 1500);
    } catch (err: any) {
      setRedeemError(err.message || 'Failed to redeem passcode');
    } finally {
      setRedeemLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center text-slate-500 font-bold text-lg">
        Connecting to care records...
      </div>
    );
  }

  // State A: User is not yet part of any care circle
  if (!activePatient) {
    return (
      <div className="max-w-3xl mx-auto py-12 px-4">
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-3xl bg-brand-600 flex items-center justify-center text-white mx-auto shadow-lg shadow-brand-500/20 mb-4">
            <Heart className="w-8 h-8" />
          </div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Welcome to JEEVASETU</h2>
          <p className="text-lg text-slate-600 mt-2 max-w-lg mx-auto">
            You are not currently linked to an elderly care circle. You can set up a new profile for an elderly family member, or join an existing circle with an invitation passcode.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Card 1: Create Profile */}
          <Card className="flex flex-col justify-between hover:border-brand-300 transition shadow-md">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center mb-4">
                <PlusCircle className="w-7 h-7" />
              </div>
              <CardTitle className="text-2xl">Create Elder Profile</CardTitle>
              <CardDescription className="text-base mt-2">
                For family members setting up care coordination for their parent or elderly relative for the first time.
              </CardDescription>
            </div>
            <div className="pt-6">
              <Button onClick={() => setShowCreatePatientModal(true)} size="lg" className="w-full text-lg">
                Create Profile
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          </Card>

          {/* Card 2: Redeem Code */}
          <Card className="flex flex-col justify-between hover:border-warmth-500 transition shadow-md">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-warmth-100 text-warmth-700 flex items-center justify-center mb-4">
                <KeyRound className="w-7 h-7" />
              </div>
              <CardTitle className="text-2xl">Join with Passcode</CardTitle>
              <CardDescription className="text-base mt-2">
                For caregivers, nurses, or other relatives who received a secure 6-digit access passcode from the family.
              </CardDescription>
            </div>
            <div className="pt-6">
              <Button onClick={() => setShowRedeemModal(true)} variant="outline" size="lg" className="w-full text-lg">
                Enter Code
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          </Card>
        </div>

        {/* Modal: Create Patient */}
        {showCreatePatientModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl my-8">
              <h3 className="text-2xl font-black text-slate-900 mb-1">Create Elder Healthcare Profile</h3>
              <p className="text-sm text-slate-500 mb-6">
                You will be assigned as the Primary Family administrator for this profile.
              </p>

              {createError && (
                <div className="mb-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold">
                  {createError}
                </div>
              )}

              <form onSubmit={handleCreatePatient} className="space-y-4">
                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1">Elder&apos;s Full Name</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Smt. Kausalya Devi"
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-base font-bold text-slate-800 mb-1">Date of Birth</label>
                    <input
                      type="date"
                      required
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-base font-bold text-slate-800 mb-1">Blood Group</label>
                    <input
                      type="text"
                      required
                      value={bloodGroup}
                      onChange={(e) => setBloodGroup(e.target.value)}
                      placeholder="e.g. B+"
                      className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1">Known Allergies</label>
                  <input
                    type="text"
                    value={allergies}
                    onChange={(e) => setAllergies(e.target.value)}
                    placeholder="e.g. Penicillin, Sulfa"
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1">Chronic Conditions</label>
                  <input
                    type="text"
                    value={chronicConditions}
                    onChange={(e) => setChronicConditions(e.target.value)}
                    placeholder="e.g. Hypertension, Arthritis"
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>

                <div className="border-t border-slate-200 pt-4 mt-2">
                  <h4 className="text-base font-bold text-slate-900 mb-2">Emergency Contact</h4>
                  <div className="space-y-3">
                    <input
                      type="text"
                      required
                      value={emergencyName}
                      onChange={(e) => setEmergencyName(e.target.value)}
                      placeholder="Contact Name (e.g. Anita Sharma)"
                      className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="tel"
                        required
                        value={emergencyPhone}
                        onChange={(e) => setEmergencyPhone(e.target.value)}
                        placeholder="Phone Number"
                        className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                      />
                      <input
                        type="text"
                        required
                        value={emergencyRelation}
                        onChange={(e) => setEmergencyRelation(e.target.value)}
                        placeholder="Relation (e.g. Daughter)"
                        className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base focus:ring-2 focus:ring-brand-500 outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowCreatePatientModal(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" isLoading={createLoading} className="flex-1">
                    Save Profile
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Redeem Passcode */}
        {showRedeemModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl">
              <div className="w-12 h-12 rounded-2xl bg-warmth-100 text-warmth-700 flex items-center justify-center mb-4">
                <KeyRound className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-1">Enter Invitation Passcode</h3>
              <p className="text-sm text-slate-500 mb-6">
                Enter the 6-digit access code provided by the elder&apos;s family to join their care circle.
              </p>

              {redeemError && (
                <div className="mb-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold">
                  {redeemError}
                </div>
              )}

              {redeemSuccess && (
                <div className="mb-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>{redeemSuccess}</span>
                </div>
              )}

              <form onSubmit={handleRedeemPasscode} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-800 mb-1">Invitation ID</label>
                  <input
                    type="text"
                    required
                    value={redeemInviteId}
                    onChange={(e) => setRedeemInviteId(e.target.value.trim())}
                    placeholder="Enter Invitation ID from family"
                    className="w-full text-sm font-mono py-2.5 px-3.5 rounded-xl border border-slate-300 focus:border-brand-600 focus:ring-2 focus:ring-brand-200 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-base font-bold text-slate-800 mb-2">6-Digit Numerical Code</label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="w-full text-center tracking-widest text-3xl font-mono font-black py-4 rounded-2xl border-2 border-slate-300 focus:border-brand-600 focus:ring-2 focus:ring-brand-200 outline-none"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowRedeemModal(false);
                      setRedeemError('');
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" isLoading={redeemLoading} className="flex-1">
                    Redeem Code
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // State B: Active Care Profile View with 3 Dedicated Experiences Switcher
  return (
    <div className="space-y-6">
      {/* Three Genuinely Distinct Experiences Switcher Bar */}
      <div className="flex items-center justify-between bg-white border border-slate-200 p-2 sm:p-2.5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
          <button
            onClick={() => {
              setActiveView('elderly');
              if (typeof window !== 'undefined') localStorage.setItem('jeevasetu_default_view', 'elderly');
            }}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition min-h-[44px] cursor-pointer ${
              activeView === 'elderly'
                ? 'bg-emerald-700 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Heart className="w-4 h-4 text-emerald-300" />
            <span>Elderly Mode</span>
          </button>

          <button
            onClick={() => {
              setActiveView('family');
              if (typeof window !== 'undefined') localStorage.setItem('jeevasetu_default_view', 'family');
            }}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition min-h-[44px] cursor-pointer ${
              activeView === 'family'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4 text-brand-200" />
            <span>Family Overview</span>
          </button>

          <button
            onClick={() => {
              setActiveView('caregiver');
              if (typeof window !== 'undefined') localStorage.setItem('jeevasetu_default_view', 'caregiver');
            }}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition min-h-[44px] cursor-pointer ${
              activeView === 'caregiver'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <CheckSquare className="w-4 h-4 text-emerald-400" />
            <span>Caregiver Shift</span>
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs font-semibold text-slate-500 pr-2">
          <span>Active Role:</span>
          <span className="font-bold text-slate-900 capitalize px-2 py-0.5 rounded bg-slate-100">
            {activePatient.myRole?.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Viewport 1: Elderly Patient Dashboard (Elderly Mode) */}
      {activeView === 'elderly' && (
        <ElderlyPatientDashboard
          patient={activePatient}
          doses={doses}
          appointments={appointments}
          medications={medications}
          onActionComplete={loadContinuityData}
        />
      )}

      {/* Viewport 2: Family Command Centre */}
      {activeView === 'family' && (
        <FamilyCommandCenter
          patient={activePatient}
          doses={doses}
          medications={medications}
          appointments={appointments}
          members={members}
          careGaps={gaps}
          handovers={handovers}
          onOpenInviteModal={
            activePatient.myRole === 'primary_family'
              ? () => {
                  window.location.href = `/patient/${activePatient.id}`;
                }
              : undefined
          }
        />
      )}

      {/* Viewport 3: Dedicated Caregiver Shift Workspace */}
      {activeView === 'caregiver' && (
        <CaregiverShiftWorkspace
          patient={activePatient}
          patientsList={patients}
          onSelectPatient={(p) => setActivePatient(p)}
          doses={doses}
          medications={medications}
          tasks={tasks}
          handovers={handovers}
          members={members}
          onRefreshData={loadContinuityData}
        />
      )}

      {/* System Health Status Card */}
      <SystemHealthCard />
    </div>
  );
}
