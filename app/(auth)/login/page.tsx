'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Heart, Lock, Mail, ArrowRight, ShieldCheck, User, Users, Stethoscope, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { auth } from '@/lib/firebase/client';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';

export type UserRoleChoice = 'elderly' | 'caregiver' | 'family';

export default function LoginPage() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRoleChoice>('family');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Read any pre-selected role from URL or storage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const roleParam = params.get('role') as UserRoleChoice | null;
      if (roleParam === 'elderly' || roleParam === 'caregiver' || roleParam === 'family') {
        setSelectedRole(roleParam);
      } else {
        const saved = localStorage.getItem('jeevasetu_default_view') as UserRoleChoice | null;
        if (saved === 'elderly' || saved === 'caregiver' || saved === 'family') {
          setSelectedRole(saved);
        }
      }
    }
  }, []);

  const handleRoleSelect = (role: UserRoleChoice) => {
    setSelectedRole(role);
    setError('');
  };

  const applyRolePreferences = (role: UserRoleChoice) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('jeevasetu_default_view', role);
      if (role === 'elderly') {
        localStorage.setItem('jeevasetu_mode', 'senior');
        localStorage.setItem('jeevasetu_font_size', 'large');
        localStorage.setItem('jeevasetu_contrast', 'high');
      } else {
        localStorage.setItem('jeevasetu_mode', 'standard');
        localStorage.setItem('jeevasetu_contrast', 'normal');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isSignUp) {
        if (!displayName.trim()) {
          setError('Please enter your full name');
          setLoading(false);
          return;
        }
        const userCred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(userCred.user, { displayName: displayName.trim() });
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }

      // Persist chosen persona and display mode
      applyRolePreferences(selectedRole);

      router.push('/');
    } catch (err: any) {
      console.error('Auth error:', err);
      let msg = err.message || 'Authentication failed';
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        msg = 'Incorrect email or password. Please try again.';
      } else if (err.code === 'auth/email-already-in-use') {
        msg = 'An account with this email already exists. Please sign in instead.';
      } else if (err.code === 'auth/weak-password') {
        msg = 'Password should be at least 6 characters.';
      } else if (err.code === 'auth/api-key-not-valid') {
        msg = 'Firebase API key is being initialized. Please ensure environment variables are configured on Vercel and redeployed.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Quick fill helper for hackathon demo testing
  const handleQuickDemoFill = (role: UserRoleChoice) => {
    handleRoleSelect(role);
    if (role === 'elderly') {
      setEmail('kausalya.elderly@jeevasetu.demo');
      setPassword('CareDemo2026!');
      setDisplayName('Smt. Kausalya Devi');
    } else if (role === 'caregiver') {
      setEmail('nurse.anita@jeevasetu.demo');
      setPassword('CareDemo2026!');
      setDisplayName('Nurse Anita Sharma');
    } else {
      setEmail('rajesh.family@jeevasetu.demo');
      setPassword('CareDemo2026!');
      setDisplayName('Rajesh Sharma (Son)');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50/70 via-slate-50 to-slate-100 flex flex-col justify-center py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-lg">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-3xl bg-brand-600 flex items-center justify-center text-white shadow-xl shadow-brand-500/25 mb-3">
            <Heart className="w-9 h-9 fill-white/20" />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">JEEVASETU</h1>
          <p className="text-base text-brand-800 font-bold mt-0.5">A bridge between generations</p>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-sm">
            Accountable elderly care coordination with dedicated interfaces for every role in the care circle.
          </p>
        </div>

        {/* Card */}
        <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-lg">
          <Card className="shadow-2xl border-slate-200/90 rounded-3xl overflow-hidden p-6 sm:p-8">
            {/* Role / Persona Selector Bar */}
            <div className="mb-6">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 text-center mb-2.5">
                Step 1: Choose Your Experience
              </label>

              <div className="grid grid-cols-3 gap-2 p-1.5 bg-slate-100 rounded-2xl border border-slate-200/80">
                {/* 1. Elderly Option */}
                <button
                  type="button"
                  onClick={() => handleRoleSelect('elderly')}
                  className={`flex flex-col items-center justify-center py-3 px-2 rounded-xl transition font-bold text-center cursor-pointer ${
                    selectedRole === 'elderly'
                      ? 'bg-emerald-600 text-white shadow-md'
                      : 'text-slate-700 hover:bg-white/80'
                  }`}
                >
                  <Heart className={`w-5 h-5 mb-1 ${selectedRole === 'elderly' ? 'text-white' : 'text-emerald-600'}`} />
                  <span className="text-xs sm:text-sm font-black">Elderly</span>
                  <span className="text-[10px] opacity-80 hidden sm:block">Senior Mode</span>
                </button>

                {/* 2. Caretaker Option */}
                <button
                  type="button"
                  onClick={() => handleRoleSelect('caregiver')}
                  className={`flex flex-col items-center justify-center py-3 px-2 rounded-xl transition font-bold text-center cursor-pointer ${
                    selectedRole === 'caregiver'
                      ? 'bg-slate-900 text-white shadow-md'
                      : 'text-slate-700 hover:bg-white/80'
                  }`}
                >
                  <Stethoscope className={`w-5 h-5 mb-1 ${selectedRole === 'caregiver' ? 'text-white' : 'text-blue-600'}`} />
                  <span className="text-xs sm:text-sm font-black">Care Taker</span>
                  <span className="text-[10px] opacity-80 hidden sm:block">Nurse / Shift</span>
                </button>

                {/* 3. Care Circle Option */}
                <button
                  type="button"
                  onClick={() => handleRoleSelect('family')}
                  className={`flex flex-col items-center justify-center py-3 px-2 rounded-xl transition font-bold text-center cursor-pointer ${
                    selectedRole === 'family'
                      ? 'bg-brand-600 text-white shadow-md'
                      : 'text-slate-700 hover:bg-white/80'
                  }`}
                >
                  <Users className={`w-5 h-5 mb-1 ${selectedRole === 'family' ? 'text-white' : 'text-brand-600'}`} />
                  <span className="text-xs sm:text-sm font-black">Care Circle</span>
                  <span className="text-[10px] opacity-80 hidden sm:block">Family View</span>
                </button>
              </div>

              {/* Dynamic Role Banner */}
              <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-900">
                    {selectedRole === 'elderly' && '👴 Elderly Mode Selected:'}
                    {selectedRole === 'caregiver' && '🩺 Care Taker Workspace Selected:'}
                    {selectedRole === 'family' && '👨‍👩‍👧 Care Circle Overview Selected:'}
                  </span>{' '}
                  <span>
                    {selectedRole === 'elderly' && 'High-contrast large buttons, live clock & audio read-aloud.'}
                    {selectedRole === 'caregiver' && 'Shift checklist, vitals logger, and handover transfer.'}
                    {selectedRole === 'family' && '4-state adherence metrics, care gaps, and emergency care card.'}
                  </span>
                </div>
              </div>
            </div>

            <CardHeader className="text-center p-0 pb-4">
              <CardTitle className="text-2xl font-black text-slate-900">
                {isSignUp ? 'Create your Account' : 'Sign in to JEEVASETU'}
              </CardTitle>
              <CardDescription className="text-sm text-slate-600">
                {isSignUp
                  ? `Register as ${selectedRole === 'elderly' ? 'Elderly Patient' : selectedRole === 'caregiver' ? 'Care Taker' : 'Care Circle Member'}`
                  : `Sign in to access your personalized ${selectedRole === 'elderly' ? 'Elderly' : selectedRole === 'caregiver' ? 'Caregiver' : 'Family'} dashboard`}
              </CardDescription>
            </CardHeader>

            {error && (
              <div className="mb-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold flex items-start gap-2">
                <span className="font-bold">Notice:</span>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignUp && (
                <div>
                  <label className="block text-sm font-bold text-slate-800 mb-1">
                    Your Full Name
                  </label>
                  <div className="relative">
                    <User className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={selectedRole === 'elderly' ? 'e.g. Smt. Kausalya Devi' : 'e.g. Ramesh Kumar'}
                      className="w-full pl-11 pr-4 py-3 text-base rounded-xl border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none transition"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-11 pr-4 py-3 text-base rounded-xl border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1">Password</label>
                <div className="relative">
                  <Lock className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-11 pr-4 py-3 text-base rounded-xl border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none transition"
                  />
                </div>
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  size="lg"
                  className={`w-full text-base sm:text-lg font-bold py-3.5 rounded-xl shadow-lg transition ${
                    selectedRole === 'elderly'
                      ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/25'
                      : selectedRole === 'caregiver'
                      ? 'bg-slate-900 hover:bg-slate-800 shadow-slate-900/25'
                      : 'bg-brand-600 hover:bg-brand-700 shadow-brand-600/25'
                  }`}
                  isLoading={loading}
                >
                  {isSignUp
                    ? `Create ${selectedRole === 'elderly' ? 'Elderly' : selectedRole === 'caregiver' ? 'Care Taker' : 'Care Circle'} Account`
                    : `Enter as ${selectedRole === 'elderly' ? 'Elderly' : selectedRole === 'caregiver' ? 'Care Taker' : 'Care Circle'}`}
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            </form>

            {/* Quick Demo Pre-fill for Evaluators */}
            <div className="mt-5 pt-4 border-t border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  Hackathon Demo Quick Fill
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleQuickDemoFill('elderly')}
                  className="py-1.5 px-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold transition text-center"
                >
                  👴 Elder Demo
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickDemoFill('caregiver')}
                  className="py-1.5 px-2 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 text-xs font-bold transition text-center"
                >
                  🩺 Caretaker Demo
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickDemoFill('family')}
                  className="py-1.5 px-2 rounded-lg bg-brand-50 hover:bg-brand-100 border border-brand-200 text-brand-800 text-xs font-bold transition text-center"
                >
                  👨‍👩‍👧 Circle Demo
                </button>
              </div>
            </div>

            <div className="mt-4 pt-3 flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError('');
                }}
                className="text-sm font-semibold text-brand-700 hover:text-brand-800 underline underline-offset-4"
              >
                {isSignUp ? 'Already have an account? Sign in' : "Don't have an account yet? Sign up"}
              </button>

              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium mt-1">
                <ShieldCheck className="w-4 h-4 text-brand-600" />
                <span>Protected by patient care-circle authorization</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
