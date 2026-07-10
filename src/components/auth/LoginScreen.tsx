// Copyright 2026 Andrew Brook
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * LoginScreen — the authentication entry point for LegacyBot.
 *
 * Displays a branded login form with three sign-in options:
 *   1. Google OAuth (one-click popup)
 *   2. Email/Password sign-in (existing accounts)
 *   3. Email/Password sign-up (new accounts)
 *
 * Sign-in and sign-up are separate flows because Firebase SDK v10+
 * returns the same error code (auth/invalid-credential) for both
 * "user doesn't exist" and "wrong password", making it impossible
 * to auto-register reliably from a single button.
 *
 * This screen is shown to unauthenticated users via the auth guard in
 * Layout.tsx. Once signed in, the user is redirected to the Dossier list.
 *
 * References: product_requirements.md §3.5 | GitHub Issue #2
 */

import React, { useState } from 'react';
import { Logo } from '../shared/Logo';

interface LoginScreenProps {
  onGoogleSignIn: () => Promise<void>;
  onEmailSignIn: (email: string, password: string) => Promise<void>;
  onEmailSignUp: (email: string, password: string) => Promise<void>;
  /** Pre-fill email and start in signup mode (used for invite links). */
  inviteEmail?: string;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onGoogleSignIn,
  onEmailSignIn,
  onEmailSignUp,
  inviteEmail,
}) => {
  const [email, setEmail] = useState(inviteEmail ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>(inviteEmail ? 'signup' : 'signin');

  async function handleGoogleSignIn() {
    setError(null);
    setIsLoading(true);
    try {
      await onGoogleSignIn();
    } catch (err: any) {
      setError(err.message ?? 'Google sign-in failed.');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }
    if (mode === 'signup' && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setIsLoading(true);
    try {
      if (mode === 'signup') {
        await onEmailSignUp(email, password);
        setNotice(
          `Account created! We've sent a verification link to ${email}. ` +
          'Please check your email and verify your address — you\'ll need it to accept invitations.',
        );
      } else {
        await onEmailSignIn(email, password);
      }
    } catch (err: any) {
      // Map Firebase error codes to friendly messages
      const friendlyMessages: Record<string, string> = {
        'auth/invalid-credential': 'Incorrect email or password.',
        'auth/email-already-in-use': 'An account with this email already exists. Try signing in instead.',
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
      };
      setError(friendlyMessages[err.code] ?? err.message ?? 'Authentication failed.');
    } finally {
      setIsLoading(false);
    }
  }

  function switchMode() {
    setMode(mode === 'signin' ? 'signup' : 'signin');
    setError(null);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-10 space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-3">
            <Logo size={44} />
            <h1 className="text-4xl font-bold text-slate-800 tracking-tight font-display">
              BiographyBot
            </h1>
          </div>
          {inviteEmail ? (
            <p className="text-slate-500 text-sm">
              Create an account to accept your invitation.
            </p>
          ) : (
            <p className="text-slate-400 italic text-sm">
              Tell your family's story.
            </p>
          )}
        </div>

        {inviteEmail && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
            <p className="text-sm text-emerald-700 font-medium">
              You've been invited to join a family as a storyteller.
            </p>
            <p className="text-xs text-emerald-600 mt-1">
              Set a password below to create your account.
            </p>
          </div>
        )}

        {/* Google Sign-In */}
        <button
          onClick={handleGoogleSignIn}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white border-2 border-slate-200 rounded-xl text-slate-700 font-semibold hover:bg-slate-50 hover:border-slate-300 transition-all disabled:opacity-50"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-4">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">or</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'Choose a password (min 6 characters)' : 'Enter your password'}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {isLoading
              ? (mode === 'signup' ? 'Creating account...' : 'Signing in...')
              : (mode === 'signup' ? 'Create Account' : 'Sign In')}
          </button>
        </form>

        {/* Error display */}
        {error && (
          <p className="text-sm text-red-500 text-center bg-red-50 rounded-lg p-3">
            {error}
          </p>
        )}

        {/* Post-signup verification notice */}
        {notice && (
          <p className="text-sm text-emerald-700 text-center bg-emerald-50 rounded-lg p-3">
            {notice}
          </p>
        )}

        {/* Toggle between sign-in and sign-up */}
        <p className="text-sm text-slate-400 text-center">
          {mode === 'signin' ? (
            <>
              New here?{' '}
              <button onClick={switchMode} className="text-indigo-600 font-semibold hover:text-indigo-700">
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button onClick={switchMode} className="text-indigo-600 font-semibold hover:text-indigo-700">
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
};
