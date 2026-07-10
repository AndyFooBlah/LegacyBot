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
 * FamilyProfilesPage — shows the storyteller context (biography) for every dossier.
 *
 * Route: /family/:familyId/info/profiles
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useFamily } from '../../hooks/useFamily';
import { useDossierList } from '../../hooks/useDossier';
import { FamilyNav } from './FamilyNav';

export const FamilyProfilesPage: React.FC = () => {
  const { familyId } = useParams<{ familyId: string }>();
  const navigate = useNavigate();
  const { family } = useFamily(familyId);
  const { dossiers, loading: dossiersLoading } = useDossierList(familyId);

  const dossiersWithContent = dossiers.filter(
    (d) => d.storytellerContext?.trim() || d.historicalContext?.trim(),
  );

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
        <span className="text-slate-800 font-medium">Profiles</span>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-bold text-slate-700">
          Profiles{!dossiersLoading && ` (${dossiers.length})`}
        </h2>

        {dossiersLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
          </div>
        ) : dossiers.length === 0 ? (
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-8 text-center text-slate-400">
            No storytellers found.
          </div>
        ) : (
          <div className="space-y-4">
            {dossiers.map((dossier) => (
              <div
                key={dossier.id}
                className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg">{dossier.storytellerName}</h3>
                    {dossier.preferredName && dossier.preferredName !== dossier.storytellerName && (
                      <p className="text-sm text-slate-400">
                        Prefers: <span className="italic">{dossier.preferredName}</span>
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

                {dossier.storytellerContext ? (
                  <div>
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                      Background
                    </p>
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                      {dossier.storytellerContext}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 italic">No background written yet.</p>
                )}

                {dossier.historicalContext && (
                  <div>
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                      Historical Context
                    </p>
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                      {dossier.historicalContext}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
