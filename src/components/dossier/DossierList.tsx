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
 * DossierList — the admin's landing page within a family.
 * Displays all Dossiers for the family as cards with storyteller assignment badges.
 */

import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useDossierList } from '../../hooks/useDossier';
import { useFamilyMembers } from '../../hooks/useFamily';
import { useFamilyInvitations } from '../../hooks/useInvitations';

export const DossierList: React.FC = () => {
  const { familyId } = useParams<{ familyId: string }>();
  const { user } = useAuth();
  const { dossiers, loading, createDossier, deleteDossier } = useDossierList(familyId);
  const { members } = useFamilyMembers(familyId);
  const { createInvite } = useFamilyInvitations(familyId);
  const navigate = useNavigate();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  async function handleCreate() {
    if (!newName.trim()) return;
    const dossierId = await createDossier(newName.trim());

    // If email provided, create an invitation linked to this dossier
    if (newEmail.trim() && user) {
      try {
        const inviteId = await createInvite(newEmail.trim(), ['storyteller'], [dossierId], user.uid);
        const link = `${window.location.origin}/invite?token=${inviteId}&email=${encodeURIComponent(newEmail.trim())}`;
        setInviteLink(link);
        setShowCreateForm(false);
        return; // Stay on list to show invite link
      } catch (err) {
        console.error('[DossierList] Failed to create invitation:', err);
      }
    }

    setNewName('');
    setNewEmail('');
    setShowCreateForm(false);
    navigate(`/family/${familyId}/dossier/${dossierId}`);
  }

  async function handleDelete(dossierId: string) {
    await deleteDossier(dossierId);
    setDeleteConfirmId(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-slate-800 tracking-tight">
            Your Storytellers
          </h2>
          <p className="text-slate-400 mt-1">
            Select a Storyteller to begin or review their oral history.
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors shadow-lg"
        >
          + New Storyteller
        </button>
      </div>

      {inviteLink && (
        <div className="bg-green-50 rounded-2xl border border-green-200 p-6 space-y-4">
          <p className="font-semibold text-green-700 text-center">
            {newName} created! Share this invite link with {newEmail}:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={inviteLink}
              className="flex-1 p-3 bg-white border border-green-200 rounded-xl text-sm text-slate-700 select-all"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              onClick={() => navigator.clipboard.writeText(inviteLink)}
              className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-colors"
            >
              Copy
            </button>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => {
                setInviteLink(null);
                setNewName('');
                setNewEmail('');
                navigate(`/family/${familyId}/dossier/${dossiers[dossiers.length - 1]?.id}`);
              }}
              className="text-sm text-indigo-600 font-semibold hover:underline"
            >
              Edit Dossier
            </button>
            <button
              onClick={() => { setInviteLink(null); setNewName(''); setNewEmail(''); }}
              className="text-sm text-slate-500 font-medium hover:underline"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {showCreateForm && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
              Storyteller&apos;s Name (required)
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Grandma Margaret"
              autoFocus
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
              Storyteller&apos;s Email (optional — to send invite)
            </label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="e.g. grandma@email.com"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={!newName.trim()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50 hover:bg-indigo-700 transition-colors"
            >
              {newEmail.trim() ? 'Create & Invite' : 'Create'}
            </button>
            <button
              onClick={() => {
                setShowCreateForm(false);
                setNewName('');
                setNewEmail('');
              }}
              className="px-4 py-2 text-slate-500 hover:text-slate-700 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {dossiers.length === 0 && !showCreateForm ? (
        <div className="text-center py-20 space-y-4">
          <div className="text-6xl opacity-30">📖</div>
          <h3 className="text-xl font-semibold text-slate-500">
            No Storytellers yet
          </h3>
          <p className="text-slate-400 max-w-md mx-auto">
            Create a new Storyteller to set up their Dossier — family tree,
            questions, and personality — then start recording their stories.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dossiers.map((d) => (
            <div
              key={d.id}
              className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow group relative"
            >
              {deleteConfirmId === d.id && (
                <div className="absolute inset-0 bg-white/95 rounded-2xl flex flex-col items-center justify-center gap-3 z-10">
                  <p className="text-sm font-semibold text-slate-700">
                    Delete {d.storytellerName}&apos;s Dossier?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDelete(d.id!)}
                      className="px-4 py-1.5 bg-red-500 text-white text-sm rounded-lg font-semibold"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="px-4 py-1.5 text-slate-500 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {(() => {
                const member = d.storytellerUid
                  ? members.find((m) => m.uid === d.storytellerUid)
                  : undefined;
                return (
                  <div
                    className="cursor-pointer"
                    onClick={() => navigate(`/family/${familyId}/dossier/${d.id}`)}
                  >
                    {/* Name row */}
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <h3 className="text-lg font-bold text-slate-800">
                        {d.storytellerName}
                      </h3>
                      {d.preferredName && d.preferredName !== d.storytellerName && (
                        <span className="text-sm text-slate-400">
                          "{d.preferredName}"
                        </span>
                      )}
                    </div>

                    {/* Email */}
                    {member?.email && (
                      <p className="text-sm text-slate-500 mt-0.5">
                        {member.email}
                      </p>
                    )}

                    {/* Context */}
                    {d.storytellerContext && (
                      <p className="text-sm text-slate-400 mt-1.5 line-clamp-2">
                        {d.storytellerContext}
                      </p>
                    )}

                    {/* Badges */}
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <span className="text-xs text-slate-400 bg-slate-50 px-2 py-1 rounded-md capitalize">
                        {d.personality}
                      </span>
                      <span className="text-xs text-slate-400 bg-slate-50 px-2 py-1 rounded-md">
                        {d.selectedVoice}
                      </span>
                      {d.storytellerUid ? (
                        <span className="text-xs text-emerald-500 bg-emerald-50 px-2 py-1 rounded-md font-semibold">
                          Assigned
                        </span>
                      ) : (
                        <span className="text-xs text-amber-500 bg-amber-50 px-2 py-1 rounded-md font-semibold">
                          Needs Invite
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirmId(d.id!);
                }}
                className="absolute top-4 right-4 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                title="Delete Dossier"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
