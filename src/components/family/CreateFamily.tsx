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
 * CreateFamily — form to create a new family.
 *
 * Requires a valid invitation code. The code is validated server-side by the
 * `redeemInvitationCode` Cloud Function, which atomically creates the family
 * and marks the code as used. Direct client-side family creation is no longer
 * permitted by Firestore security rules.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../../hooks/useAuth';
import { functions } from '../../services/firebase';

interface RedeemResult {
  familyId: string;
}

export const CreateFamily: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [name, setName] = useState('The Smith Family');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim() || !user) return;

    setCreating(true);
    setError(null);

    try {
      const redeem = httpsCallable<{ code: string; familyName: string }, RedeemResult>(
        functions,
        'redeemInvitationCode',
      );
      const result = await redeem({ code: code.trim(), familyName: name.trim() });
      const { familyId } = result.data;

      // Refresh the ID token so the new familyIds custom claim is included.
      await user.getIdToken(true);
      navigate(`/family/${familyId}`, { replace: true });
    } catch (err: any) {
      const errCode = err?.code ?? '';
      if (errCode === 'functions/not-found') {
        setError('Invitation code not found. Please check your code and try again.');
      } else if (errCode === 'functions/already-exists') {
        setError('This invitation code has already been used.');
      } else {
        setError('Something went wrong. Please try again.');
        console.error('[CreateFamily] Error:', err);
      }
      setCreating(false);
    }
  }

  return (
    <div className="max-w-md mx-auto p-8 mt-20 space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-slate-800">Create a Family</h2>
        <p className="text-slate-400 text-sm">
          You&apos;ll need an invitation code to get started.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Invitation Code
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(null); }}
            placeholder="e.g. LEGACY-ABCD1234"
            autoFocus
            autoCapitalize="characters"
            className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-lg outline-none focus:ring-2 focus:ring-indigo-500 font-mono tracking-widest"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Family Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. The Smith Family"
            className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-lg outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {error && (
          <p className="text-sm text-red-500 font-medium text-center">{error}</p>
        )}

        <button
          type="submit"
          disabled={!code.trim() || !name.trim() || creating}
          className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold text-lg hover:bg-indigo-700 transition-colors shadow-lg disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create Family'}
        </button>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="w-full py-3 text-slate-500 font-medium hover:text-slate-700 transition-colors"
        >
          Back
        </button>
      </form>
    </div>
  );
};
