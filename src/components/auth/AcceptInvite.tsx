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
 * AcceptInvite — handles invitation acceptance flow.
 * Reads invite token from URL search params, shows invitation details,
 * handles sign-up if needed, and accepts the invite.
 */

import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { sendEmailVerification } from 'firebase/auth';
import { useAuth } from '../../hooks/useAuth';
import { useAcceptInvitation } from '../../hooks/useInvitations';

export const AcceptInvite: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { user } = useAuth();
  const { invitation, loading, error, loadInvitation, accept } = useAcceptInvitation();
  const [resendState, setResendState] = useState<'idle' | 'sent' | 'error'>('idle');

  useEffect(() => {
    if (token) loadInvitation(token);
  }, [token, loadInvitation]);

  async function handleResendVerification() {
    if (!user) return;
    try {
      await sendEmailVerification(user);
      setResendState('sent');
    } catch (err) {
      console.error('[AcceptInvite] Failed to resend verification email:', err);
      setResendState('error');
    }
  }

  async function handleAccept() {
    if (!token || !user || !invitation) return;
    try {
      await accept(
        token,
        user.uid,
        user.displayName ?? user.email ?? 'Anonymous',
        user.email ?? '',
      );
      // Refresh the ID token so the new familyIds custom claim is included.
      // onMemberWritten sets the claim server-side; getIdToken(true) fetches it.
      await user.getIdToken(true);
      navigate(`/family/${invitation.familyId}`, { replace: true });
    } catch (err) {
      console.error('[AcceptInvite] Error:', err);
    }
  }

  if (!token) {
    return (
      <div className="max-w-md mx-auto p-8 mt-20 text-center space-y-4">
        <h2 className="text-xl font-bold text-slate-800">Invalid Invite Link</h2>
        <p className="text-slate-400">No invitation token found in this URL.</p>
        <button
          onClick={() => navigate('/')}
          className="text-indigo-600 font-semibold hover:underline"
        >
          Go Home
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  // Invitations can only be read and accepted with a verified email —
  // otherwise anyone could register an account claiming the invitee's
  // address and hijack the invitation. Show a clear next step instead of
  // the raw permission error the security rules would produce.
  if (user && !user.emailVerified) {
    return (
      <div className="max-w-md mx-auto p-8 mt-20 text-center space-y-4">
        <h2 className="text-xl font-bold text-slate-800">Verify Your Email First</h2>
        <p className="text-slate-500">
          To accept this invitation, please verify your email address
          {user.email ? <> (<span className="font-medium">{user.email}</span>)</> : null}.
          Check your inbox for a verification link, click it, then return here
          and reload this page.
        </p>
        {resendState === 'sent' && (
          <p className="text-sm text-emerald-600 bg-emerald-50 rounded-lg p-3">
            Verification email sent — check your inbox (and spam folder).
          </p>
        )}
        {resendState === 'error' && (
          <p className="text-sm text-red-500 bg-red-50 rounded-lg p-3">
            Could not send the email. Please wait a moment and try again.
          </p>
        )}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={handleResendVerification}
            className="text-indigo-600 font-semibold hover:underline"
          >
            Resend verification email
          </button>
          <button
            onClick={() => window.location.reload()}
            className="text-slate-500 font-medium hover:underline"
          >
            I've verified — reload this page
          </button>
        </div>
      </div>
    );
  }

  if (error || !invitation) {
    return (
      <div className="max-w-md mx-auto p-8 mt-20 text-center space-y-4">
        <h2 className="text-xl font-bold text-slate-800">Invitation Error</h2>
        <p className="text-slate-400">{error || 'Invitation not found.'}</p>
        <button
          onClick={() => navigate('/')}
          className="text-indigo-600 font-semibold hover:underline"
        >
          Go Home
        </button>
      </div>
    );
  }

  if (invitation.status === 'accepted') {
    return (
      <div className="max-w-md mx-auto p-8 mt-20 text-center space-y-4">
        <h2 className="text-xl font-bold text-slate-800">Already Accepted</h2>
        <p className="text-slate-400">This invitation has already been used.</p>
        <button
          onClick={() => navigate(`/family/${invitation.familyId}`)}
          className="text-indigo-600 font-semibold hover:underline"
        >
          Go to Family
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-8 mt-20 space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-slate-800">You're Invited!</h2>
        <p className="text-slate-400">
          You've been invited to join a family on BiographyBot.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Role(s)</p>
          <div className="flex gap-2 mt-1">
            {invitation.roles.map((role) => (
              <span
                key={role}
                className={`text-xs font-bold px-3 py-1 rounded-full uppercase ${
                  role === 'admin'
                    ? 'bg-indigo-100 text-indigo-600'
                    : 'bg-emerald-100 text-emerald-600'
                }`}
              >
                {role}
              </span>
            ))}
          </div>
        </div>

        {!user && (
          <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-xl">
            Please sign in or create an account first, then return to this link.
          </p>
        )}

        <button
          onClick={handleAccept}
          disabled={!user || loading}
          className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold text-lg hover:bg-indigo-700 transition-colors shadow-lg disabled:opacity-50"
        >
          Accept Invitation
        </button>
      </div>
    </div>
  );
};
