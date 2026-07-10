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
 * Diagnostics page (`/diagnostics`).
 *
 * Hosts the SystemDiagnostics component on a page of its own, with a header
 * and a brief explanation. Mirrors the layout pattern CarBot uses so the two
 * apps feel consistent. The probes themselves (Wikipedia, Jokes, Maps,
 * Weather, Gemini Live, Firestore) are unchanged — this is just a relocation
 * from being rendered inline at the bottom of FamilySelector / FamilyPage /
 * FamilyDashboard.
 */

import React from 'react';
import { useAuth } from '../../hooks/useAuth';
import { SystemDiagnostics } from '../shared/SystemDiagnostics';

export const DiagnosticsPage: React.FC = () => {
  const { user } = useAuth();
  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 font-display">Diagnostics</h1>
        <p className="text-sm text-slate-500 mt-1">
          Live latency probes against every external service the app uses. A green
          probe means that service is reachable from this browser right now; an
          orange or red probe usually points at a slow upstream or a network issue.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <SystemDiagnostics uid={user?.uid} />
      </div>
    </div>
  );
};
