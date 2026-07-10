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
 * EventsTimeline — interactive timeline visualization of a storyteller's life events.
 * Shows events chronologically with decade markers, theme/people filtering,
 * gap detection for unexplored periods, and source links.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { StoryEvent } from '../../types';
import { getEvents } from '../../services/storage';

/** Extract a rough year from a fuzzy date string. */
function extractYear(date: string | null): number | null {
  if (!date) return null;
  const match = date.match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

/** Get decade label from year. */
function getDecade(year: number): string {
  const d = Math.floor(year / 10) * 10;
  return `${d}s`;
}

export const EventsTimeline: React.FC = () => {
  const { familyId, dossierId } = useParams<{ familyId: string; dossierId: string }>();
  const navigate = useNavigate();
  const [events, setEvents] = useState<StoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTheme, setFilterTheme] = useState<string | null>(null);
  const [filterPerson, setFilterPerson] = useState<string | null>(null);

  useEffect(() => {
    if (!familyId || !dossierId) return;
    getEvents(familyId, dossierId)
      .then((evts) => {
        evts.sort((a, b) => {
          if (!a.date && !b.date) return 0;
          if (!a.date) return 1;
          if (!b.date) return -1;
          return a.date.localeCompare(b.date);
        });
        setEvents(evts);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [familyId, dossierId]);

  const allThemes = useMemo(() => [...new Set(events.flatMap((e) => e.themes))].sort(), [events]);
  const allPeople = useMemo(() => [...new Set(events.flatMap((e) => e.people))].sort(), [events]);

  const filteredEvents = useMemo(() => {
    let result = events;
    if (filterTheme) result = result.filter((e) => e.themes.includes(filterTheme));
    if (filterPerson) result = result.filter((e) => e.people.includes(filterPerson));
    return result;
  }, [events, filterTheme, filterPerson]);

  // Group events by decade
  const groupedByDecade = useMemo(() => {
    const groups: { decade: string; events: StoryEvent[] }[] = [];
    let currentDecade = '';
    const dated = filteredEvents.filter((e) => extractYear(e.date) !== null);
    const undated = filteredEvents.filter((e) => extractYear(e.date) === null);

    for (const event of dated) {
      const year = extractYear(event.date)!;
      const decade = getDecade(year);
      if (decade !== currentDecade) {
        groups.push({ decade, events: [] });
        currentDecade = decade;
      }
      groups[groups.length - 1].events.push(event);
    }

    if (undated.length > 0) {
      groups.push({ decade: 'Undated', events: undated });
    }
    return groups;
  }, [filteredEvents]);

  // Detect decade gaps
  const gaps = useMemo(() => {
    const decades = groupedByDecade
      .filter((g) => g.decade !== 'Undated')
      .map((g) => parseInt(g.decade));
    const result: string[] = [];
    for (let i = 1; i < decades.length; i++) {
      const diff = decades[i] - decades[i - 1];
      if (diff > 10) {
        for (let d = decades[i - 1] + 10; d < decades[i]; d += 10) {
          result.push(`${d}s`);
        }
      }
    }
    return result;
  }, [groupedByDecade]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-6">
      <div>
        <button
          onClick={() => navigate(`/family/${familyId}/dossier/${dossierId}`)}
          className="text-sm text-indigo-600 font-medium hover:underline mb-1"
        >
          &larr; Back to Dossier
        </button>
        <h2 className="text-2xl font-bold text-slate-800">Life Events Timeline</h2>
        <p className="text-sm text-slate-400 mt-1">
          {events.length} event{events.length !== 1 ? 's' : ''} extracted from interview sessions
        </p>
      </div>

      {/* Filters */}
      {(allThemes.length > 0 || allPeople.length > 0) && (
        <div className="space-y-2">
          {/* Theme filters */}
          {allThemes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-slate-400 font-medium py-1">Themes:</span>
              <button
                onClick={() => setFilterTheme(null)}
                className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                  !filterTheme ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All
              </button>
              {allThemes.map((theme) => (
                <button
                  key={theme}
                  onClick={() => setFilterTheme(theme === filterTheme ? null : theme)}
                  className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                    filterTheme === theme ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                  }`}
                >
                  {theme}
                </button>
              ))}
            </div>
          )}
          {/* People filters */}
          {allPeople.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-slate-400 font-medium py-1">People:</span>
              {allPeople.map((person) => (
                <button
                  key={person}
                  onClick={() => setFilterPerson(person === filterPerson ? null : person)}
                  className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                    filterPerson === person ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                  }`}
                >
                  {person}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Gap warnings */}
      {gaps.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-700">
            <span className="font-semibold">Unexplored periods:</span>{' '}
            {gaps.join(', ')}. Consider asking about these decades in the next interview.
          </p>
        </div>
      )}

      {filteredEvents.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <p className="text-slate-400 text-lg">
            {events.length === 0
              ? 'No events extracted yet. Complete a session to generate events.'
              : 'No events match the selected filters.'}
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200" />

          <div className="space-y-4">
            {groupedByDecade.map((group) => (
              <div key={group.decade}>
                {/* Decade marker */}
                <div className="relative pl-12 mb-4">
                  <div className="absolute left-1 top-1 w-7 h-7 bg-slate-800 rounded-full flex items-center justify-center">
                    <span className="text-[9px] font-bold text-white">{group.decade.slice(0, 4)}</span>
                  </div>
                </div>

                <div className="space-y-4">
                  {group.events.map((event) => (
                    <div key={event.id} className="relative pl-12">
                      <div className="absolute left-2.5 top-2 w-3 h-3 bg-indigo-600 rounded-full border-2 border-white" />

                      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3 hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-semibold text-slate-800">{event.title}</h3>
                          {event.date && (
                            <span className="text-xs font-medium text-slate-400 whitespace-nowrap bg-slate-50 px-2 py-0.5 rounded">
                              {event.date}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-600 leading-relaxed">{event.description}</p>

                        <div className="flex flex-wrap gap-1.5">
                          {event.themes.map((theme) => (
                            <span key={theme} className="text-[10px] font-medium bg-indigo-50 text-indigo-600 rounded-full px-2 py-0.5">
                              {theme}
                            </span>
                          ))}
                          {event.people.map((person) => (
                            <span key={person} className="text-[10px] font-medium bg-emerald-50 text-emerald-600 rounded-full px-2 py-0.5">
                              {person}
                            </span>
                          ))}
                          {event.location && (
                            <span className="text-[10px] font-medium bg-amber-50 text-amber-600 rounded-full px-2 py-0.5">
                              {event.location}
                            </span>
                          )}
                        </div>

                        {/* Source session links */}
                        {event.sources?.length > 0 && (
                          <div className="flex gap-2 pt-1">
                            {event.sources.map((src, i) => (
                              <button
                                key={i}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/family/${familyId}/dossier/${dossierId}/history/${src.sessionId}`);
                                }}
                                className="text-[10px] text-indigo-600 hover:underline"
                              >
                                View source session
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
