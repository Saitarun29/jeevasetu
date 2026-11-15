'use client';

import { PatientProfile } from '@/types/patient';
import { Medication } from '@/types/medication';
import { Printer, Phone, AlertCircle, ShieldAlert, Heart, Activity } from 'lucide-react';

interface EmergencyCareCardProps {
  patient: PatientProfile;
  medications?: Medication[];
}

export function EmergencyCareCard({ patient, medications = [] }: EmergencyCareCardProps) {
  const handlePrint = () => {
    window.print();
  };

  const activeMedications = medications.filter((m) => m.isActive && !m.isArchived);

  return (
    <div className="bg-white rounded-xl shadow-md border-2 border-slate-300 p-6 max-w-2xl mx-auto my-6 print:shadow-none print:border-2 print:border-black print:m-0 print:p-4 print:max-w-none">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b-2 border-slate-200 pb-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="bg-red-600 text-white p-2.5 rounded-lg">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">
              EMERGENCY CARE CONTINUITY CARD
            </h2>
            <p className="text-xs font-semibold text-slate-600">
              JEEVASETU (जीवसेतु) — Critical Medical & Emergency Contacts
            </p>
          </div>
        </div>
        <button
          onClick={handlePrint}
          className="print:hidden flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm"
        >
          <Printer className="w-4 h-4" />
          <span>Print Card</span>
        </button>
      </div>

      {/* Patient Vital Identity */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
        <div>
          <span className="block text-xs font-bold text-slate-500 uppercase">Patient Name</span>
          <span className="text-lg font-black text-slate-900">{patient.fullName}</span>
        </div>
        <div>
          <span className="block text-xs font-bold text-slate-500 uppercase">Blood Group</span>
          <span className="text-lg font-black text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-200 inline-block">
            {patient.bloodGroup}
          </span>
        </div>
        <div>
          <span className="block text-xs font-bold text-slate-500 uppercase">Date of Birth</span>
          <span className="text-sm font-bold text-slate-800">{patient.dateOfBirth}</span>
        </div>
        <div>
          <span className="block text-xs font-bold text-slate-500 uppercase">Primary Language</span>
          <span className="text-sm font-bold text-slate-800">{patient.primaryLanguage || 'English / Hindi'}</span>
        </div>
      </div>

      {/* Emergency Contact */}
      <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-4">
        {patient.emergencyContact ? (
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-black text-red-800 uppercase tracking-wide flex items-center gap-1.5">
                <Phone className="w-4 h-4 text-red-600" />
                PRIMARY EMERGENCY CONTACT
              </span>
              <div className="text-base font-bold text-slate-900 mt-1">
                {patient.emergencyContact.name} ({patient.emergencyContact.relation})
              </div>
            </div>
            <a
              href={`tel:${patient.emergencyContact.phone}`}
              className="text-base font-black text-red-700 bg-white border border-red-300 px-3 py-1.5 rounded-lg shadow-sm hover:bg-red-100 transition-colors"
            >
              {patient.emergencyContact.phone}
            </a>
          </div>
        ) : (
          <div className="text-xs text-red-700 font-semibold italic">
            No primary emergency contact specified. Please update patient profile.
          </div>
        )}
      </div>

      {/* Allergies & Conditions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="border border-slate-200 rounded-lg p-3 bg-white">
          <span className="text-xs font-bold text-slate-500 uppercase block mb-1.5 flex items-center gap-1 text-rose-700">
            <AlertCircle className="w-3.5 h-3.5" />
            Documented Allergies
          </span>
          {patient.allergies && patient.allergies.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {patient.allergies.map((all, i) => (
                <span
                  key={i}
                  className="bg-rose-100 text-rose-900 border border-rose-200 px-2.5 py-0.5 rounded-full text-xs font-bold"
                >
                  {all}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-slate-500 italic">No known drug allergies recorded.</span>
          )}
        </div>

        <div className="border border-slate-200 rounded-lg p-3 bg-white">
          <span className="text-xs font-bold text-slate-500 uppercase block mb-1.5 flex items-center gap-1 text-indigo-700">
            <Activity className="w-3.5 h-3.5" />
            Chronic Medical Conditions
          </span>
          {patient.chronicConditions && patient.chronicConditions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {patient.chronicConditions.map((cond, i) => (
                <span
                  key={i}
                  className="bg-indigo-50 text-indigo-900 border border-indigo-200 px-2.5 py-0.5 rounded-full text-xs font-bold"
                >
                  {cond}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-slate-500 italic">No chronic conditions listed.</span>
          )}
        </div>
      </div>

      {/* Active Prescription Summary */}
      <div className="border border-slate-200 rounded-lg p-3 bg-white">
        <span className="text-xs font-bold text-slate-700 uppercase block mb-2 flex items-center gap-1.5">
          <Heart className="w-3.5 h-3.5 text-slate-600" />
          Active Prescribed Medications ({activeMedications.length})
        </span>
        {activeMedications.length > 0 ? (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600 font-bold">
                <th className="py-1">Medication</th>
                <th className="py-1">Dosage</th>
                <th className="py-1">Daily Schedule</th>
                <th className="py-1">Prescribing Doctor</th>
              </tr>
            </thead>
            <tbody>
              {activeMedications.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 font-medium text-slate-900">
                  <td className="py-1.5 font-bold">{m.name}</td>
                  <td className="py-1.5">{m.dosage} ({m.form})</td>
                  <td className="py-1.5">{m.times ? m.times.join(', ') : 'Daily'}</td>
                  <td className="py-1.5 text-slate-600">{m.prescribedBy || 'Primary Physician'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <span className="text-xs text-slate-500 italic">No active prescriptions on file.</span>
        )}
      </div>

      {/* Footer Instructions */}
      <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
        <span>In emergency, please present this card to attending medical personnel or paramedics.</span>
        <span className="font-bold text-slate-700">JEEVASETU Care Continuity</span>
      </div>
    </div>
  );
}
