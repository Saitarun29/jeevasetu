'use client';

import React, { useState } from 'react';
import { X, ShieldAlert, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase/client';
import { IncidentCategory, IncidentSeverity } from '@/types/incident';

interface IncidentReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
  onSuccess?: () => void;
}

export function IncidentReportModal({
  isOpen,
  onClose,
  patientId,
  patientName,
  onSuccess,
}: IncidentReportModalProps) {
  const [category, setCategory] = useState<IncidentCategory>('general_observation');
  const [severity, setSeverity] = useState<IncidentSeverity>('routine');
  const [description, setDescription] = useState<string>('');
  const [actionTaken, setActionTaken] = useState<string>('');
  const [familyNotified, setFamilyNotified] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');
      const token = await user.getIdToken();

      const payload = {
        category,
        severity,
        description: description.trim(),
        actionTaken: actionTaken.trim() || undefined,
        familyNotified,
      };

      const res = await fetch(`/api/patients/${patientId}/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit incident report');
      }

      setSuccess('Incident report recorded and logged to care timeline!');
      setTimeout(() => {
        if (onSuccess) onSuccess();
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Failed recording incident');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="incident-modal-title"
    >
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl my-8 relative border-2 border-slate-200">
        <div className="flex items-center justify-between border-b pb-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 id="incident-modal-title" className="text-xl font-black text-slate-900">
                Record Clinical Observation
              </h3>
              <p className="text-xs text-slate-500">Caring for {patientName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close incident modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mb-4 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-sm font-semibold text-slate-800">
          {/* Category */}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
              Observation Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as any)}
              className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm font-semibold outline-none focus:ring-2 focus:ring-brand-500 min-h-[48px] bg-white"
            >
              <option value="general_observation">General Clinical Observation</option>
              <option value="fall">Fall or Slip Incident</option>
              <option value="medication_refusal">Medication Refusal</option>
              <option value="confusion">Confusion or Disorientation</option>
              <option value="pain_complaint">Acute Pain Complaint</option>
              <option value="adverse_reaction">Suspected Drug Reaction / Rash</option>
              <option value="mood_change">Marked Mood or Behavioral Change</option>
            </select>
          </div>

          {/* Severity */}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
              Clinical Severity
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['routine', 'unusual', 'urgent'] as IncidentSeverity[]).map((sev) => (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setSeverity(sev)}
                  className={`py-2.5 px-3 rounded-xl border-2 text-xs font-bold capitalize transition min-h-[44px] ${
                    severity === sev
                      ? sev === 'urgent'
                        ? 'border-rose-600 bg-rose-50 text-rose-800'
                        : sev === 'unusual'
                        ? 'border-amber-600 bg-amber-50 text-amber-800'
                        : 'border-slate-800 bg-slate-900 text-white'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  {sev}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
              What did you observe? (Mandatory)
            </label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Patient appeared dizzy after standing from the armchair; rested for 10 minutes with water."
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Action Taken */}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
              Immediate Action Taken
            </label>
            <textarea
              rows={2}
              value={actionTaken}
              onChange={(e) => setActionTaken(e.target.value)}
              placeholder="e.g. Checked blood pressure (118/76), assisted elder back to bed."
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Family notified checkbox */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="familyNotified"
              checked={familyNotified}
              onChange={(e) => setFamilyNotified(e.target.checked)}
              className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 border-slate-300"
            >
            </input>
            <label htmlFor="familyNotified" className="text-xs font-bold text-slate-700 cursor-pointer">
              Primary family was notified via telephone
            </label>
          </div>

          <div className="flex gap-3 pt-3">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 min-h-[48px]">
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={loading}
              className={`flex-1 min-h-[48px] ${
                severity === 'urgent'
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'bg-brand-600 hover:bg-brand-700'
              }`}
            >
              Submit Report
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
