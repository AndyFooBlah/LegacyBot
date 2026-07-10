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
 * MemoirLibrary — lists all memoirs across every dossier.
 *
 * Route: /family/:familyId/memoirs
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useFamily } from '../../hooks/useFamily';
import { useDossierList } from '../../hooks/useDossier';
import { FamilyNav } from './FamilyNav';
import { Memoir } from '../../types';

interface AnnotatedMemoir extends Memoir {
  storytellerName: string;
  dossierId: string;
}

const STATUS_LABEL: Record<string, string> = {
  generating: 'Generating',
  draft: 'Draft',
  review: 'In Review',
  published: 'Published',
};

const STATUS_COLOR: Record<string, string> = {
  generating: 'bg-slate-100 text-slate-500',
  draft: 'bg-amber-100 text-amber-700',
  review: 'bg-blue-100 text-blue-700',
  published: 'bg-emerald-100 text-emerald-700',
};

export const MemoirLibrary: React.FC = () => {
  const { familyId } = useParams<{ familyId: string }>();
  const navigate = useNavigate();
  const { family } = useFamily(familyId);
  const { dossiers, loading: dossiersLoading } = useDossierList(familyId);

  const [memoirs, setMemoirs] = useState<AnnotatedMemoir[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!familyId || dossiersLoading || dossiers.length === 0) {
      if (!dossiersLoading) setLoading(false);
      return;
    }

    const fetchMemoirs = async () => {
      setLoading(true);
      const allMemoirs: AnnotatedMemoir[] = [];

      await Promise.allSettled(
        dossiers.map(async (dossier) => {
          const memoirsRef = collection(
            db,
            'families',
            familyId,
            'dossiers',
            dossier.id!,
            'memoirs',
          );
          const q = query(memoirsRef, orderBy('createdAt', 'desc'));
          const snap = await getDocs(q);
          snap.docs.forEach((d) => {
            allMemoirs.push({
              ...(d.data() as Memoir),
              id: d.id,
              storytellerName: dossier.storytellerName,
              dossierId: dossier.id!,
            });
          });
        }),
      );

      // Sort globally by creation time descending
      allMemoirs.sort((a, b) => {
        const ta = a.createdAt?.toMillis() ?? 0;
        const tb = b.createdAt?.toMillis() ?? 0;
        return tb - ta;
      });

      setMemoirs(allMemoirs);
      setLoading(false);
    };

    void fetchMemoirs();
  }, [familyId, dossiers, dossiersLoading]);

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-6">
      <FamilyNav familyId={familyId!} familyName={family?.name} />

      <section className="space-y-4">
        <h2 className="text-lg font-bold text-slate-700">
          Memoir Library{memoirs.length > 0 && ` (${memoirs.length})`}
        </h2>

        {loading || dossiersLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
          </div>
        ) : memoirs.length === 0 ? (
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-8 text-center text-slate-400">
            No memoirs generated yet. Memoirs are created from a storyteller's dossier after enough sessions have been recorded.
          </div>
        ) : (
          <div className="space-y-3">
            {memoirs.map((memoir) => (
              <div
                key={`${memoir.dossierId}-${memoir.id}`}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-slate-800">{memoir.title}</h3>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          STATUS_COLOR[memoir.status] ?? 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {STATUS_LABEL[memoir.status] ?? memoir.status}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">{memoir.storytellerName}</p>
                    <div className="flex gap-3 mt-1 text-xs text-slate-400">
                      {memoir.chapters.length > 0 && (
                        <span>
                          {memoir.chapters.length}{' '}
                          {memoir.chapters.length === 1 ? 'chapter' : 'chapters'}
                        </span>
                      )}
                      {memoir.createdAt && (
                        <span>
                          {memoir.createdAt.toDate().toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      navigate(
                        `/family/${familyId}/dossier/${memoir.dossierId}/memoir`,
                      )
                    }
                    className="px-3 py-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors shrink-0"
                  >
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
