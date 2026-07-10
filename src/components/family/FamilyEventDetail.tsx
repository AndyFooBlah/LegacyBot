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
 * FamilyEventDetail — full detail view for a family-level event.
 *
 * Shows event metadata, storytellers who mentioned it, session attribution,
 * and admin controls (edit/delete).
 *
 * Route: /family/:familyId/events/:eventId
 *
 * References: GitHub Issue #62 (Phase 3)
 */

import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useFamilyEvents, updateEvent, deleteEvent } from '../../hooks/useEvents';
import { useFamilyMembers, useCurrentRoles } from '../../hooks/useFamily';

export const FamilyEventDetail: React.FC = () => {
  const { familyId, eventId } = useParams<{ familyId: string; eventId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const { events, loading: eventsLoading } = useFamilyEvents(familyId);
  const { members } = useFamilyMembers(familyId);
  const { isAdmin } = useCurrentRoles(familyId, user?.uid);

  const event = events.find((e) => e.id === eventId);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const memberNameByUid = (uid: string): string => {
    const member = members.find((m) => m.uid === uid);
    return member?.displayName || member?.email || uid;
  };

  const handleEditClick = () => {
    if (!event) return;
    setEditTitle(event.title);
    setEditDate(event.date ?? '');
    setEditDescription(event.description);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!familyId || !eventId || !editTitle.trim()) return;
    setSaving(true);
    try {
      await updateEvent(familyId, eventId, {
        title: editTitle.trim(),
        date: editDate.trim() || undefined,
        description: editDescription.trim(),
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!familyId || !eventId) return;
    if (!window.confirm(`Delete "${event?.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteEvent(familyId, eventId);
      navigate(`/family/${familyId}`);
    } finally {
      setDeleting(false);
    }
  };

  if (eventsLoading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="text-slate-400 text-sm">Loading event...</div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <button
          onClick={() => navigate(`/family/${familyId}`)}
          className="text-sm text-indigo-600 hover:underline"
        >
          ← Back to family
        </button>
        <div className="text-slate-500">Event not found.</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Back link */}
      <button
        onClick={() => navigate(`/family/${familyId}`)}
        className="text-sm text-indigo-600 hover:underline"
      >
        ← Back to family
      </button>

      {/* Event card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        {editing ? (
          <div className="space-y-3">
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Event title"
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
            />
            <input
              type="text"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              placeholder="Date (optional, e.g., June 15, 1952)"
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Description"
              rows={4}
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={!editTitle.trim() || saving}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-2 text-slate-500 font-medium hover:text-slate-700 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h1 className="text-xl font-bold text-slate-800">{event.title}</h1>
                {event.date && (
                  <p className="text-sm text-slate-400 mt-1">{event.date}</p>
                )}
              </div>
              {isAdmin && (
                <div className="flex gap-3 shrink-0">
                  <button
                    onClick={handleEditClick}
                    className="text-sm text-indigo-600 hover:underline font-medium"
                  >
                    Edit
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-sm text-rose-500 hover:underline font-medium disabled:opacity-50"
                  >
                    {deleting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              )}
            </div>

            {event.description && (
              <p className="text-sm text-slate-600 leading-relaxed">{event.description}</p>
            )}
          </>
        )}
      </div>

      {/* Storytellers */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
          Mentioned by
        </h2>
        {event.storytellerUids.length === 0 ? (
          <p className="text-sm text-slate-400">No storytellers linked yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {event.storytellerUids.map((uid) => (
              <span
                key={uid}
                className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-sm font-medium"
              >
                {memberNameByUid(uid)}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Sessions */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
          Sessions
        </h2>
        {event.sessionIds.length === 0 ? (
          <p className="text-sm text-slate-400">No sessions linked yet.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              Referenced in{' '}
              <span className="font-semibold text-slate-800">{event.sessionIds.length}</span>{' '}
              {event.sessionIds.length === 1 ? 'session' : 'sessions'}.
            </p>
            {/* View in transcript links — only for sessions with message-level references */}
            {(event.messageReferences ?? []).length > 0 && (() => {
              // Group references by sessionId
              const bySession = new Map<string, { dossierId: string; indices: number[] }>();
              for (const ref of event.messageReferences!) {
                if (!bySession.has(ref.sessionId)) {
                  bySession.set(ref.sessionId, { dossierId: ref.dossierId, indices: [] });
                }
                bySession.get(ref.sessionId)!.indices.push(ref.messageIndex);
              }
              return Array.from(bySession.entries()).map(([sid, { dossierId: did, indices }]) => (
                <Link
                  key={sid}
                  to={`/family/${familyId}/dossier/${did}/history/${sid}`}
                  state={{ highlightIndices: indices }}
                  className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline font-medium"
                >
                  View {indices.length} referenced {indices.length === 1 ? 'message' : 'messages'} in transcript →
                </Link>
              ));
            })()}
          </div>
        )}
      </section>
    </div>
  );
};
