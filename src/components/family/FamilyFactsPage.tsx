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
 * FamilyFactsPage — displays all misc facts captured across every dossier.
 *
 * Route: /family/:familyId/info/facts
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useFamily } from '../../hooks/useFamily';
import { useDossierList } from '../../hooks/useDossier';
import { FamilyNav } from './FamilyNav';
import { MiscFact } from '../../types';

interface AnnotatedFact extends MiscFact {
  storytellerName: string;
  dossierId: string;
}

export const FamilyFactsPage: React.FC = () => {
  const { familyId } = useParams<{ familyId: string }>();
  const navigate = useNavigate();
  const { family } = useFamily(familyId);
  const { dossiers, loading: dossiersLoading } = useDossierList(familyId);

  const [facts, setFacts] = useState<AnnotatedFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!familyId || dossiersLoading || dossiers.length === 0) {
      if (!dossiersLoading) setLoading(false);
      return;
    }

    const fetchFacts = async () => {
      setLoading(true);
      const allFacts: AnnotatedFact[] = [];

      await Promise.allSettled(
        dossiers.map(async (dossier) => {
          const factsRef = collection(
            db,
            'families',
            familyId,
            'dossiers',
            dossier.id!,
            'miscFacts',
          );
          const q = query(factsRef, orderBy('createdAt', 'desc'));
          const snap = await getDocs(q);
          snap.docs.forEach((d) => {
            allFacts.push({
              ...(d.data() as MiscFact),
              id: d.id,
              storytellerName: dossier.storytellerName,
              dossierId: dossier.id!,
            });
          });
        }),
      );

      // Sort globally by creation time descending
      allFacts.sort((a, b) => {
        const ta = a.createdAt?.toMillis() ?? 0;
        const tb = b.createdAt?.toMillis() ?? 0;
        return tb - ta;
      });

      setFacts(allFacts);
      setLoading(false);
    };

    void fetchFacts();
  }, [familyId, dossiers, dossiersLoading]);

  const filtered = filter.trim()
    ? facts.filter(
        (f) =>
          f.text.toLowerCase().includes(filter.toLowerCase()) ||
          f.storytellerName.toLowerCase().includes(filter.toLowerCase()),
      )
    : facts;

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
        <span className="text-slate-800 font-medium">Misc Facts</span>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-700">
            Misc Facts{facts.length > 0 && ` (${facts.length})`}
          </h2>
        </div>

        {/* Filter */}
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter facts…"
          className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500"
        />

        {loading || dossiersLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-8 text-center text-slate-400">
            {filter ? 'No facts match your filter.' : 'No facts captured yet.'}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((fact) => (
              <div
                key={`${fact.dossierId}-${fact.id}`}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-2"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    {fact.isCorrection && (
                      <span className="inline-block text-[10px] font-bold px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full uppercase tracking-wider mb-2">
                        Correction
                      </span>
                    )}
                    <p className="text-sm text-slate-800">{fact.text}</p>
                    {fact.correctionNote && (
                      <p className="text-xs text-amber-700 mt-1 italic">{fact.correctionNote}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-slate-500 font-medium">
                      {fact.speakerLabel ? `${fact.storytellerName} · ${fact.speakerLabel}` : fact.storytellerName}
                    </p>
                    {fact.createdAt && (
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {fact.createdAt.toDate().toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                    )}
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
