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
 * InviteMember — form for admins to invite a new family member.
 * Creates an invitation doc which triggers the Cloud Function email.
 */

import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useFamilyInvitations } from '../../hooks/useInvitations';
import { useDossierList } from '../../hooks/useDossier';
import { UserRole } from '../../types';

interface InviteMemberProps {
  familyId: string;
  onClose: () => void;
}

export const InviteMember: React.FC<InviteMemberProps> = ({ familyId, onClose }) => {
  const { user } = useAuth();
  const { createInvite } = useFamilyInvitations(familyId);
  const { dossiers } = useDossierList(familyId);

  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<UserRole[]>(['storyteller']);
  const [selectedDossierIds, setSelectedDossierIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  function toggleRole(role: UserRole) {
    setRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  function toggleDossier(id: string) {
    setSelectedDossierIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || roles.length === 0 || !user) return;

    setSending(true);
    try {
      const inviteId = await createInvite(email.trim(), roles, selectedDossierIds, user.uid);
      const link = `${window.location.origin}/invite?token=${inviteId}&email=${encodeURIComponent(email.trim())}`;
      setInviteLink(link);
    } catch (err) {
      console.error('[InviteMember] Error:', err);
    } finally {
      setSending(false);
    }
  }

  if (inviteLink) {
    return (
      <div className="bg-green-50 rounded-2xl border border-green-200 p-6 space-y-4">
        <p className="font-semibold text-green-700 text-center">Invitation created for {email}!</p>
        <div className="space-y-2">
          <label className="block text-xs font-bold text-green-600 uppercase tracking-wider">
            Share this invite link
          </label>
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
          <p className="text-xs text-green-600">
            Send this link to {email} so they can join your family.
          </p>
        </div>
        <button onClick={onClose} className="text-sm text-green-600 font-medium hover:underline">
          Close
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
      <h3 className="font-bold text-slate-700">Invite a Family Member</h3>

      <div className="space-y-1">
        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
          Email Address
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="relative@example.com"
          autoFocus
          className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
          Role(s)
        </label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => toggleRole('admin')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
              roles.includes('admin')
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Admin
          </button>
          <button
            type="button"
            onClick={() => toggleRole('storyteller')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
              roles.includes('storyteller')
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Storyteller
          </button>
        </div>
      </div>

      {roles.includes('storyteller') && dossiers.length > 0 && (
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
            Assign to Dossier(s)
          </label>
          <div className="space-y-2">
            {dossiers.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedDossierIds.includes(d.id!)}
                  onChange={() => toggleDossier(d.id!)}
                  className="rounded border-slate-300"
                />
                {d.storytellerName}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={!email.trim() || roles.length === 0 || sending}
          className="px-5 py-2 bg-indigo-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50 hover:bg-indigo-700 transition-colors"
        >
          {sending ? 'Sending...' : 'Send Invitation'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-slate-500 hover:text-slate-700 text-sm font-medium"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};
