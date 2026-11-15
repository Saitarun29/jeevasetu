'use client';

import React, { useState } from 'react';
import { X, Activity, Heart, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase/client';

interface VitalsLoggerModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
  onSuccess?: () => void;
}

export function VitalsLoggerModal({
  isOpen,
  onClose,
  patientId,
  patientName,
  onSuccess,
}: VitalsLoggerModalProps) {
  const [systolic, setSystolic] = useState<string>('120');
  const [diastolic, setDiastolic] = useState<string>('80');
  const [glucose, setGlucose] = useState<string>('110');
  const [glucoseContext, setGlucoseContext] = useState<'fasting' | 'post_meal' | 'random'>('random');
  const [heartRate, setHeartRate] = useState<string>('72');
  const [oxygen, setOxygen] = useState<string>('98');
  const [temperature, setTemperature] = useState<string>('98.6');
  const [notes, setNotes] = useState<string>('');
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

      const payload: any = {
        glucoseContext,
        notes: notes.trim() || undefined,
      };

      if (systolic && diastolic) {
        payload.bloodPressureSystolic = parseInt(systolic, 10);
        payload.bloodPressureDiastolic = parseInt(diastolic, 10);
      }
      if (glucose) payload.bloodGlucose = parseFloat(glucose);
      if (heartRate) payload.heartRate = parseInt(heartRate, 10);
      if (oxygen) payload.oxygenSaturation = parseFloat(oxygen);
      if (temperature) payload.temperatureFahrenheit = parseFloat(temperature);

      const res = await fetch(`/api/patients/${patientId}/vitals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record vitals');
      }

      setSuccess('Patient vitals recorded and saved to care timeline!');
      setTimeout(() => {
        if (onSuccess) onSuccess();
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Failed recording vitals');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vitals-modal-title"
    >
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl my-8 relative">
        <div className="flex items-center justify-between border-b pb-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <h3 id="vitals-modal-title" className="text-xl font-black text-slate-900">
                Log Vitals Measurement
              </h3>
              <p className="text-xs text-slate-500">Caring for {patientName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close vitals modal"
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
          {/* Blood Pressure Row */}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
              Blood Pressure (Systolic / Diastolic mmHg)
            </label>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                min={60}
                max={260}
                value={systolic}
                onChange={(e) => setSystolic(e.target.value)}
                placeholder="Systolic (120)"
                className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base font-mono outline-none focus:ring-2 focus:ring-emerald-500 min-h-[48px]"
              />
              <input
                type="number"
                min={30}
                max={150}
                value={diastolic}
                onChange={(e) => setDiastolic(e.target.value)}
                placeholder="Diastolic (80)"
                className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base font-mono outline-none focus:ring-2 focus:ring-emerald-500 min-h-[48px]"
              />
            </div>
          </div>

          {/* Blood Glucose */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
                Blood Glucose (mg/dL)
              </label>
              <input
                type="number"
                min={20}
                max={600}
                value={glucose}
                onChange={(e) => setGlucose(e.target.value)}
                placeholder="110"
                className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base font-mono outline-none focus:ring-2 focus:ring-emerald-500 min-h-[48px]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
                Timing Context
              </label>
              <select
                value={glucoseContext}
                onChange={(e) => setGlucoseContext(e.target.value as any)}
                className="w-full px-3 py-3 rounded-xl border border-slate-300 text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500 min-h-[48px] bg-white"
              >
                <option value="random">Random</option>
                <option value="fasting">Fasting</option>
                <option value="post_meal">Post-Meal (2h)</option>
              </select>
            </div>
          </div>

          {/* SpO2 & Heart Rate */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
                Oxygen Saturation (SpO2 %)
              </label>
              <input
                type="number"
                min={50}
                max={100}
                value={oxygen}
                onChange={(e) => setOxygen(e.target.value)}
                placeholder="98"
                className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base font-mono outline-none focus:ring-2 focus:ring-emerald-500 min-h-[48px]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
                Heart Rate (bpm)
              </label>
              <input
                type="number"
                min={30}
                max={220}
                value={heartRate}
                onChange={(e) => setHeartRate(e.target.value)}
                placeholder="72"
                className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base font-mono outline-none focus:ring-2 focus:ring-emerald-500 min-h-[48px]"
              />
            </div>
          </div>

          {/* Temperature */}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
              Body Temperature (°F)
            </label>
            <input
              type="number"
              step="0.1"
              min={90}
              max={110}
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              placeholder="98.6"
              className="w-full px-4 py-3 rounded-xl border border-slate-300 text-base font-mono outline-none focus:ring-2 focus:ring-emerald-500 min-h-[48px]"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
              Clinical Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Elder was calm, resting comfortably in bed after lunch."
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 min-h-[48px]">
              Cancel
            </Button>
            <Button type="submit" isLoading={loading} className="flex-1 bg-emerald-600 hover:bg-emerald-700 min-h-[48px]">
              Save Vitals
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
