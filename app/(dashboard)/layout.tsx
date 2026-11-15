'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase/client';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Navbar } from '@/components/navigation/navbar';
import { CareModeProvider } from '@/context/CareModeContext';
import { purgeOfflineData } from '@/lib/offline/idb-outbox';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPatient, setCurrentPatient] = useState<{ id: string; name: string; role: string } | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setUser(null);
        setLoading(false);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('jeevasetu_active_patient');
        }
        await purgeOfflineData().catch(console.warn);
        router.push('/login');
        return;
      }

      setUser(currentUser);
      setLoading(false);

      // Load patient context from localStorage or fetch first accessible patient
      try {
        const token = await currentUser.getIdToken();
        const res = await fetch('/api/patients', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.patients && data.patients.length > 0) {
            const savedPatientId = localStorage.getItem('jeevasetu_active_patient');
            const active = data.patients.find((p: any) => p.id === savedPatientId) || data.patients[0];
            setCurrentPatient({
              id: active.id,
              name: active.fullName,
              role: active.myRole || 'care_circle',
            });
            localStorage.setItem('jeevasetu_active_patient', active.id);
          }
        }
      } catch (e) {
        console.error('Failed fetching patients context:', e);
      }
    });

    return () => unsubscribe();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <div className="w-16 h-16 rounded-3xl bg-brand-600 flex items-center justify-center text-white shadow-lg animate-pulse mb-4">
          <span className="text-2xl font-black">JS</span>
        </div>
        <p className="text-lg font-bold text-slate-800">Loading JEEVASETU...</p>
        <p className="text-sm text-slate-500">Connecting to care circle</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <CareModeProvider>
      <div className="min-h-screen flex flex-col bg-slate-50">
        <Navbar
          currentPatientId={currentPatient?.id}
          patientName={currentPatient?.name}
          userRole={currentPatient?.role}
          userEmail={user.email || undefined}
        />
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
      </div>
    </CareModeProvider>
  );
}
