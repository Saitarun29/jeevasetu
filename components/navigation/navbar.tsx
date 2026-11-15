'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, Users, Calendar, Clock, Activity, LogOut, ShieldCheck, CheckSquare } from 'lucide-react';
import { auth } from '@/lib/firebase/client';
import { signOut } from 'firebase/auth';
import { purgeOfflineData } from '@/lib/offline/idb-outbox';
import { SeniorModeToggle } from '@/components/elderly/SeniorModeToggle';
import { SyncStatusBadge } from '@/components/offline/SyncStatusBadge';

interface NavbarProps {
  currentPatientId?: string;
  patientName?: string;
  userRole?: string;
  userEmail?: string;
}

export function Navbar({ currentPatientId, patientName, userRole, userEmail }: NavbarProps) {
  const pathname = usePathname();

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      // Security: purge cached PHI (medications, appointments, outbox) from
      // IndexedDB so the next user on a shared device cannot read it.
      await purgeOfflineData();
      window.location.href = '/login';
    } catch (e) {
      console.error('Logout error:', e);
    }
  };

  const navLinks = [
    { href: '/', label: 'Overview', icon: Activity },
    { href: '/medications', label: 'Medications', icon: Heart },
    { href: '/appointments', label: 'Appointments', icon: Calendar },
    { href: '/timeline', label: 'Timeline', icon: Clock },
    { href: '/tasks', label: 'Tasks & Handover', icon: CheckSquare },
    ...(currentPatientId ? [{ href: `/patient/${currentPatientId}`, label: 'Care Circle', icon: Users }] : []),
  ];

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-12 h-12 rounded-2xl bg-brand-600 flex items-center justify-center text-white shadow-md shadow-brand-500/20 group-hover:bg-brand-700 transition">
              <Heart className="w-7 h-7 fill-white/20" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black tracking-tight text-slate-900">JEEVASETU</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-brand-100 text-brand-800 font-bold tracking-wide uppercase">
                  जीवसेतु
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">A bridge between generations</p>
            </div>
          </Link>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 px-4 py-3 rounded-xl text-base font-semibold transition ${
                    isActive
                      ? 'bg-brand-50 text-brand-700 font-bold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Patient Context & User Menu */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            <div className="flex items-center gap-1 sm:gap-2">
              <SyncStatusBadge patientId={currentPatientId} />
              <SeniorModeToggle />
            </div>

            {patientName && (
              <div className="hidden sm:flex flex-col items-end px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <span className="text-xs font-semibold text-slate-500">Caring for</span>
                <span className="text-sm font-bold text-slate-800">{patientName}</span>
              </div>
            )}

            {userRole && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold uppercase tracking-wider">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>{userRole.replace('_', ' ')}</span>
              </div>
            )}

            <button
              onClick={handleSignOut}
              title="Sign out"
              className="p-3 rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition border border-transparent hover:border-rose-100 min-h-[48px] min-w-[48px] flex items-center justify-center cursor-pointer"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Thumb-Reachable Mobile Bottom Navigation (Strictly < md viewports) */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 h-16 flex items-center justify-around px-2 shadow-lg md:hidden"
        aria-label="Mobile Navigation"
      >
        {navLinks.slice(0, 5).map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-bold transition min-h-[48px] ${
                isActive ? 'text-brand-700' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className={`w-5 h-5 mb-0.5 ${isActive ? 'text-brand-600' : 'text-slate-400'}`} />
              <span className="truncate max-w-[64px]">{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
