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
 * MemoirViewer — displays a generated memoir with chapters and citations.
 * Admins can generate, change status, and export to PDF.
 * Storytellers can read only.
 *
 * Generation runs server-side via the generateMemoir Cloud Function.
 * The component listens to the memoir doc in Firestore for real-time
 * status updates (generating → draft).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, collection, query, orderBy } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../services/firebase';
import { useAuth } from '../../hooks/useAuth';
import { useDossier } from '../../hooks/useDossier';
import { useCurrentRoles } from '../../hooks/useFamily';
import { Memoir } from '../../types';
import { updateMemoir, getMemoirs } from '../../services/storage';
import { exportMemoirAsPdf } from '../../services/memoirExport';

// Memoir generation runs multiple Gemini calls — allow up to 9 minutes.
// The Cloud Function itself has a 540s server-side timeout.
const generateMemoirFn = httpsCallable<
  { familyId: string; dossierId: string },
  { memoirId: string }
>(functions, 'generateMemoir', { timeout: 540_000 });

export const MemoirViewer: React.FC = () => {
  const { familyId, dossierId } = useParams<{ familyId: string; dossierId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { dossier } = useDossier(familyId, dossierId);
  const { isAdmin } = useCurrentRoles(familyId, user?.uid);

  const [memoirs, setMemoirs] = useState<Memoir[]>([]);
  const [activeMemoirId, setActiveMemoirId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [activeChapter, setActiveChapter] = useState(0);

  // Initial load of memoir list
  useEffect(() => {
    if (!familyId || !dossierId) return;
    getMemoirs(familyId, dossierId)
      .then((m) => {
        setMemoirs(m);
        if (m.length > 0) setActiveMemoirId(m[0].id ?? null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [familyId, dossierId]);

  // Real-time listener on the active memoir doc so generating → draft transition
  // is reflected without a manual refresh
  useEffect(() => {
    if (!familyId || !dossierId || !activeMemoirId) return;
    const memoirRef = doc(db, 'families', familyId, 'dossiers', dossierId, 'memoirs', activeMemoirId);
    const unsub = onSnapshot(memoirRef, (snap) => {
      if (!snap.exists()) return;
      const updated = { id: snap.id, ...snap.data() } as Memoir;
      setMemoirs((prev) => prev.map((m) => (m.id === activeMemoirId ? updated : m)));
      if (updated.status !== 'generating') {
        setGenerating(false);
      }
    });
    return unsub;
  }, [familyId, dossierId, activeMemoirId]);

  const activeMemoir = memoirs.find((m) => m.id === activeMemoirId);

  const handleGenerate = useCallback(async () => {
    if (!familyId || !dossierId || !user) return;
    setGenerating(true);
    setGenerationError(null);
    try {
      const result = await generateMemoirFn({ familyId, dossierId });
      const { memoirId } = result.data;

      // Add placeholder to list and select it; real-time listener will fill it in
      const now = new Date();
      const placeholder: Memoir = {
        id: memoirId,
        title: 'Generating memoir...',
        status: 'generating',
        generatedBy: user.uid,
        chapters: [],
        createdAt: now as any,
        updatedAt: now as any,
      };
      setMemoirs((prev) => [placeholder, ...prev]);
      setActiveMemoirId(memoirId);
      setActiveChapter(0);
    } catch (err: any) {
      console.error('[Memoir] Generation error:', err);
      setGenerationError(err?.message ?? 'Memoir generation failed. Please try again.');
      setGenerating(false);
    }
  }, [familyId, dossierId, user]);

  // Also listen for new memoirs in the collection (handles the case where another
  // admin triggered generation and this viewer is already open)
  useEffect(() => {
    if (!familyId || !dossierId) return;
    const colRef = collection(db, 'families', familyId, 'dossiers', dossierId, 'memoirs');
    const q = query(colRef, orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const updated = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Memoir);
      setMemoirs(updated);
      if (updated.length > 0 && !activeMemoirId) {
        setActiveMemoirId(updated[0].id ?? null);
      }
    });
    return unsub;
  }, [familyId, dossierId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate(`/family/${familyId}/dossier/${dossierId}`)}
            className="text-sm text-indigo-600 font-medium hover:underline mb-1"
          >
            &larr; Back to Dossier
          </button>
          <h2 className="text-2xl font-bold text-slate-800">
            {activeMemoir?.title ?? 'Memoir'}
          </h2>
          {activeMemoir && activeMemoir.status !== 'generating' && (
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-slate-400">Status:</span>
              <select
                value={activeMemoir.status}
                onChange={async (e) => {
                  if (!familyId || !dossierId || !activeMemoir.id) return;
                  const newStatus = e.target.value as Memoir['status'];
                  await updateMemoir(familyId, dossierId, activeMemoir.id, { status: newStatus });
                }}
                className={`text-sm font-semibold rounded-full px-3 py-1 border-0 cursor-pointer ${
                  activeMemoir.status === 'published' ? 'bg-green-100 text-green-700'
                    : activeMemoir.status === 'review' ? 'bg-amber-100 text-amber-700'
                    : 'bg-indigo-100 text-indigo-700'
                }`}
                disabled={!isAdmin}
              >
                <option value="draft">Draft</option>
                <option value="review">Review</option>
                <option value="published">Published</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          {activeMemoir && activeMemoir.chapters.length > 0 && (
            <button
              onClick={() => exportMemoirAsPdf(activeMemoir, dossier?.storytellerName ?? 'Storyteller')}
              className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-semibold hover:bg-slate-50 transition-colors"
            >
              Export PDF
            </button>
          )}
          {isAdmin && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors shadow-lg disabled:opacity-50"
            >
              {generating ? 'Generating...' : memoirs.length === 0 ? 'Generate Memoir' : 'Regenerate Memoir'}
            </button>
          )}
        </div>
      </div>

      {/* Version history selector */}
      {memoirs.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {memoirs.map((m) => (
            <button
              key={m.id}
              onClick={() => { setActiveMemoirId(m.id ?? null); setActiveChapter(0); }}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                m.id === activeMemoirId
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {m.status === 'generating' ? 'Generating...' : (m.createdAt as any)?.toDate?.()?.toLocaleDateString() ?? 'Draft'}
            </button>
          ))}
        </div>
      )}

      {generating && activeMemoir?.status === 'generating' && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto" />
          <p className="text-amber-700 font-medium">
            Generating memoir from interview transcripts...
          </p>
          <p className="text-sm text-amber-600">
            This may take a few minutes. You can navigate away — generation continues on the server.
          </p>
        </div>
      )}

      {generationError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-sm">
          {generationError}
        </div>
      )}

      {activeMemoir && activeMemoir.chapters.length > 0 && (
        <div className="flex gap-6">
          {/* Chapter navigation */}
          <div className="w-64 shrink-0 space-y-2">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
              Chapters
            </p>
            {activeMemoir.chapters.map((chapter, i) => (
              <button
                key={i}
                onClick={() => setActiveChapter(i)}
                className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-colors ${
                  activeChapter === i
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {chapter.title}
              </button>
            ))}
          </div>

          {/* Chapter content */}
          <div className="flex-1 bg-white rounded-3xl border border-slate-200 p-10 shadow-sm">
            <h3 className="text-2xl font-bold text-slate-800 mb-6 font-display">
              {activeMemoir.chapters[activeChapter]?.title}
            </h3>
            <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed whitespace-pre-wrap">
              {activeMemoir.chapters[activeChapter]?.content}
            </div>
            {activeMemoir.chapters[activeChapter]?.citations.length > 0 && (
              <div className="mt-8 pt-6 border-t border-slate-200">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                  Source Citations
                </p>
                <div className="space-y-2">
                  {activeMemoir.chapters[activeChapter].citations.map((c, i) => (
                    <div key={i} className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3">
                      <span className="font-medium text-slate-600">[{i + 1}]</span>{' '}
                      &ldquo;{c.quote.slice(0, 150)}...&rdquo;{' '}
                      <button
                        onClick={() => navigate(
                          `/family/${familyId}/dossier/${dossierId}/history/${c.sessionId}`
                        )}
                        className="text-indigo-600 hover:underline"
                      >
                        View session
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!activeMemoir && !generating && (
        <div className="text-center py-16 space-y-4">
          <p className="text-slate-400 text-lg">
            No memoir has been generated yet.
          </p>
          <p className="text-sm text-slate-400">
            Complete some interview sessions first, then click &ldquo;Generate Memoir&rdquo; above.
          </p>
        </div>
      )}
    </div>
  );
};
