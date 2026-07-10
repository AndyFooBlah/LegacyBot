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
 * FamilyEventsPage — create, edit, and browse family-level events.
 *
 * Route: /family/:familyId/info/events
 */

import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useFamily } from '../../hooks/useFamily';
import { useFamilyMembers } from '../../hooks/useFamily';
import { useFamilyEvents, createEvent, updateEvent, deleteEvent } from '../../hooks/useEvents';
import { FamilyNav } from './FamilyNav';

export const FamilyEventsPage: React.FC = () => {
  const { familyId } = useParams<{ familyId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { family } = useFamily(familyId);
  const { members } = useFamilyMembers(familyId);
  const { events, loading: eventsLoading } = useFamilyEvents(familyId);

  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [savingEvent, setSavingEvent] = useState(false);

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
      alert(err.message || 'Failed to delete event');
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-6">
      <FamilyNav familyId={familyId!} familyName={family?.name} />

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm text-slate-500">
        <button
          onClick={() => navigate(`/family/${familyId}/info`)}
          className="hover:text-indigo-600 hover:underline"
        >
          Family Info
        </button>
        <span>/</span>
        <span className="text-slate-800 font-medium">Events</span>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-700">Family Events</h2>
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
                autoFocus
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
                {savingEvent ? 'Saving…' : editingEventId ? 'Update Event' : 'Create Event'}
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

        {eventsLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
          </div>
        ) : events.length === 0 ? (
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-8 text-center text-slate-400">
            No events yet. Add important family milestones and events to the timeline.
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
                            {event.sessionIds.length}{' '}
                            {event.sessionIds.length === 1 ? 'session' : 'sessions'}
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
