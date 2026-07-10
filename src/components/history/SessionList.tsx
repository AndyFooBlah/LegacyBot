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
 * SessionList — browse past recording sessions for a Storyteller.
 * Displays all sessions for a given Dossier, sorted newest-first.
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../hooks/useAuth';
import { useCurrentRoles } from '../../hooks/useFamily';
import { SessionMetadata } from '../../types';

export const SessionList: React.FC = () => {
  const { familyId, dossierId } = useParams<{ familyId: string; dossierId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useCurrentRoles(familyId, user?.uid);
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!familyId || !dossierId) return;

    const colRef = collection(
      db,
      'families',
      familyId,
      'dossiers',
      dossierId,
      'sessions',
    );
    const q = query(colRef, orderBy('startTime', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((doc) => ({
          ...doc.data(),
          id: doc.id,
        })) as SessionMetadata[];
        setSessions(items);
        setLoading(false);
      },
      (err) => {
        console.error('SessionList snapshot error:', err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [familyId, dossierId]);

  function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  }

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
          onClick={() => navigate(isAdmin ? `/family/${familyId}/dossier/${dossierId}` : `/family/${familyId}`)}
          className="text-sm text-indigo-600 font-medium hover:underline mb-1"
        >
          &larr; {isAdmin ? 'Back to Dossier' : 'Back to Home'}
        </button>
        <h2 className="text-2xl font-bold text-slate-800">Session History</h2>
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <p className="text-slate-400 text-lg">No sessions recorded yet.</p>
          <button
            onClick={() => navigate(`/family/${familyId}/dossier/${dossierId}/session`)}
            className="text-indigo-600 font-semibold hover:underline"
          >
            Start the first session &rarr;
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() =>
                navigate(`/family/${familyId}/dossier/${dossierId}/history/${session.id}`)
              }
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer flex items-center justify-between"
            >
              <div className="space-y-1">
                <p className="font-semibold text-slate-800">
                  {session.startTime?.toDate?.()
                    ? session.startTime.toDate().toLocaleDateString(undefined, {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })
                    : 'Unknown date'}
                </p>
                <p className="text-sm text-slate-400">
                  {session.startTime?.toDate?.()
                    ? session.startTime.toDate().toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
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
      )}
    </div>
  );
};
