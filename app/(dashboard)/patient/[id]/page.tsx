'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import {
  Users,
  Shield,
  KeyRound,
  UserPlus,
  Copy,
  Check,
  AlertTriangle,
  UserX,
  Phone,
  ArrowLeft,
  Heart,
  Calendar,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { auth } from '@/lib/firebase/client';
import { EmergencyCareCard } from '@/components/emergency/EmergencyCareCard';

export default function PatientCareCirclePage() {
  const params = useParams();
  const patientId = params.id as string;

  const [patient, setPatient] = useState<any>(null);
  const [medications, setMedications] = useState<any[]>([]);
  const [showEmergencyCard, setShowEmergencyCard] = useState<boolean>(false);
  const [members, setMembers] = useState<any[]>([]);
  const [myMembership, setMyMembership] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Invite Modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [targetRole, setTargetRole] = useState<'family_member' | 'caregiver'>('caregiver');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [generatedPasscode, setGeneratedPasscode] = useState<string | null>(null);
  const [generatedInvitationId, setGeneratedInvitationId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteError, setInviteError] = useState('');

  // Revoke State
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();

      // Fetch patient profile & active medications
      const [pRes, mRes] = await Promise.all([
        fetch(`/api/patients/${patientId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/patients/${patientId}/medications`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!pRes.ok) throw new Error('Failed to load patient');
      const pData = await pRes.json();
      setPatient(pData.patient);
      setMyMembership(pData.myMembership);

      if (mRes.ok) {
        const mData = await mRes.json();
        setMedications(mData.medications || []);
      }

      // Fetch members
      const membersRes = await fetch(`/api/patients/${patientId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (membersRes.ok) {
        const mData = await membersRes.json();
        setMembers(mData.members || []);
      }
    } catch (e: any) {
      setError(e.message || 'Error loading care circle');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [patientId]);

  const handleGenerateInvite = async () => {
    setInviteLoading(true);
    setInviteError('');
    setGeneratedPasscode(null);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');
      const token = await user.getIdToken();

      const res = await fetch(`/api/patients/${patientId}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetRole }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate invitation');
      }

      setGeneratedPasscode(data.passcode);
      setGeneratedInvitationId(data.invitationId);
      setExpiresAt(data.expiresAt);
    } catch (err: any) {
      setInviteError(err.message || 'Failed to create passcode');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyPasscode = () => {
    if (!generatedPasscode) return;
    navigator.clipboard.writeText(generatedPasscode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (targetUserId: string) => {
    if (!confirm('Are you sure you want to revoke this user access immediately?')) return;
    setRevokingId(targetUserId);

    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();

      const res = await fetch(`/api/patients/${patientId}/members`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetUserId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Revoke failed');
      }

      await fetchData();
    } catch (e: any) {
      alert(e.message || 'Failed to revoke access');
    } finally {
      setRevokingId(null);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-500 font-medium">
        Loading care circle records...
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="py-12 text-center text-rose-600 font-bold">
        {error || 'Patient not found'}
      </div>
    );
  }

  const isPrimaryFamily = myMembership?.role === 'primary_family';

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-800 mb-2 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Dashboard</span>
          </Link>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Care Circle & Access Management</h1>
          <p className="text-slate-600 font-medium mt-1">
            Authoritative care circle for <span className="font-bold text-slate-900">{patient.fullName}</span>
          </p>
        </div>

        {isPrimaryFamily && (
          <Button
            onClick={() => {
              setShowInviteModal(true);
              setGeneratedPasscode(null);
              setInviteError('');
            }}
            size="lg"
            className="gap-2 shadow-md shadow-brand-600/20"
          >
            <UserPlus className="w-5 h-5" />
            <span>Invite Circle Member</span>
          </Button>
        )}
      </div>

      {/* Profile Overview Card */}
      <Card className="bg-gradient-to-br from-slate-900 to-slate-800 text-white border-0 shadow-lg">
        <div className="grid md:grid-cols-3 gap-6">
          <div>
            <span className="text-xs font-bold text-brand-400 uppercase tracking-widest">Elder Profile</span>
            <h3 className="text-2xl font-black mt-1">{patient.fullName}</h3>
            <p className="text-sm text-slate-300 mt-1">DOB: {patient.dateOfBirth} (Blood: {patient.bloodGroup})</p>
            <p className="text-sm text-slate-300">Language: {patient.primaryLanguage}</p>
          </div>
          <div>
            <span className="text-xs font-bold text-brand-400 uppercase tracking-widest">Medical Flags</span>
            <p className="text-sm text-slate-200 mt-1">
              <span className="font-bold">Allergies:</span>{' '}
              {patient.allergies?.length > 0 ? patient.allergies.join(', ') : 'None'}
            </p>
            <p className="text-sm text-slate-200 mt-1">
              <span className="font-bold">Conditions:</span>{' '}
              {patient.chronicConditions?.length > 0 ? patient.chronicConditions.join(', ') : 'None'}
            </p>
          </div>
          {patient.emergencyContact && (
            <div>
              <span className="text-xs font-bold text-rose-400 uppercase tracking-widest">Emergency Contact</span>
              <p className="text-lg font-bold text-white mt-1">{patient.emergencyContact.name}</p>
              <p className="text-sm text-slate-300">{patient.emergencyContact.relation}</p>
              <a
                href={`tel:${patient.emergencyContact.phone}`}
                className="inline-flex items-center gap-1.5 text-sm font-bold text-rose-400 hover:text-rose-300 mt-2"
              >
                <Phone className="w-4 h-4" />
                <span>{patient.emergencyContact.phone}</span>
              </a>
            </div>
          )}
        </div>
      </Card>

      {/* Emergency Care Continuity Card Toggle & View */}
      <div className="bg-white rounded-xl border p-4 shadow-sm flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-base font-bold text-slate-900">Emergency Care Continuity Card</h4>
            <p className="text-xs text-slate-500">
              Printable card for wallet or emergency first responders with verified vital flags and medications.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setShowEmergencyCard(!showEmergencyCard)}
            className="text-xs font-bold"
          >
            {showEmergencyCard ? 'Hide Card' : 'View & Print Emergency Card'}
          </Button>
        </div>

        {showEmergencyCard && (
          <EmergencyCareCard patient={patient} medications={medications} />
        )}
      </div>

      {/* Members Section */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4">
          <div>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Users className="w-6 h-6 text-brand-600" />
              <span>Authorized Care Circle Members</span>
            </CardTitle>
            <CardDescription>
              Patient-specific membership records are the authoritative source for access permissions.
            </CardDescription>
          </div>
          <span className="text-xs px-3 py-1 rounded-full bg-slate-100 font-bold text-slate-700">
            {members.length} {members.length === 1 ? 'Member' : 'Members'}
          </span>
        </CardHeader>

        <div className="divide-y divide-slate-100">
          {members.map((member) => {
            const isSelf = member.userId === auth.currentUser?.uid;
            const isRevoked = member.status === 'revoked';

            return (
              <div key={member.userId} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-lg ${
                      member.role === 'primary_family'
                        ? 'bg-amber-100 text-amber-800'
                        : member.role === 'caregiver'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {member.displayName?.charAt(0) || 'U'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-base font-bold text-slate-900">{member.displayName}</h4>
                      {isSelf && (
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">
                          You
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 font-medium">{member.email}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Joined: {member.joinedAt?.slice(0, 10)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center">
                  <span
                    className={`text-xs px-3 py-1.5 rounded-xl font-bold uppercase tracking-wider ${
                      isRevoked
                        ? 'bg-rose-100 text-rose-800'
                        : member.role === 'primary_family'
                        ? 'bg-amber-100 text-amber-800 border border-amber-200'
                        : member.role === 'caregiver'
                        ? 'bg-blue-100 text-blue-800 border border-blue-200'
                        : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    }`}
                  >
                    {isRevoked ? 'REVOKED' : member.role.replace('_', ' ')}
                  </span>

                  {/* Immediate Revoke Action */}
                  {isPrimaryFamily && !isSelf && !isRevoked && (
                    <Button
                      onClick={() => handleRevoke(member.userId)}
                      variant="outline"
                      size="sm"
                      isLoading={revokingId === member.userId}
                      className="text-rose-600 border-rose-200 hover:bg-rose-50 hover:border-rose-300"
                    >
                      <UserX className="w-4 h-4 mr-1.5" />
                      <span>Revoke</span>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Modal: Generate Passcode Invitation */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center mb-4">
              <KeyRound className="w-6 h-6" />
            </div>

            <h3 className="text-2xl font-black text-slate-900 mb-1">Invite Care Circle Member</h3>
            <p className="text-sm text-slate-500 mb-6">
              Generate a single-use, 6-digit access passcode valid for 24 hours.
            </p>

            {inviteError && (
              <div className="mb-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold">
                {inviteError}
              </div>
            )}

            {!generatedPasscode ? (
              <div className="space-y-5">
                <div>
                  <label className="block text-base font-bold text-slate-800 mb-2">Target Role</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setTargetRole('caregiver')}
                      className={`p-4 rounded-2xl border-2 text-left transition ${
                        targetRole === 'caregiver'
                          ? 'border-brand-600 bg-brand-50/50 text-brand-900'
                          : 'border-slate-200 hover:border-slate-300 text-slate-700'
                      }`}
                    >
                      <span className="block font-bold text-base">Caregiver</span>
                      <span className="block text-xs text-slate-500 mt-1">
                        Can log doses, view visits & handle handovers
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTargetRole('family_member')}
                      className={`p-4 rounded-2xl border-2 text-left transition ${
                        targetRole === 'family_member'
                          ? 'border-brand-600 bg-brand-50/50 text-brand-900'
                          : 'border-slate-200 hover:border-slate-300 text-slate-700'
                      }`}
                    >
                      <span className="block font-bold text-base">Family Member</span>
                      <span className="block text-xs text-slate-500 mt-1">
                        Full care visibility, adherence and appointments
                      </span>
                    </button>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowInviteModal(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleGenerateInvite}
                    isLoading={inviteLoading}
                    className="flex-1"
                  >
                    Generate Passcode
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-6 text-center">
                <div className="p-6 rounded-3xl bg-brand-50 border-2 border-brand-200">
                  <span className="text-xs font-bold text-brand-700 uppercase tracking-widest block mb-2">
                    6-Digit Invitation Passcode
                  </span>
                  <div className="text-5xl font-mono font-black text-brand-900 tracking-wider">
                    {generatedPasscode}
                  </div>
                  {generatedInvitationId && (
                    <div className="mt-3 pt-3 border-t border-brand-200">
                      <span className="text-xs text-slate-500 font-semibold block">Invitation ID:</span>
                      <code className="text-xs font-mono font-bold text-slate-800 break-all select-all">
                        {generatedInvitationId}
                      </code>
                    </div>
                  )}
                  <p className="text-xs text-brand-700 font-semibold mt-3">
                    Role: <span className="uppercase">{targetRole.replace('_', ' ')}</span> • Single Use Only
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-left flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-900 font-medium">
                    Share this 6-digit code and Invitation ID with the invitee. It expires in 24 hours and is hashed at rest. Maximum 5 entry attempts.
                  </p>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={() => {
                      if (!generatedPasscode) return;
                      const text = generatedInvitationId
                        ? `Invitation ID: ${generatedInvitationId}\nPasscode: ${generatedPasscode}`
                        : generatedPasscode;
                      navigator.clipboard.writeText(text);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    variant="outline"
                    className="flex-1 gap-2"
                  >
                    {copied ? <Check className="w-5 h-5 text-emerald-600" /> : <Copy className="w-5 h-5" />}
                    <span>{copied ? 'Copied!' : 'Copy Invite'}</span>
                  </Button>
                  <Button
                    onClick={() => {
                      setShowInviteModal(false);
                      setGeneratedPasscode(null);
                      setGeneratedInvitationId(null);
                    }}
                    className="flex-1"
                  >
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
