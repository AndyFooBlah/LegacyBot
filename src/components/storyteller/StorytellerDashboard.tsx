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
 * StorytellerDashboard — landing page for storytellers.
 *
 * Shows a "Start Interview Session" button and the full session history
 * inline so the storyteller can browse past recordings/transcripts
 * without navigating away.
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../hooks/useAuth';
import { useDossierList } from '../../hooks/useDossier';
import { SessionMetadata } from '../../types';

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

interface DossierSessionsProps {
  familyId: string;
  dossierId: string;
}

/** Inline session list for one dossier. */
const DossierSessions: React.FC<DossierSessionsProps> = ({ familyId, dossierId }) => {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const colRef = collection(db, 'families', familyId, 'dossiers', dossierId, 'sessions');
    const q = query(colRef, orderBy('startTime', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSessions(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as SessionMetadata));
      setLoading(false);
    }, () => setLoading(false));
    return unsubscribe;
  }, [familyId, dossierId]);

  if (loading) {
    return <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600 mx-auto my-4" />;
  }

  if (sessions.length === 0) {
    return (
      <p className="text-center text-slate-400 py-6 text-sm">
        No sessions yet — start your first conversation above.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => (
        <div
          key={session.id}
          onClick={() => navigate(`/family/${familyId}/dossier/${dossierId}/history/${session.id}`)}
          className="bg-slate-50 hover:bg-white border border-slate-200 rounded-xl p-4 cursor-pointer transition-colors flex items-center justify-between"
        >
          <div className="space-y-0.5">
            <p className="font-medium text-slate-800 text-sm">
              {session.startTime?.toDate?.()
                ? session.startTime.toDate().toLocaleDateString(undefined, {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })
                : 'Unknown date'}
            </p>
            <p className="text-xs text-slate-400">
              {session.startTime?.toDate?.()
                ? session.startTime.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : ''}{' '}
              &middot; {formatDuration(session.durationSeconds)}
            </p>
          </div>
          <span
            className={`text-xs font-bold px-3 py-1 rounded-full uppercase ${
              session.status === 'completed'
                ? 'bg-green-100 text-green-600'
                : session.status === 'interrupted'
                  ? 'bg-amber-100 text-amber-600'
                  : 'bg-blue-100 text-blue-600'
            }`}
          >
            {session.status}
          </span>
        </div>
      ))}
    </div>
  );
};

export const StorytellerDashboard: React.FC = () => {
  const { familyId: rawFamilyId } = useParams<{ familyId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { dossiers, loading } = useDossierList(rawFamilyId, user?.uid);

  if (!rawFamilyId) return null;
  // Re-bind as a separate const so TypeScript knows the type is string (not string|undefined)
  // even inside closures (onClick lambdas, .map callbacks) that capture this variable.
  const familyId: string = rawFamilyId;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (dossiers.length === 0) {
    return (
      <div className="max-w-md mx-auto p-8 mt-20 text-center space-y-4">
        <h2 className="text-2xl font-bold text-slate-800">Welcome!</h2>
        <p className="text-slate-400">
          Your family admin hasn&apos;t set things up for you yet.
          Check back soon!
        </p>
      </div>
    );
  }

  const dossier = dossiers[0];

  return (
    <div className="max-w-lg mx-auto p-8 mt-8 space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold text-slate-800 tracking-tight">
          Welcome, {dossier.storytellerName}
        </h2>
        <p className="text-slate-400">Ready to share more of your story?</p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={() => navigate(`/family/${familyId}/dossier/${dossier.id}/session`)}
          className="w-full py-5 bg-green-500 text-white rounded-2xl font-bold text-lg hover:bg-green-600 transition-colors shadow-lg flex items-center justify-center gap-3"
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
          </svg>
          Start a Conversation
        </button>
      </div>

      {/* Inline session history */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
          Past Sessions
        </h3>
        <DossierSessions familyId={familyId} dossierId={dossier.id!} />
      </div>

      {/* Additional dossiers if the storyteller has more than one */}
      {dossiers.length > 1 && (
        <div className="space-y-4">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Other Profiles
          </p>
          {dossiers.slice(1).map((d) => (
            <div key={d.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
              <h3 className="font-semibold text-slate-800">{d.storytellerName}</h3>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => navigate(`/family/${familyId}/dossier/${d.id}/session`)}
                  className="w-full py-3 bg-green-500 text-white rounded-xl font-semibold hover:bg-green-600 transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
                  </svg>
                  Start a Conversation
                </button>
              </div>
              <DossierSessions familyId={familyId} dossierId={d.id!} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
