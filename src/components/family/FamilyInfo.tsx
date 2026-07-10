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
 * FamilyInfo — hub page linking to events, misc facts, and profiles sub-sections.
 * Includes semantic + keyword search across all family content.
 *
 * Route: /family/:familyId/info
 */

import React, { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useFamily } from '../../hooks/useFamily';
import { useDossierList } from '../../hooks/useDossier';
import { FamilyNav } from './FamilyNav';
import { searchContextRaw, ContextSearchResult } from '../../services/externalSearch';

// ---------------------------------------------------------------------------
// Source label helpers
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<string, string> = {
  biography: 'Biography',
  historicalContext: 'Historical Context',
  adminNotes: 'Admin Notes',
  transcript: 'Session Transcript',
  event: 'Event',
  miscFact: 'Misc Fact',
  question: 'Story Question',
};

const SOURCE_COLORS: Record<string, string> = {
  biography: 'bg-indigo-100 text-indigo-700',
  historicalContext: 'bg-violet-100 text-violet-700',
  adminNotes: 'bg-slate-100 text-slate-600',
  transcript: 'bg-amber-100 text-amber-700',
  event: 'bg-emerald-100 text-emerald-700',
  miscFact: 'bg-sky-100 text-sky-700',
  question: 'bg-rose-100 text-rose-700',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FamilyInfo: React.FC = () => {
  const { familyId } = useParams<{ familyId: string }>();
  const navigate = useNavigate();
  const { family } = useFamily(familyId);
  const { dossiers } = useDossierList(familyId);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContextSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSearch() {
    const q = query.trim();
    if (!q || !familyId) return;
    setSearching(true);
    setSearchError(null);
    setResults(null);
    try {
      const raw = await searchContextRaw(q, 10, familyId);
      setResults(raw);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSearch();
  }

  function dossierName(dossierId: string | null): string | null {
    if (!dossierId) return null;
    const d = dossiers.find((d) => d.id === dossierId);
    return d?.storytellerName ?? null;
  }

  function dossierPath(dossierId: string | null): string | null {
    if (!dossierId || !familyId) return null;
    return `/family/${familyId}/dossier/${dossierId}`;
  }

  const sections = [
    {
      label: 'Events',
      description: 'Family milestones and historical events captured from storytelling sessions.',
      to: `/family/${familyId}/info/events`,
    },
    {
      label: 'Misc Facts',
      description: 'Individual facts and corrections captured by the AI during talk sessions.',
      to: `/family/${familyId}/info/facts`,
    },
    {
      label: 'Profiles',
      description: 'Background and historical context written for each storyteller.',
      to: `/family/${familyId}/info/profiles`,
    },
  ];

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8">
      <FamilyNav familyId={familyId!} familyName={family?.name} />

      {/* Search */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold text-slate-700">Search Family Knowledge</h2>
        <p className="text-sm text-slate-500">
          Find anything across biographies, transcripts, events, facts, and more using
          semantic + keyword search.
        </p>

        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='e.g. "What did grandpa say about the war?"'
            className="flex-1 p-3 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
          />
          <button
            onClick={handleSearch}
            disabled={!query.trim() || searching}
            className="px-5 py-3 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-sm"
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>

        {/* Results */}
        {searchError && (
          <p className="text-sm text-red-500">{searchError}</p>
        )}

        {results !== null && !searching && (
          results.length === 0 ? (
            <p className="text-sm text-slate-400 italic">No results found. Try a different phrase.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">{results.length} result{results.length !== 1 ? 's' : ''}</p>
              {results.map((r, i) => {
                const label = SOURCE_LABELS[r.source] ?? r.source;
                const color = SOURCE_COLORS[r.source] ?? 'bg-slate-100 text-slate-600';
                const name = dossierName(r.dossierId);
                const path = dossierPath(r.dossierId);

                return (
                  <div
                    key={i}
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-2"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${color}`}>
                        {label}
                      </span>
                      {name && path && (
                        <button
                          onClick={() => navigate(path)}
                          className="text-xs text-indigo-500 hover:underline"
                        >
                          {name}
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{r.text}</p>
                  </div>
                );
              })}
            </div>
          )
        )}
      </section>

      {/* Browse sections */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold text-slate-700">Browse</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {sections.map((section) => (
            <button
              key={section.to}
              onClick={() => navigate(section.to)}
              className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm text-left hover:border-indigo-300 hover:shadow-md transition-all group"
            >
              <p className="font-bold text-slate-800 group-hover:text-indigo-600 transition-colors mb-2">
                {section.label}
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">{section.description}</p>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};
