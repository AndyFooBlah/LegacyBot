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
 * MemberManagement — admin view for managing family members.
 * Lists members with roles, provides invitation, email editing, and password reset.
 */

import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../hooks/useAuth';
import { useFamilyMembers } from '../../hooks/useFamily';
import { useFamilyInvitations } from '../../hooks/useInvitations';
import { useDossierList } from '../../hooks/useDossier';
import { updateMemberEmail, resetMemberPassword } from '../../services/adminActions';
import { InviteMember } from './InviteMember';

export const MemberManagement: React.FC = () => {
  const { familyId } = useParams<{ familyId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { members, loading: membersLoading } = useFamilyMembers(familyId);
  const { invitations, loading: invitesLoading, createInvite, cancelInvite } = useFamilyInvitations(familyId);
  const { dossiers } = useDossierList(familyId);
  const [showInviteForm, setShowInviteForm] = useState(false);

  // Edit email state
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset password state
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [resetForName, setResetForName] = useState('');
  const [resetting, setResetting] = useState<string | null>(null);

  // Reissue invite state
  const [reissueLink, setReissueLink] = useState<string | null>(null);
  const [reissueForName, setReissueForName] = useState('');
  const [reissuing, setReissuing] = useState<string | null>(null);

  async function handleSaveEmail(targetUid: string) {
    if (!familyId || !editEmail.trim()) return;
    setSaving(true);
    try {
      await updateMemberEmail(familyId, targetUid, editEmail.trim());
      setEditingUid(null);
      setEditEmail('');
    } catch (err: any) {
      console.error('[MemberManagement] Update email error:', err);
      alert(err.message || 'Failed to update email');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword(targetUid: string, displayName: string) {
    if (!familyId) return;
    setResetting(targetUid);
    try {
      const link = await resetMemberPassword(familyId, targetUid);
      setResetLink(link);
      setResetForName(displayName);
    } catch (err: any) {
      console.error('[MemberManagement] Reset password error:', err);
      alert(err.message || 'Failed to generate reset link');
    } finally {
      setResetting(null);
    }
  }

  async function handleReissueInvite(memberUid: string, memberEmail: string, displayName: string) {
    if (!familyId || !user) return;
    setReissuing(memberUid);
    try {
      // Find dossiers linked to this storyteller
      const linkedDossierIds = dossiers
        .filter((d) => d.storytellerUid === memberUid)
        .map((d) => d.id!);
      const inviteId = await createInvite(memberEmail, ['storyteller'], linkedDossierIds, user.uid);
      const link = `${window.location.origin}/invite?token=${inviteId}&email=${encodeURIComponent(memberEmail)}`;
      setReissueLink(link);
      setReissueForName(displayName);
    } catch (err: any) {
      console.error('[MemberManagement] Reissue invite error:', err);
      alert(err.message || 'Failed to create invitation');
    } finally {
      setReissuing(null);
    }
  }

  if (membersLoading || invitesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate(`/family/${familyId}`)}
            className="text-sm text-indigo-600 font-medium hover:underline mb-1"
          >
            &larr; Back
          </button>
          <h2 className="text-2xl font-bold text-slate-800">Family Members</h2>
        </div>
        <button
          onClick={() => setShowInviteForm(true)}
          className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors shadow-lg"
        >
          + Invite Member
        </button>
      </div>

      {showInviteForm && (
        <InviteMember
          familyId={familyId!}
          onClose={() => setShowInviteForm(false)}
        />
      )}

      {/* Password reset link display */}
      {resetLink && (
        <div className="bg-blue-50 rounded-2xl border border-blue-200 p-6 space-y-3">
          <p className="font-semibold text-blue-700">
            Password reset link for {resetForName}:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={resetLink}
              className="flex-1 p-3 bg-white border border-blue-200 rounded-xl text-sm text-slate-700 select-all"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              onClick={() => navigator.clipboard.writeText(resetLink)}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              Copy
            </button>
          </div>
          <div className="flex gap-4">
            <button
              onClick={() => { setResetLink(null); setResetForName(''); }}
              className="text-sm text-blue-600 font-medium hover:underline"
            >
              Dismiss
            </button>
            <button
              onClick={() => navigate('/')}
              className="text-sm text-slate-500 font-medium hover:underline"
            >
              Go to Login Page
            </button>
          </div>
        </div>
      )}

      {/* Reissued invite link display */}
      {reissueLink && (
        <div className="bg-green-50 rounded-2xl border border-green-200 p-6 space-y-3">
          <p className="font-semibold text-green-700">
            New invite link for {reissueForName}:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={reissueLink}
              className="flex-1 p-3 bg-white border border-green-200 rounded-xl text-sm text-slate-700 select-all"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              onClick={() => navigator.clipboard.writeText(reissueLink)}
              className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-colors"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-green-600">
            Send this link to {reissueForName} so they can sign in.
          </p>
          <button
            onClick={() => { setReissueLink(null); setReissueForName(''); }}
            className="text-sm text-green-600 font-medium hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="space-y-3">
        {members.map((member) => (
          <div
            key={member.uid}
            className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="font-semibold text-slate-800">{member.displayName}</p>
                {editingUid === member.uid ? (
                  <div className="flex gap-2 items-center mt-1">
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveEmail(member.uid)}
                    />
                    <button
                      onClick={() => handleSaveEmail(member.uid)}
                      disabled={saving || !editEmail.trim()}
                      className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setEditingUid(null); setEditEmail(''); }}
                      className="px-3 py-1.5 text-slate-500 text-xs font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">{member.email}</p>
                )}
              </div>
              <div className="flex gap-2">
                {member.roles.map((role) => (
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

            {/* Notification preference toggle (show for yourself if admin) */}
            {member.uid === user?.uid && member.roles.includes('admin') && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={member.notifyOnSessionComplete ?? false}
                    onChange={async (e) => {
                      if (!familyId) return;
                      const memberRef = doc(db, 'families', familyId, 'members', member.uid);
                      await updateDoc(memberRef, { notifyOnSessionComplete: e.target.checked });
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-slate-600">Email me when a storyteller completes a session</span>
                </label>
              </div>
            )}

            {/* Admin actions (don't show for yourself) */}
            {member.uid !== user?.uid && editingUid !== member.uid && (
              <div className="flex gap-3 mt-3 pt-3 border-t border-slate-100">
                <button
                  onClick={() => {
                    setEditingUid(member.uid);
                    setEditEmail(member.email);
                  }}
                  className="text-xs text-slate-500 font-medium hover:text-indigo-600 transition-colors"
                >
                  Edit Email
                </button>
                <button
                  onClick={() => handleResetPassword(member.uid, member.displayName)}
                  disabled={resetting === member.uid}
                  className="text-xs text-slate-500 font-medium hover:text-indigo-600 transition-colors disabled:opacity-50"
                >
                  {resetting === member.uid ? 'Generating...' : 'Reset Password'}
                </button>
                {member.roles.includes('storyteller') && (
                  <>
                    <button
                      onClick={() => handleReissueInvite(member.uid, member.email, member.displayName)}
                      disabled={reissuing === member.uid}
                      className="text-xs text-slate-500 font-medium hover:text-emerald-600 transition-colors disabled:opacity-50"
                    >
                      {reissuing === member.uid ? 'Creating...' : 'Reissue Invite'}
                    </button>
                    {dossiers
                      .filter((d) => d.storytellerUid === member.uid)
                      .map((d) => (
                        <button
                          key={d.id}
                          onClick={() => navigate(`/family/${familyId}/dossier/${d.id}`)}
                          className="text-xs text-indigo-500 font-medium hover:text-indigo-700 transition-colors"
                        >
                          Edit Dossier
                        </button>
                      ))}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {invitations.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-bold text-slate-600 text-sm uppercase tracking-wider">
            Pending Invitations
          </h3>
          {invitations.map((invite) => {
            const link = `${window.location.origin}/invite?token=${invite.id}&email=${encodeURIComponent(invite.email)}`;
            return (
              <div
                key={invite.id}
                className="bg-amber-50 rounded-2xl border border-amber-200 p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="font-medium text-slate-700">{invite.email}</p>
                    <p className="text-xs text-amber-600 font-semibold uppercase">
                      {invite.roles.join(', ')}
                    </p>
                  </div>
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-amber-100 text-amber-600 uppercase">
                    Pending
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={link}
                    className="flex-1 p-2 bg-white border border-amber-200 rounded-lg text-xs text-slate-600 select-all"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(link)}
                    className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-semibold hover:bg-amber-600 transition-colors"
                  >
                    Copy Link
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`Cancel invitation for ${invite.email}?`)) return;
                      try {
                        await cancelInvite(invite.id!);
                      } catch (err) {
                        console.error('[MemberManagement] Cancel invite error:', err);
                        alert('Failed to cancel invitation');
                      }
                    }}
                    className="px-3 py-1.5 bg-rose-100 text-rose-600 rounded-lg text-xs font-semibold hover:bg-rose-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
