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
 * FamilyDashboard — admin landing page for a family.
 *
 * Shows:
 *   - Navigation bar (FamilyNav)
 *   - Member cards with session stats and Manage links
 *   - New Storyteller / Invite Member controls
 *   - Pending invitations
 *   - Auto-sync of storytellers into the family tree
 *
 * (System-health probes moved to a dedicated /diagnostics page; reachable
 * from the global nav.)
 */

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, orderBy, getDocs, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db } from '../../services/firebase';
import { functions as firebaseFunctions } from '../../services/firebase';
import { useAuth } from '../../hooks/useAuth';
import {
  useFamily,
  useFamilyMembers,
  updateFamilyTree,
} from '../../hooks/useFamily';
import { useFamilyInvitations } from '../../hooks/useInvitations';
import { useDossierList } from '../../hooks/useDossier';
import { FamilyNav } from './FamilyNav';
import { FamilyMember, MemberType } from '../../types';

// ---------------------------------------------------------------------------
// Per-storyteller session stats

interface SessionStats {
  sessionCount: number;
  totalMinutes: number;
  lastSessionDate: string | null;
}

async function fetchSessionStats(
  familyId: string,
  dossierId: string,
): Promise<SessionStats> {
  const sessionsRef = collection(db, 'families', familyId, 'dossiers', dossierId, 'sessions');
  const q = query(sessionsRef, orderBy('startTime', 'desc'));
  const snap = await getDocs(q);

  let totalSeconds = 0;
  let lastSessionDate: string | null = null;

  snap.docs.forEach((d, idx) => {
    const data = d.data();
    totalSeconds += data.durationSeconds ?? 0;
    if (idx === 0 && data.startTime) {
      const ts = data.startTime as Timestamp;
      lastSessionDate = ts.toDate().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
  });

  return {
    sessionCount: snap.size,
    totalMinutes: Math.round(totalSeconds / 60),
    lastSessionDate,
  };
}

// ---------------------------------------------------------------------------
// Component

export const FamilyDashboard: React.FC = () => {
  const { familyId } = useParams<{ familyId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const { family, loading: familyLoading } = useFamily(familyId);
  const { members, loading: membersLoading } = useFamilyMembers(familyId);
  const { invitations, loading: invitesLoading, cancelInvite } = useFamilyInvitations(familyId);
  const { dossiers, loading: dossiersLoading, createDossier } = useDossierList(familyId);

  // Session stats keyed by storytellerUid
  const [sessionStats, setSessionStats] = useState<Map<string, SessionStats>>(new Map());

  // New family member form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newBio, setNewBio] = useState('');

  // Backfill index state
  type BackfillStatus = 'idle' | 'running' | 'done' | 'error';
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus>('idle');
  const [backfillChunks, setBackfillChunks] = useState<number | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  async function handleBackfill() {
    if (!familyId || backfillStatus === 'running') return;
    setBackfillStatus('running');
    setBackfillChunks(null);
    setBackfillError(null);
    try {
      const fn = httpsCallable<{ familyId: string }, { chunksWritten: number }>(
        firebaseFunctions, 'backfillContextChunks',
      );
      const result = await fn({ familyId });
      setBackfillChunks(result.data.chunksWritten);
      setBackfillStatus('done');
    } catch (err) {
      setBackfillError(err instanceof Error ? err.message : String(err));
      setBackfillStatus('error');
    }
  }

  // Fetch session stats once dossiers are loaded
  useEffect(() => {
    if (!familyId || dossiersLoading || dossiers.length === 0) return;

    const fetchAll = async () => {
      const results = new Map<string, SessionStats>();
      await Promise.allSettled(
        dossiers
          .filter((d) => d.storytellerUid)
          .map(async (d) => {
            const stats = await fetchSessionStats(familyId, d.id!);
            results.set(d.storytellerUid!, stats);
          }),
      );
      setSessionStats(new Map(results));
    };

    void fetchAll();
  }, [familyId, dossiers, dossiersLoading]);

  // Auto-sync storytellers into the family tree so they appear as nodes.
  const familyTreeRef = useRef<FamilyMember[]>([]);
  useEffect(() => {
    familyTreeRef.current = family?.familyTree ?? [];
  }, [family]);

  useEffect(() => {
    if (!familyId || membersLoading || familyLoading) return;

    const currentTree = familyTreeRef.current;
    const storytellers = members.filter((m) => m.roles.includes('storyteller'));
    const unlinked = storytellers.filter(
      (st) => !currentTree.some((fm) => fm.linkedMemberUid === st.uid),
    );

    if (unlinked.length === 0) return;

    const newEntries: FamilyMember[] = unlinked.map((st) => {
      const parts = (st.displayName || '').trim().split(/\s+/);
      const firstName = parts.slice(0, -1).join(' ') || parts[0] || '';
      const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
      return {
        id: `linked-${st.uid}`,
        name: st.displayName || st.email || 'Storyteller',
        firstName,
        lastName,
        linkedMemberUid: st.uid,
        relations: [],
        memberType: 'person' as MemberType,
      };
    });

    updateFamilyTree(familyId, [...currentTree, ...newEntries]);
  }, [familyId, members, membersLoading, familyLoading]);

  async function handleCreateMember() {
    if (!newFirstName.trim() || !familyId) return;
    const fullName = [newFirstName.trim(), newLastName.trim()].filter(Boolean).join(' ');
    const dossierId = await createDossier(fullName, newBio.trim());

    // Pre-fill email on the dossier so the DossierEditor invite form has it ready
    if (newEmail.trim()) {
      try {
        const { updateDoc, doc: firestoreDoc } = await import('firebase/firestore');
        await updateDoc(firestoreDoc(db, 'families', familyId, 'dossiers', dossierId), {
          inviteEmail: newEmail.trim(),
        });
      } catch {
        // Non-critical — email can be entered in the dossier editor
      }
    }

    setNewFirstName('');
    setNewLastName('');
    setNewEmail('');
    setNewBio('');
    setShowCreateForm(false);
    navigate(`/family/${familyId}/dossier/${dossierId}`);
  }

  if (familyLoading || membersLoading || invitesLoading || dossiersLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-6">
      <FamilyNav familyId={familyId!} familyName={family?.name} />

      {/* Members Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-700">Family Members</h2>
          {!showCreateForm && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
            >
              + New Family Member
            </button>
          )}
        </div>

        {/* New Family Member Form */}
        {showCreateForm && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div>
              <h3 className="font-bold text-slate-800">New Family Member</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Set up their profile now. You can send the invitation link from their profile page.
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newFirstName}
                  onChange={(e) => setNewFirstName(e.target.value)}
                  placeholder="First name"
                  autoFocus
                  className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <input
                  type="text"
                  value={newLastName}
                  onChange={(e) => setNewLastName(e.target.value)}
                  placeholder="Last name"
                  className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Email address (optional)"
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <textarea
                value={newBio}
                onChange={(e) => setNewBio(e.target.value)}
                placeholder="Biographical summary — who are they, what's their life story, what do you want to capture? (optional)"
                rows={3}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreateMember}
                disabled={!newFirstName.trim()}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                Create Profile
              </button>
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  setNewFirstName('');
                  setNewLastName('');
                  setNewEmail('');
                  setNewBio('');
                }}
                className="px-4 py-2 text-slate-500 font-medium hover:text-slate-700 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Member Cards */}
        <div className="grid gap-3">
          {members.map((member) => {
            const dossier = dossiers.find((d) => d.storytellerUid === member.uid);
            const isStoryteller = member.roles.includes('storyteller');
            const isAdmin = member.roles.includes('admin');
            const resolvedName =
              member.displayName && member.displayName !== member.email
                ? member.displayName
                : (dossier?.storytellerName ?? member.email);
            const stats = isStoryteller ? sessionStats.get(member.uid) : undefined;

            return (
              <div
                key={member.uid}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex items-center justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-semibold text-slate-800 truncate">{resolvedName}</p>
                    {isAdmin && (
                      <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded-full uppercase tracking-wider shrink-0">
                        Admin
                      </span>
                    )}
                    {isStoryteller && (
                      <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-600 rounded-full uppercase tracking-wider shrink-0">
                        Storyteller
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 truncate">{member.email}</p>
                  {stats && (
                    <p className="text-xs text-slate-500 mt-1.5">
                      {stats.sessionCount} {stats.sessionCount === 1 ? 'session' : 'sessions'}
                      {stats.totalMinutes > 0 && ` · ${stats.totalMinutes} min`}
                      {stats.lastSessionDate && ` · Last: ${stats.lastSessionDate}`}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {dossier && (
                    <button
                      onClick={() => navigate(`/family/${familyId}/dossier/${dossier.id}`)}
                      className="px-3 py-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                    >
                      Dossier
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/family/${familyId}/member/${member.uid}`)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    Manage
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pending Invitations */}
        {invitations.filter((inv) => inv.status === 'pending').length > 0 && (
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-6 shadow-sm space-y-3">
            <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider">
              Pending Invitations
            </h4>
            <div className="space-y-2">
              {invitations
                .filter((inv) => inv.status === 'pending')
                .map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{inv.email}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{inv.roles.join(', ')}</span>
                      <button
                        onClick={() => {
                          if (!window.confirm(`Cancel invitation for ${inv.email}?`)) return;
                          cancelInvite(inv.id!);
                        }}
                        className="text-xs text-rose-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </section>

      {/* Rebuild memory index */}
      <section className="pt-4 border-t border-slate-100">
        <div className="flex items-center gap-4 flex-wrap">
          <button
            onClick={handleBackfill}
            disabled={backfillStatus === 'running'}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {backfillStatus === 'running' ? 'Rebuilding…' : '↺ Rebuild Memory Index'}
          </button>
          {backfillStatus === 'done' && backfillChunks !== null && (
            <span className="text-sm text-emerald-600 font-medium">
              Done — {backfillChunks} chunks indexed
            </span>
          )}
          {backfillStatus === 'error' && (
            <span className="text-sm text-red-500 font-medium" title={backfillError ?? undefined}>
              Failed — {backfillError}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-xs text-slate-400">
          Re-embeds all biographies, transcripts, events, and facts so the AI can search past conversations.
          Run this after importing data or if search results seem stale.
        </p>
      </section>
    </div>
  );
};
