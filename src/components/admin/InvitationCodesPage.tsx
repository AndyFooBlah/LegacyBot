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
 * InvitationCodesPage — superadmin-only UI to manage signup invitation codes.
 *
 * Access gated by the `isSuperadmin` custom claim (also enforced server-side
 * on the callables). Non-superadmins who reach the route see a refusal view
 * and a link back to the home page.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  generateInvitationCode,
  deactivateInvitationCode,
  reactivateInvitationCode,
  listInvitationCodes,
  listRedemptions,
} from '../../services/invitationCodes';
import { InvitationCode, InvitationCodeRedemption } from '../../types';

function formatDate(ts: { toDate?: () => Date } | undefined): string {
  if (!ts?.toDate) return '';
  return ts.toDate().toLocaleString();
}

export const InvitationCodesPage: React.FC = () => {
  const { user, loading, isSuperadmin } = useAuth();
  const navigate = useNavigate();
  const [codes, setCodes] = useState<InvitationCode[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [description, setDescription] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [redemptionsByCode, setRedemptionsByCode] = useState<
    Record<string, InvitationCodeRedemption[]>
  >({});

  async function refresh() {
    setFetching(true);
    setError(null);
    try {
      const list = await listInvitationCodes();
      setCodes(list);
    } catch (err) {
      console.error('[InvitationCodes] list failed:', err);
      setError('Failed to load codes.');
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    if (!loading && isSuperadmin) refresh();
  }, [loading, isSuperadmin]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setGenerating(true);
    setError(null);
    try {
      await generateInvitationCode(description.trim() || undefined);
      setDescription('');
      await refresh();
    } catch (err) {
      console.error('[InvitationCodes] generate failed:', err);
      setError('Failed to generate code.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleDeactivate(code: string) {
    try {
      await deactivateInvitationCode(code);
      await refresh();
    } catch (err) {
      console.error('[InvitationCodes] deactivate failed:', err);
      setError(`Failed to deactivate ${code}.`);
    }
  }

  async function handleReactivate(code: string) {
    try {
      await reactivateInvitationCode(code);
      await refresh();
    } catch (err) {
      console.error('[InvitationCodes] reactivate failed:', err);
      setError(`Failed to reactivate ${code}.`);
    }
  }

  async function toggleRedemptions(code: string) {
    if (expanded === code) {
      setExpanded(null);
      return;
    }
    setExpanded(code);
    if (!redemptionsByCode[code]) {
      try {
        const list = await listRedemptions(code);
        setRedemptionsByCode((prev) => ({ ...prev, [code]: list }));
      } catch (err) {
        console.error(`[InvitationCodes] redemptions for ${code} failed:`, err);
        setError(`Failed to load redemptions for ${code}.`);
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!user || !isSuperadmin) {
    return (
      <div className="max-w-md mx-auto p-8 mt-20 space-y-6 text-center">
        <h2 className="text-2xl font-bold text-slate-800">Superadmin only</h2>
        <p className="text-slate-500">
          This page is only accessible to users with the superadmin role.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-colors"
        >
          Go home
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-slate-800">Invitation Codes</h2>
        <p className="text-slate-500 text-sm">
          Codes grant new users the ability to create their own family.
          Family admins inviting members into an existing family do not need a
          code.
        </p>
      </div>

      <form
        onSubmit={handleGenerate}
        className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3"
      >
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Generate a new code
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional) — e.g. 'Launch — friends list'"
            maxLength={200}
            className="flex-1 p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={generating}
            className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </form>

      {error && (
        <p className="text-sm text-red-500 font-medium text-center">{error}</p>
      )}

      {fetching ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
        </div>
      ) : codes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400">
          No invitation codes yet. Generate one above to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {codes.map((c) => {
            const isExpanded = expanded === c.id;
            const redemptions = redemptionsByCode[c.id!] ?? [];
            return (
              <div
                key={c.id}
                className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-lg font-bold tracking-widest text-slate-800">
                        {c.id}
                      </span>
                      <span
                        className={
                          'text-xs font-semibold px-2 py-1 rounded-full ' +
                          (c.active
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-500')
                        }
                      >
                        {c.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {c.description && (
                      <p className="text-sm text-slate-500">{c.description}</p>
                    )}
                    <p className="text-xs text-slate-400">
                      Created {formatDate(c.createdAt)} · {c.redemptionCount} redemption
                      {c.redemptionCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleRedemptions(c.id!)}
                      className="text-sm text-indigo-600 font-semibold hover:underline"
                    >
                      {isExpanded ? 'Hide users' : 'View users'}
                    </button>
                    {c.active ? (
                      <button
                        onClick={() => handleDeactivate(c.id!)}
                        className="text-sm text-red-600 font-semibold hover:underline"
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        onClick={() => handleReactivate(c.id!)}
                        className="text-sm text-emerald-600 font-semibold hover:underline"
                      >
                        Reactivate
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-100 pt-3">
                    {redemptions.length === 0 ? (
                      <p className="text-sm text-slate-400">
                        No redemptions yet.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {redemptions.map((r) => (
                          <li
                            key={r.id}
                            className="text-sm flex justify-between text-slate-600"
                          >
                            <span>
                              <span className="font-medium text-slate-800">
                                {r.userDisplayName}
                              </span>{' '}
                              <span className="text-slate-400">
                                ({r.userEmail})
                              </span>
                            </span>
                            <span className="text-slate-400">
                              {formatDate(r.redeemedAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
