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
 * MemberAdmin — edit a single family member's name, email, roles,
 * dossier link, and password reset.
 *
 * Route: /family/:familyId/member/:memberUid
 */

import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../hooks/useAuth';
import {
  useFamilyMembers,
  updateMemberRoles,
} from '../../hooks/useFamily';
import { useFamilyInvitations } from '../../hooks/useInvitations';
import { useDossierList, setDossierStoryteller } from '../../hooks/useDossier';
import { updateMemberEmail, resetMemberPassword } from '../../services/adminActions';
import { UserRole } from '../../types';

export const MemberAdmin: React.FC = () => {
  const { familyId, memberUid } = useParams<{ familyId: string; memberUid: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const { members, loading: membersLoading } = useFamilyMembers(familyId);
  const { invitations, createInvite } = useFamilyInvitations(familyId);
  const { dossiers, loading: dossiersLoading, createDossier } = useDossierList(familyId);

  // Edit name
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Edit email
  const [editingEmail, setEditingEmail] = useState(false);
  const [editEmail, setEditEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  // Reset password
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  // Reissue invite
  const [reissueLink, setReissueLink] = useState<string | null>(null);
  const [reissuing, setReissuing] = useState(false);

  // Role updates
  const [updatingRoles, setUpdatingRoles] = useState(false);

  if (membersLoading || dossiersLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  const member = members.find((m) => m.uid === memberUid);
  if (!member) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <p className="text-slate-500">Member not found.</p>
        <button onClick={() => navigate(`/family/${familyId}`)} className="mt-4 text-indigo-600 hover:underline text-sm">
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  const dossier = dossiers.find((d) => d.storytellerUid === member.uid);
  const isStoryteller = member.roles.includes('storyteller');
  const isAdmin = member.roles.includes('admin');
  const resolvedName =
    member.displayName && member.displayName !== member.email
      ? member.displayName
      : (dossier?.storytellerName ?? null);

  async function handleSaveName() {
    if (!familyId || !editName.trim()) return;
    setSavingName(true);
    try {
      await updateDoc(doc(db, 'families', familyId, 'members', member!.uid), {
        displayName: editName.trim(),
      });
      setEditingName(false);
    } catch (err: any) {
      alert(err.message || 'Failed to update name');
    } finally {
      setSavingName(false);
    }
  }

  async function handleSaveEmail() {
    if (!familyId || !editEmail.trim()) return;
    setSavingEmail(true);
    try {
      await updateMemberEmail(familyId, member!.uid, editEmail.trim());
      setEditingEmail(false);
    } catch (err: any) {
      alert(err.message || 'Failed to update email');
    } finally {
      setSavingEmail(false);
    }
  }

  async function handleResetPassword() {
    if (!familyId) return;
    setResetting(true);
    try {
      const link = await resetMemberPassword(familyId, member!.uid);
      setResetLink(link);
    } catch (err: any) {
      alert(err.message || 'Failed to generate reset link');
    } finally {
      setResetting(false);
    }
  }

  async function handleToggleRole(role: UserRole) {
    if (!familyId) return;
    const hasRole = member!.roles.includes(role);

    if (hasRole && role === 'admin') {
      const adminCount = members.filter((m) => m.roles.includes('admin')).length;
      if (adminCount <= 1) {
        alert('Cannot remove the only admin. Grant admin to another member first.');
        return;
      }
    }

    const newRoles: UserRole[] = hasRole
      ? member!.roles.filter((r) => r !== role)
      : [...member!.roles, role];

    setUpdatingRoles(true);
    try {
      await updateMemberRoles(familyId, member!.uid, newRoles);

      if (!hasRole && role === 'storyteller') {
        const hasDossier = dossiers.some((d) => d.storytellerUid === member!.uid);
        if (!hasDossier) {
          const dossierId = await createDossier(resolvedName ?? member!.displayName ?? 'Storyteller');
          await setDossierStoryteller(familyId, dossierId, member!.uid);
        }
      }
    } catch (err: any) {
      alert(err.message || 'Failed to update role');
    } finally {
      setUpdatingRoles(false);
    }
  }

  async function handleReissueInvite() {
    if (!familyId || !user) return;
    setReissuing(true);
    try {
      const linkedDossierIds = dossiers
        .filter((d) => d.storytellerUid === member!.uid)
        .map((d) => d.id!);
      const inviteId = await createInvite(member!.email, ['storyteller'], linkedDossierIds, user.uid);
      const link = `${window.location.origin}/invite?token=${inviteId}&email=${encodeURIComponent(member!.email)}`;
      setReissueLink(link);
    } catch (err: any) {
      alert(err.message || 'Failed to create invitation');
    } finally {
      setReissuing(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      {/* Back link */}
      <button
        onClick={() => navigate(`/family/${familyId}`)}
        className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
      >
        ← Back to Dashboard
      </button>

      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-800">{resolvedName ?? member.email}</h2>
        <p className="text-slate-400 text-sm mt-0.5">{member.email}</p>
        <div className="flex gap-2 mt-2">
          {isAdmin && (
            <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded-full uppercase tracking-wider">
              Admin
            </span>
          )}
          {isStoryteller && (
            <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-600 rounded-full uppercase tracking-wider">
              Storyteller
            </span>
          )}
        </div>
      </div>

      {/* Edit Name */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
        <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Display Name</h3>
        {editingName ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName();
                if (e.key === 'Escape') setEditingName(false);
              }}
              autoFocus
              className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              onClick={handleSaveName}
              disabled={savingName || !editName.trim()}
              className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              {savingName ? '…' : 'Save'}
            </button>
            <button
              onClick={() => setEditingName(false)}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-slate-800">{resolvedName ?? <span className="italic text-slate-400">Not set</span>}</p>
            <button
              onClick={() => { setEditingName(true); setEditName(resolvedName ?? ''); }}
              className="text-xs text-indigo-600 hover:underline"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Edit Email */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
        <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Email</h3>
        {editingEmail ? (
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEmail();
                if (e.key === 'Escape') setEditingEmail(false);
              }}
              autoFocus
              className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              onClick={handleSaveEmail}
              disabled={savingEmail || !editEmail.trim()}
              className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              {savingEmail ? '…' : 'Save'}
            </button>
            <button
              onClick={() => setEditingEmail(false)}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-slate-800">{member.email}</p>
            <button
              onClick={() => { setEditingEmail(true); setEditEmail(member.email); }}
              className="text-xs text-indigo-600 hover:underline"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Roles */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
        <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Roles</h3>
        <div className="flex items-center gap-3">
          {(['admin', 'storyteller'] as UserRole[]).map((role) => {
            const active = member.roles.includes(role);
            return (
              <button
                key={role}
                onClick={() => handleToggleRole(role)}
                disabled={updatingRoles}
                title={active ? `Remove ${role} role` : `Grant ${role} role`}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${
                  active
                    ? role === 'admin'
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                }`}
              >
                {active ? '✓ ' : ''}{role}
              </button>
            );
          })}
          {updatingRoles && <span className="text-xs text-slate-400">Saving…</span>}
        </div>
      </div>

      {/* Dossier Link */}
      {dossier && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Dossier</h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-800 font-medium">{dossier.storytellerName}</p>
              {dossier.storytellerContext && (
                <p className="text-xs text-slate-400 mt-0.5 italic line-clamp-2">
                  {dossier.storytellerContext}
                </p>
              )}
            </div>
            <button
              onClick={() => navigate(`/family/${familyId}/dossier/${dossier.id}`)}
              className="px-3 py-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors shrink-0 ml-4"
            >
              Edit Dossier
            </button>
          </div>
        </div>
      )}

      {/* Password Reset */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
        <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Password Reset</h3>
        {resetLink ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Share this link with {resolvedName ?? 'the member'}:</p>
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 break-all text-xs font-mono text-slate-700">
              {resetLink}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { navigator.clipboard.writeText(resetLink); alert('Link copied!'); }}
                className="text-sm text-amber-600 font-medium hover:underline"
              >
                Copy to Clipboard
              </button>
              <button onClick={() => setResetLink(null)} className="text-sm text-slate-400 hover:text-slate-600">
                Dismiss
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleResetPassword}
            disabled={resetting}
            className="px-4 py-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-100 transition-colors disabled:opacity-50"
          >
            {resetting ? 'Generating…' : 'Generate Password Reset Link'}
          </button>
        )}
      </div>

      {/* Reissue Invite (storytellers without confirmed link) */}
      {isStoryteller && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Reissue Invite</h3>
          {reissueLink ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">New invitation link:</p>
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 break-all text-xs font-mono text-slate-700">
                {reissueLink}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { navigator.clipboard.writeText(reissueLink); alert('Link copied!'); }}
                  className="text-sm text-emerald-600 font-medium hover:underline"
                >
                  Copy to Clipboard
                </button>
                <button onClick={() => setReissueLink(null)} className="text-sm text-slate-400 hover:text-slate-600">
                  Dismiss
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleReissueInvite}
              disabled={reissuing}
              className="px-4 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-sm font-medium hover:bg-emerald-100 transition-colors disabled:opacity-50"
            >
              {reissuing ? 'Generating…' : 'Reissue Invitation Link'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
