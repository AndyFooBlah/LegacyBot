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
 * QuestionDashboard — cross-session view of Story Queue progress.
 *
 * Shows the Archivist a summary of all questions in the Dossier with
 * their current status and accumulated findings. Includes a visual
 * progress bar showing how many topics have been fully explored.
 *
 * This component is embedded in the DossierEditor and also linked
 * from the session history page.
 *
 * References: product_requirements.md §3.6 | GitHub Issue #16
 */

import React from 'react';
import { InterviewQuestion } from '../../types';

interface QuestionDashboardProps {
  questions: InterviewQuestion[];
}

export const QuestionDashboard: React.FC<QuestionDashboardProps> = ({
  questions,
}) => {
  const total = questions.length;
  const completed = questions.filter((q) => q.status === 'Completed').length;
  const inProgress = questions.filter((q) => q.status === 'InProgress').length;
  const unasked = questions.filter((q) => q.status === 'Unasked').length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (total === 0) {
    return (
      <div className="text-sm text-slate-400 italic text-center py-4">
        No questions in the Story Queue yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Progress summary */}
      <div className="flex items-center gap-4">
        <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
          <div
            className="bg-indigo-600 h-full rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="text-sm font-semibold text-slate-600 whitespace-nowrap">
          {completed}/{total} completed
        </span>
      </div>

      {/* Status counts */}
      <div className="flex gap-3 text-xs">
        <span className="bg-green-100 text-green-600 font-bold px-2 py-1 rounded-md">
          {completed} Completed
        </span>
        <span className="bg-amber-100 text-amber-600 font-bold px-2 py-1 rounded-md">
          {inProgress} In Progress
        </span>
        <span className="bg-slate-100 text-slate-500 font-bold px-2 py-1 rounded-md">
          {unasked} Unasked
        </span>
      </div>

      {/* Questions with findings */}
      <div className="space-y-3">
        {questions.map((q) => (
          <div
            key={q.id}
            className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2"
          >
            <div className="flex items-start gap-2">
              <span
                className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase mt-0.5 shrink-0 ${
                  q.status === 'Completed'
                    ? 'bg-green-100 text-green-600'
                    : q.status === 'InProgress'
                      ? 'bg-amber-100 text-amber-600'
                      : 'bg-slate-200 text-slate-500'
                }`}
              >
                {q.status}
              </span>
              <p className="text-sm text-slate-700">{q.text || '(empty question)'}</p>
            </div>
            {q.findings && (
              <p className="text-xs text-indigo-600 italic pl-1">
                {q.findings}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
