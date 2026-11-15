'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Heart, Lock, Mail, ArrowRight, ShieldCheck, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { auth } from '@/lib/firebase/client';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';

export default function LoginPage() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCred.user, { displayName });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
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
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50/60 to-slate-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-3xl bg-brand-600 flex items-center justify-center text-white shadow-lg shadow-brand-500/25 mb-4">
            <Heart className="w-9 h-9 fill-white/20" />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">JEEVASETU</h1>
          <p className="text-base text-brand-800 font-bold mt-1">A bridge between generations</p>
          <p className="text-sm text-slate-500 mt-1 max-w-xs">
            Connecting elderly parents, family members, and caregivers in one trusted circle.
          </p>
        </div>

        {/* Card */}
        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
          <Card className="shadow-xl border-slate-200/80">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl">
                {isSignUp ? 'Create your Account' : 'Welcome to Jeevasetu'}
              </CardTitle>
              <CardDescription>
                {isSignUp
                  ? 'Sign up to create or join an elderly care circle'
                  : 'Sign in with your email and password to access care schedules'}
              </CardDescription>
            </CardHeader>

            {error && (
              <div className="mb-5 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-medium flex items-start gap-2">
                <span className="font-bold">Notice:</span>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignUp && (
                <div>
                  <label className="block text-base font-semibold text-slate-800 mb-1.5">
                    Your Full Name
                  </label>
                  <div className="relative">
                    <User className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Ramesh Kumar"
                      className="w-full pl-12 pr-4 py-3 text-base rounded-xl border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none transition"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-base font-semibold text-slate-800 mb-1.5">Email Address</label>
                <div className="relative">
                  <Mail className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-12 pr-4 py-3 text-base rounded-xl border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-base font-semibold text-slate-800 mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-12 pr-4 py-3 text-base rounded-xl border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none transition"
                  />
                </div>
              </div>

              <div className="pt-2">
                <Button type="submit" size="lg" className="w-full text-lg" isLoading={loading}>
                  {isSignUp ? 'Create Account' : 'Sign In'}
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            </form>

            <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError('');
                }}
                className="text-base font-semibold text-brand-700 hover:text-brand-800 underline underline-offset-4"
              >
                {isSignUp ? 'Already have an account? Sign in' : "Don't have an account yet? Sign up"}
              </button>

              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
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
