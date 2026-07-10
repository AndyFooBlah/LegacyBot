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
 * FamilyPage — unified admin view for managing family members and information.
 *
 * Combines:
 *   - Member management (from MemberManagement)
 *   - Storyteller cards/bios (from DossierList)
 *   - Family tree (moved from DossierEditor)
 *
 * This is the main landing page for admins within a family.
 *
 * References: GitHub Issue #60 (Phase 1)
 */

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useFamily, useFamilyMembers, updateFamilyTree, updateMemberRoles } from '../../hooks/useFamily';
import { useFamilyInvitations } from '../../hooks/useInvitations';
import { useDossierList, setDossierStoryteller } from '../../hooks/useDossier';
import { useFamilyEvents, createEvent, updateEvent, deleteEvent } from '../../hooks/useEvents';
import { updateMemberEmail, resetMemberPassword } from '../../services/adminActions';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { InviteMember } from './InviteMember';
import { FamilyMember, RelationType, MemberType, UserRole } from '../../types';
import { applyRemoveMember, applyRemoveRelation, applyUpdateRelation } from '../../utils/familyTree';

export const FamilyPage: React.FC = () => {
  const { familyId } = useParams<{ familyId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { family, loading: familyLoading } = useFamily(familyId);
  const { members, loading: membersLoading } = useFamilyMembers(familyId);
  const { invitations, loading: invitesLoading, createInvite, cancelInvite } = useFamilyInvitations(familyId);
  const { dossiers, loading: dossiersLoading, createDossier, deleteDossier } = useDossierList(familyId);
  const { events, loading: eventsLoading } = useFamilyEvents(familyId);

  const [showInviteForm, setShowInviteForm] = useState(false);

  // Edit email state
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [saving, setSaving] = useState(false);

  // Edit name state
  const [editingNameUid, setEditingNameUid] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Reset password state
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [resetForName, setResetForName] = useState('');
  const [resetting, setResetting] = useState<string | null>(null);

  // Create storyteller state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  // Reissue invite state
  const [reissueLink, setReissueLink] = useState<string | null>(null);
  const [reissueForName, setReissueForName] = useState('');
  const [reissuing, setReissuing] = useState<string | null>(null);

  // Role management state
  const [updatingRoles, setUpdatingRoles] = useState<string | null>(null);

  // Events state
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [savingEvent, setSavingEvent] = useState(false);

  async function handleSaveName(targetUid: string) {
    if (!familyId || !editName.trim()) return;
    setSavingName(true);
    try {
      await updateDoc(doc(db, 'families', familyId, 'members', targetUid), {
        displayName: editName.trim(),
      });
      setEditingNameUid(null);
      setEditName('');
    } catch (err: any) {
      console.error('[FamilyPage] Update name error:', err);
      alert(err.message || 'Failed to update name');
    } finally {
      setSavingName(false);
    }
  }

  async function handleSaveEmail(targetUid: string) {
    if (!familyId || !editEmail.trim()) return;
    setSaving(true);
    try {
      await updateMemberEmail(familyId, targetUid, editEmail.trim());
      setEditingUid(null);
      setEditEmail('');
    } catch (err: any) {
      console.error('[FamilyPage] Update email error:', err);
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
      console.error('[FamilyPage] Reset password error:', err);
      alert(err.message || 'Failed to generate reset link');
    } finally {
      setResetting(null);
    }
  }

  async function handleReissueInvite(memberUid: string, memberEmail: string, displayName: string) {
    if (!familyId || !user) return;
    setReissuing(memberUid);
    try {
      const linkedDossierIds = dossiers
        .filter((d) => d.storytellerUid === memberUid)
        .map((d) => d.id!);
      const inviteId = await createInvite(memberEmail, ['storyteller'], linkedDossierIds, user.uid);
      const link = `${window.location.origin}/invite?token=${inviteId}&email=${encodeURIComponent(memberEmail)}`;
      setReissueLink(link);
      setReissueForName(displayName);
    } catch (err: any) {
      console.error('[FamilyPage] Reissue invite error:', err);
      alert(err.message || 'Failed to create invitation');
    } finally {
      setReissuing(null);
    }
  }

  async function handleToggleRole(targetUid: string, role: UserRole) {
    if (!familyId) return;
    const member = members.find((m) => m.uid === targetUid);
    if (!member) return;

    const hasRole = member.roles.includes(role);

    if (hasRole && role === 'admin') {
      const adminCount = members.filter((m) => m.roles.includes('admin')).length;
      if (adminCount <= 1) {
        alert('Cannot remove the only admin. Grant admin to another member first.');
        return;
      }
    }

    const newRoles: UserRole[] = hasRole
      ? member.roles.filter((r) => r !== role)
      : [...member.roles, role];

    setUpdatingRoles(targetUid);
    try {
      await updateMemberRoles(familyId, targetUid, newRoles);

      // When granting storyteller to someone without a dossier, create and link one.
      if (!hasRole && role === 'storyteller') {
        const hasDossier = dossiers.some((d) => d.storytellerUid === targetUid);
        if (!hasDossier) {
          const dossierId = await createDossier(member.displayName);
          await setDossierStoryteller(familyId, dossierId, targetUid);
        }
      }
    } catch (err: any) {
      console.error('[FamilyPage] Toggle role error:', err);
      alert(err.message || 'Failed to update role');
    } finally {
      setUpdatingRoles(null);
    }
  }

  async function handleCreateStoryteller() {
    if (!newFirstName.trim()) return;
    const fullName = [newFirstName.trim(), newLastName.trim()].filter(Boolean).join(' ');
    const dossierId = await createDossier(fullName);

    if (newEmail.trim() && user) {
      try {
        const inviteId = await createInvite(newEmail.trim(), ['storyteller'], [dossierId], user.uid);
        const link = `${window.location.origin}/invite?token=${inviteId}&email=${encodeURIComponent(newEmail.trim())}`;
        setInviteLink(link);
        setShowCreateForm(false);
        return;
      } catch (err) {
        console.error('[FamilyPage] Failed to create invitation:', err);
      }
    }

    setNewFirstName('');
    setNewLastName('');
    setNewEmail('');
    setShowCreateForm(false);
    navigate(`/family/${familyId}/dossier/${dossierId}`);
  }

  // Keep a ref to the latest family tree so the auto-sync can read fresh data
  // without depending on `family` (which would cause it to re-run on every tree
  // write and race with user-triggered updates).
  const familyTreeRef = useRef<FamilyMember[]>([]);
  useEffect(() => {
    familyTreeRef.current = family?.familyTree ?? [];
  }, [family]);

  // Auto-sync storytellers into the family tree.
  // Every storyteller should appear as a tree entry so other members can be
  // linked to them. Only re-runs when the members list changes (i.e. a new
  // storyteller joins), NOT on every tree write, to avoid race conditions.
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

  // Family Tree handlers (relational model)
  function handleAddFamilyMember(memberType: MemberType) {
    if (!familyId || !family) return;
    const newMember: FamilyMember = {
      id: `member-${Date.now()}`, // simple ID generation
      name: '',
      relations: [],
      memberType,
    };
    updateFamilyTree(familyId, [...(family.familyTree ?? []), newMember]);
  }

  function handleFamilyMemberChange(memberId: string, updates: Partial<FamilyMember>) {
    if (!familyId || !family) return;
    const updated = (family.familyTree ?? []).map((m) =>
      m.id === memberId ? { ...m, ...updates } : m
    );
    updateFamilyTree(familyId, updated);
  }

  function handleRemoveFamilyMember(memberId: string) {
    if (!familyId || !family) return;
    const tree = family.familyTree ?? [];
    const member = tree.find((m) => m.id === memberId);
    if (!window.confirm(`Remove ${member ? treeDisplayName(member) : 'this member'} from the family tree?`)) return;
    updateFamilyTree(familyId, applyRemoveMember(tree, memberId));
  }

  function handleAddRelation(memberId: string) {
    if (!familyId || !family) return;
    const member = (family.familyTree ?? []).find((m) => m.id === memberId);
    if (!member) return;
    // New relation starts with no target — inverse is applied when the user picks one.
    handleFamilyMemberChange(memberId, {
      relations: [...member.relations, { type: 'Parent' as RelationType, toMemberId: '' }],
    });
  }

  function handleRemoveRelation(memberId: string, relationIndex: number) {
    if (!familyId || !family) return;
    updateFamilyTree(familyId, applyRemoveRelation(family.familyTree ?? [], memberId, relationIndex));
  }

  function handleUpdateRelation(
    memberId: string,
    relationIndex: number,
    updates: { type?: RelationType; toMemberId?: string },
  ) {
    if (!familyId || !family) return;
    updateFamilyTree(familyId, applyUpdateRelation(family.familyTree ?? [], memberId, relationIndex, updates));
  }

  // Events handlers
  function handleCreateEventClick() {
    setEditingEventId(null);
    setEventTitle('');
    setEventDate('');
    setEventDescription('');
    setShowEventForm(true);
  }

  function handleEditEventClick(eventId: string) {
    const event = events.find((e) => e.id === eventId);
    if (!event) return;
    setEditingEventId(eventId);
    setEventTitle(event.title);
    setEventDate(event.date || '');
    setEventDescription(event.description);
    setShowEventForm(true);
  }

  async function handleSaveEvent() {
    if (!familyId || !user || !eventTitle.trim()) return;
    setSavingEvent(true);
    try {
      if (editingEventId) {
        await updateEvent(familyId, editingEventId, {
          title: eventTitle.trim(),
          date: eventDate.trim() || undefined,
          description: eventDescription.trim(),
        });
      } else {
        await createEvent(
          familyId,
          eventTitle.trim(),
          eventDescription.trim(),
          eventDate.trim() || undefined,
          user.uid,
        );
      }
      setShowEventForm(false);
      setEditingEventId(null);
      setEventTitle('');
      setEventDate('');
      setEventDescription('');
    } catch (err: any) {
      console.error('[FamilyPage] Save event error:', err);
      alert(err.message || 'Failed to save event');
    } finally {
      setSavingEvent(false);
    }
  }

  async function handleDeleteEvent(eventId: string) {
    if (!familyId) return;
    if (!confirm('Are you sure you want to delete this event?')) return;
    try {
      await deleteEvent(familyId, eventId);
    } catch (err: any) {
      console.error('[FamilyPage] Delete event error:', err);
      alert(err.message || 'Failed to delete event');
    }
  }

  if (familyLoading || membersLoading || invitesLoading || dossiersLoading || eventsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  const familyTree = family?.familyTree ?? [];

  /** Display a family tree member as "Last, First" when both names are known. */
  function treeDisplayName(m: { name: string; firstName?: string; lastName?: string }): string {
    if (m.firstName && m.lastName) return `${m.lastName}, ${m.firstName}`;
    if (m.firstName) return m.firstName;
    return m.name || 'Unnamed';
  }

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold text-slate-800 tracking-tight">
          {family?.name || 'Family'}
        </h2>
        <p className="text-slate-400 mt-1">
          Manage family members, storytellers, and family tree information.
        </p>
      </div>

      {/* Members Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-slate-700">Family Members</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
            >
              + New Storyteller
            </button>
            <button
              onClick={() => setShowInviteForm(true)}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors"
            >
              + Invite Member
            </button>
          </div>
        </div>

        {/* New Storyteller Form */}
        {showCreateForm && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-800">Create New Storyteller</h3>
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newFirstName}
                  onChange={(e) => setNewFirstName(e.target.value)}
                  placeholder="First name"
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
                placeholder="Email (optional — invite will be generated)"
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreateStoryteller}
                disabled={!newFirstName.trim()}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  setNewFirstName('');
                  setNewLastName('');
                  setNewEmail('');
                }}
                className="px-4 py-2 text-slate-500 font-medium hover:text-slate-700 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Invite Link Display */}
        {inviteLink && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 shadow-sm space-y-3">
            <p className="text-sm font-semibold text-emerald-800">Invitation Created!</p>
            <p className="text-xs text-emerald-600">Share this link with the storyteller:</p>
            <div className="bg-white rounded-lg p-3 border border-emerald-200 break-all text-xs font-mono text-slate-700">
              {inviteLink}
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(inviteLink);
                alert('Link copied to clipboard!');
              }}
              className="text-sm text-emerald-600 font-medium hover:underline"
            >
              Copy to Clipboard
            </button>
            <button
              onClick={() => setInviteLink(null)}
              className="ml-4 text-sm text-slate-400 hover:text-slate-600"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Invite Form */}
        {showInviteForm && familyId && (
          <InviteMember familyId={familyId} onClose={() => setShowInviteForm(false)} />
        )}

        {/* Members List */}
        <div className="space-y-3">
          {members.map((member) => {
            const dossier = dossiers.find((d) => d.storytellerUid === member.uid);
            const isStoryteller = member.roles.includes('storyteller');
            const isAdmin = member.roles.includes('admin');
            const isEditing = editingUid === member.uid;
            const isEditingName = editingNameUid === member.uid;
            // Treat displayName as absent if it was set to the email (common when no Google name exists)
            const resolvedName = member.displayName && member.displayName !== member.email
              ? member.displayName
              : (dossier?.storytellerName || null);

            return (
              <div
                key={member.uid}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {isEditingName ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(member.uid); if (e.key === 'Escape') { setEditingNameUid(null); setEditName(''); } }}
                            className="flex-1 p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold outline-none focus:ring-1 focus:ring-indigo-500"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveName(member.uid)}
                            disabled={savingName || !editName.trim()}
                            className="px-2 py-1 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {savingName ? '…' : 'Save'}
                          </button>
                          <button
                            onClick={() => { setEditingNameUid(null); setEditName(''); }}
                            className="text-xs text-slate-400 hover:text-slate-600"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <p className="font-semibold text-slate-800">{resolvedName ?? member.email}</p>
                      )}
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

                    {isEditing ? (
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                        <button
                          onClick={() => handleSaveEmail(member.uid)}
                          disabled={saving}
                          className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => {
                            setEditingUid(null);
                            setEditEmail('');
                          }}
                          className="text-xs text-slate-500 hover:text-slate-700"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">{member.email}</p>
                    )}

                    {/* Storyteller bio — truncated to 3 lines */}
                    {dossier?.storytellerContext && (
                      <p className="text-sm text-slate-600 mt-2 italic line-clamp-3">
                        {dossier.storytellerContext}
                      </p>
                    )}

                    {/* Role toggles */}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-slate-400">Roles:</span>
                      {(['admin', 'storyteller'] as UserRole[]).map((role) => {
                        const active = member.roles.includes(role);
                        return (
                          <button
                            key={role}
                            onClick={() => handleToggleRole(member.uid, role)}
                            disabled={updatingRoles === member.uid}
                            title={active ? `Remove ${role} role` : `Grant ${role} role`}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider transition-colors disabled:opacity-50 ${
                              active
                                ? role === 'admin'
                                  ? 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'
                                  : 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                                : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                            }`}
                          >
                            {active ? '✓ ' : '+ '}{role}
                          </button>
                        );
                      })}
                      {updatingRoles === member.uid && (
                        <span className="text-xs text-slate-400">Saving…</span>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-col gap-1 text-xs">
                    {dossier && (
                      <button
                        onClick={() => navigate(`/family/${familyId}/dossier/${dossier.id}`)}
                        className="text-indigo-600 hover:underline font-medium text-left"
                      >
                        Edit Dossier
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEditingNameUid(member.uid);
                        setEditName(resolvedName ?? '');
                      }}
                      className="text-slate-500 hover:underline text-left"
                    >
                      Edit Name
                    </button>
                    <button
                      onClick={() => {
                        setEditingUid(member.uid);
                        setEditEmail(member.email);
                      }}
                      className="text-slate-500 hover:underline text-left"
                    >
                      Edit Email
                    </button>
                    <button
                      onClick={() => handleResetPassword(member.uid, member.displayName)}
                      disabled={resetting === member.uid}
                      className="text-slate-500 hover:underline text-left disabled:opacity-50"
                    >
                      {resetting === member.uid ? 'Generating...' : 'Reset Password'}
                    </button>
                    {isStoryteller && !dossier?.storytellerUid && (
                      <button
                        onClick={() => handleReissueInvite(member.uid, member.email, member.displayName)}
                        disabled={reissuing === member.uid}
                        className="text-slate-500 hover:underline text-left disabled:opacity-50"
                      >
                        {reissuing === member.uid ? 'Generating...' : 'Reissue Invite'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Reset Password Link */}
        {resetLink && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 shadow-sm space-y-3">
            <p className="text-sm font-semibold text-amber-800">Password Reset Link Generated for {resetForName}</p>
            <p className="text-xs text-amber-600">Share this link with them:</p>
            <div className="bg-white rounded-lg p-3 border border-amber-200 break-all text-xs font-mono text-slate-700">
              {resetLink}
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(resetLink);
                alert('Link copied to clipboard!');
              }}
              className="text-sm text-amber-600 font-medium hover:underline"
            >
              Copy to Clipboard
            </button>
            <button
              onClick={() => setResetLink(null)}
              className="ml-4 text-sm text-slate-400 hover:text-slate-600"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Reissue Invite Link */}
        {reissueLink && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 shadow-sm space-y-3">
            <p className="text-sm font-semibold text-emerald-800">Invitation Reissued for {reissueForName}</p>
            <p className="text-xs text-emerald-600">Share this link with them:</p>
            <div className="bg-white rounded-lg p-3 border border-emerald-200 break-all text-xs font-mono text-slate-700">
              {reissueLink}
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(reissueLink);
                alert('Link copied to clipboard!');
              }}
              className="text-sm text-emerald-600 font-medium hover:underline"
            >
              Copy to Clipboard
            </button>
            <button
              onClick={() => setReissueLink(null)}
              className="ml-4 text-sm text-slate-400 hover:text-slate-600"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Pending Invitations */}
        {invitations.filter((inv) => inv.status === 'pending').length > 0 && (
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-6 shadow-sm space-y-3">
            <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Pending Invitations</h4>
            <div className="space-y-2">
              {invitations
                .filter((inv) => inv.status === 'pending')
                .map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{inv.email}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">
                        {inv.roles.join(', ')}
                      </span>
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

      {/* Family Tree Section (Relational Model) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-slate-700">Family Tree</h3>
          <div className="flex gap-2">
            <button
              onClick={() => handleAddFamilyMember('person')}
              className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
            >
              + Add Person
            </button>
            <button
              onClick={() => handleAddFamilyMember('pet')}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors"
            >
              + Add Pet
            </button>
          </div>
        </div>

        {familyTree.length === 0 ? (
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-8 text-center text-slate-400">
            No family members added yet. Add people, pets, and friends to build your family tree.
          </div>
        ) : (
          <div className="space-y-4">
            {familyTree.map((member) => (
              <div
                key={member.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4"
              >
                {/* Member header */}
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-2">
                      {member.memberType === 'pet' ? (
                        <input
                          type="text"
                          value={member.name}
                          onChange={(e) => handleFamilyMemberChange(member.id, { name: e.target.value })}
                          placeholder="Pet name"
                          className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      ) : (
                        <>
                          <input
                            type="text"
                            value={member.firstName ?? ''}
                            onChange={(e) => handleFamilyMemberChange(member.id, {
                              firstName: e.target.value,
                              name: [e.target.value, member.lastName ?? ''].filter(Boolean).join(' '),
                            })}
                            placeholder="First name"
                            className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                          <input
                            type="text"
                            value={member.lastName ?? ''}
                            onChange={(e) => handleFamilyMemberChange(member.id, {
                              lastName: e.target.value,
                              name: [member.firstName ?? '', e.target.value].filter(Boolean).join(' '),
                            })}
                            placeholder="Last name"
                            className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </>
                      )}
                      <span className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded-full font-medium">
                        {member.memberType === 'pet' ? '🐾 Pet' : '👤 Person'}
                      </span>
                    </div>

                    <textarea
                      value={member.notes || ''}
                      onChange={(e) => handleFamilyMemberChange(member.id, { notes: e.target.value })}
                      placeholder="Notes (optional)"
                      rows={2}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                    />
                  </div>

                  <button
                    onClick={() => handleRemoveFamilyMember(member.id)}
                    className="text-slate-300 hover:text-rose-500 transition-colors text-xl ml-4"
                    title="Remove member"
                  >
                    &times;
                  </button>
                </div>

                {/* Relationships */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Relationships</p>
                    <button
                      onClick={() => handleAddRelation(member.id)}
                      className="text-xs text-indigo-600 font-medium hover:underline"
                    >
                      + Add Relationship
                    </button>
                  </div>

                  {member.relations.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No relationships defined yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {member.relations.map((relation, relationIdx) => (
                        <div key={relationIdx} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
                          <select
                            value={relation.type}
                            onChange={(e) =>
                              handleUpdateRelation(member.id, relationIdx, {
                                type: e.target.value as RelationType,
                              })
                            }
                            className="p-1.5 bg-white border border-slate-200 rounded text-xs outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="Parent">Parent</option>
                            <option value="Spouse">Spouse</option>
                            <option value="Child">Child</option>
                            <option value="Sibling">Sibling</option>
                            <option value="Friend">Friend</option>
                            <option value="Pet Owner">Pet Owner</option>
                            <option value="Pet">Pet</option>
                          </select>

                          <span className="text-xs text-slate-400">of</span>

                          <select
                            value={relation.toMemberId}
                            onChange={(e) =>
                              handleUpdateRelation(member.id, relationIdx, {
                                toMemberId: e.target.value,
                              })
                            }
                            className="flex-1 p-1.5 bg-white border border-slate-200 rounded text-xs outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="">Select a member...</option>
                            {familyTree
                              .filter((m) => m.id !== member.id)
                              .map((m) => (
                                <option key={m.id} value={m.id}>
                                  {treeDisplayName(m)}{m.memberType === 'pet' ? ' 🐾' : ''}
                                </option>
                              ))}
                          </select>

                          <button
                            onClick={() => handleRemoveRelation(member.id, relationIdx)}
                            className="text-slate-300 hover:text-rose-500 transition-colors text-lg"
                            title="Remove relationship"
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Events Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-slate-700">Family Events</h3>
          <button
            onClick={handleCreateEventClick}
            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
          >
            + Add Event
          </button>
        </div>

        {/* Event Form */}
        {showEventForm && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h4 className="font-bold text-slate-800">
              {editingEventId ? 'Edit Event' : 'Create New Event'}
            </h4>
            <div className="space-y-3">
              <input
                type="text"
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                placeholder="Event title (e.g., Marriage of Ralph and Margaret)"
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <input
                type="text"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                placeholder="Date (optional, e.g., June 15, 1952 or Summer 1952)"
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <textarea
                value={eventDescription}
                onChange={(e) => setEventDescription(e.target.value)}
                placeholder="Event description"
                rows={3}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSaveEvent}
                disabled={!eventTitle.trim() || savingEvent}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {savingEvent ? 'Saving...' : editingEventId ? 'Update Event' : 'Create Event'}
              </button>
              <button
                onClick={() => {
                  setShowEventForm(false);
                  setEditingEventId(null);
                  setEventTitle('');
                  setEventDate('');
                  setEventDescription('');
                }}
                className="px-4 py-2 text-slate-500 font-medium hover:text-slate-700 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Events Timeline */}
        {events.length === 0 ? (
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-8 text-center text-slate-400">
            No events added yet. Add important family milestones and events to the timeline.
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((event) => (
              <div
                key={event.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-semibold text-slate-800">{event.title}</h4>
                    {event.date && (
                      <p className="text-xs text-slate-400 mt-0.5">{event.date}</p>
                    )}
                    {event.description && (
                      <p className="text-sm text-slate-600 mt-2">{event.description}</p>
                    )}
                    {/* Attribution badges */}
                    {(event.storytellerUids.length > 0 || event.sessionIds.length > 0) && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {event.storytellerUids.length > 0 && (
                          <span className="text-xs text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5">
                            {event.storytellerUids.length === 1
                              ? (() => {
                                  const m = members.find((mb) => mb.uid === event.storytellerUids[0]);
                                  return m?.displayName || m?.email || 'Storyteller';
                                })()
                              : `${event.storytellerUids.length} storytellers`}
                          </span>
                        )}
                        {event.sessionIds.length > 0 && (
                          <span className="text-xs text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
                            {event.sessionIds.length} {event.sessionIds.length === 1 ? 'session' : 'sessions'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 ml-4 shrink-0">
                    <button
                      onClick={() => navigate(`/family/${familyId}/events/${event.id}`)}
                      className="text-xs text-slate-500 hover:underline font-medium"
                    >
                      Details
                    </button>
                    <button
                      onClick={() => handleEditEventClick(event.id)}
                      className="text-xs text-indigo-600 hover:underline font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteEvent(event.id)}
                      className="text-xs text-rose-500 hover:underline font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
