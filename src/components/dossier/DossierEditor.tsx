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
 * DossierEditor — the Archivist's master console for configuring a Storyteller.
 *
 * This is the full-page editor for a single Dossier. It combines:
 *   - StorytellerProfile (name + context)
 *   - Voice & Personality selection
 *   - Story Queue (question management with status badges)
 *   - Historical Context (free text)
 *   - Navigation to start a session or view session history
 *
 * All changes are saved to Firestore via the useDossier hook (debounced).
 * The Story Queue supports adding, removing, editing text, and manual
 * status override (Archivist can reset Completed → Unasked to revisit topics).
 *
 * Note: Family Tree management has been moved to FamilyPage (Phase 1).
 *
 * References: design.md §4 | GitHub Issues #4, #5, #6, #7, #60
 */

import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useCurrentRoles, useFamily } from '../../hooks/useFamily';
import { useDossier } from '../../hooks/useDossier';
import { useFamilyInvitations } from '../../hooks/useInvitations';
import { StorytellerProfile } from './StorytellerProfile';
import { uploadPromptPhoto, getPromptPhotos, deletePromptPhoto, getMiscFacts } from '../../services/storage';
import { PersonalityMode, VoicePreset, PromptPhoto, MiscFact } from '../../types';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { MediaImage } from '../shared/ResolvedMedia';

export const DossierEditor: React.FC = () => {
  const { familyId, dossierId } = useParams<{ familyId: string; dossierId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, loading: rolesLoading } = useCurrentRoles(familyId, user?.uid);
  const { family, loading: familyLoading } = useFamily(familyId);
  const { createInvite } = useFamilyInvitations(familyId);
  const {
    dossier,
    questions,
    loading,
    updateDossier,
    addQuestion,
    removeQuestion,
    updateQuestion,
  } = useDossier(familyId, dossierId);

  // Invite storyteller state — pre-populate from dossier.inviteEmail if set
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (dossier?.inviteEmail && !inviteEmail) {
      setInviteEmail(dossier.inviteEmail);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossier?.inviteEmail]);

  // Nudge email state
  const [sendingNudge, setSendingNudge] = useState(false);
  const [nudgeResult, setNudgeResult] = useState<'sent' | 'error' | null>(null);

  // Prompt photos state
  const [promptPhotos, setPromptPhotos] = useState<PromptPhoto[]>([]);
  const [promptPhotoCaption, setPromptPhotoCaption] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const promptPhotoFileRef = useRef<HTMLInputElement>(null);

  // Misc facts state (from "Talk About My Family" conversations)
  const [miscFacts, setMiscFacts] = useState<MiscFact[]>([]);

  useEffect(() => {
    if (!familyId || !dossierId) return;
    getPromptPhotos(familyId, dossierId).then(setPromptPhotos).catch(console.error);
    getMiscFacts(familyId, dossierId).then(setMiscFacts).catch(console.error);
  }, [familyId, dossierId]);

  async function handleInviteStoryteller() {
    if (!familyId || !dossierId || !inviteEmail.trim() || !user) return;
    setInviting(true);
    try {
      const inviteId = await createInvite(inviteEmail.trim(), ['storyteller'], [dossierId], user.uid);
      const link = `${window.location.origin}/invite?token=${inviteId}&email=${encodeURIComponent(inviteEmail.trim())}`;
      setInviteLink(link);
    } catch (err: any) {
      console.error('[DossierEditor] Invite error:', err);
      alert(err.message || 'Failed to create invitation');
    } finally {
      setInviting(false);
    }
  }

  async function handleSendNudge() {
    if (!familyId || !dossierId) return;
    setSendingNudge(true);
    setNudgeResult(null);
    try {
      const fn = httpsCallable(getFunctions(), 'triggerDigestForDossier');
      await fn({ familyId, dossierId });
      setNudgeResult('sent');
    } catch {
      setNudgeResult('error');
    } finally {
      setSendingNudge(false);
      setTimeout(() => setNudgeResult(null), 4000);
    }
  }

  if (loading || rolesLoading || familyLoading || !dossier) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto p-8 mt-20 text-center space-y-4">
        <h2 className="text-xl font-bold text-slate-800">Access Denied</h2>
        <p className="text-slate-400">Only admins can view the dossier editor.</p>
        <button
          onClick={() => navigate(`/family/${familyId}`)}
          className="text-indigo-600 font-semibold hover:underline"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-8">
      {/* Header with navigation */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate(`/family/${familyId}`)}
            className="text-sm text-indigo-600 font-medium hover:underline mb-1"
          >
            &larr; All Storytellers
          </button>
          <h2 className="text-2xl font-bold text-slate-800">
            {dossier.storytellerName || 'New Storyteller'}
          </h2>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate(`/family/${familyId}/dossier/${dossierId}/memoir`)}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors"
          >
            Memoir
          </button>
          <button
            onClick={() => navigate(`/family/${familyId}/dossier/${dossierId}/events`)}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors"
          >
            Events
          </button>
          <button
            onClick={() => navigate(`/family/${familyId}/dossier/${dossierId}/media`)}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors"
          >
            Photos
          </button>
          <button
            onClick={() => navigate(`/family/${familyId}/dossier/${dossierId}/history`)}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors"
          >
            Session History
          </button>
          <button
            onClick={() => navigate(`/family/${familyId}/dossier/${dossierId}/session`)}
            disabled={!dossier.storytellerName.trim()}
            className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-lg disabled:opacity-50"
          >
            Start Session
          </button>
        </div>
      </div>

      {/* Invite storyteller — shown when dossier has no linked user */}
      {!dossier.storytellerUid && (
        inviteLink ? (
          <div className="bg-green-50 rounded-2xl border border-green-200 p-6 space-y-3">
            <p className="font-semibold text-green-700">
              Invite link for {dossier.storytellerName}:
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={inviteLink}
                className="flex-1 p-3 bg-white border border-green-200 rounded-xl text-sm text-slate-700 select-all"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                onClick={() => navigator.clipboard.writeText(inviteLink)}
                className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-colors"
              >
                Copy
              </button>
            </div>
            <p className="text-xs text-green-600">
              Send this link to {inviteEmail} so they can create an account and start recording.
            </p>
            <button
              onClick={() => { setInviteLink(null); setInviteEmail(''); }}
              className="text-sm text-green-600 font-medium hover:underline"
            >
              Dismiss
            </button>
          </div>
        ) : (
          <div className="bg-amber-50 rounded-2xl border border-amber-200 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <p className="font-semibold text-amber-700 text-sm">
                No storyteller linked — invite someone to record as {dossier.storytellerName}
              </p>
            </div>
            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="storyteller@email.com"
                className="flex-1 p-2.5 bg-white border border-amber-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-400"
                onKeyDown={(e) => e.key === 'Enter' && handleInviteStoryteller()}
              />
              <button
                onClick={handleInviteStoryteller}
                disabled={!inviteEmail.trim() || inviting}
                className="px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50"
              >
                {inviting ? 'Sending...' : 'Send Invite'}
              </button>
            </div>
          </div>
        )
      )}

      {/* Main editor content */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 space-y-8">
        {/* Storyteller Profile */}
        <StorytellerProfile dossier={dossier} onChange={updateDossier} />

        <hr className="border-slate-100" />

        {/* Interviewer Notes (admin instructions for the AI) */}
        <section className="space-y-2">
          <h3 className="font-bold text-slate-700 flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Interviewer Notes
          </h3>
          <p className="text-xs text-slate-400">
            Special instructions for the AI interviewer. These are not visible to the storyteller.
          </p>
          <textarea
            value={dossier.interviewerNotes ?? ''}
            onChange={(e) => updateDossier({ interviewerNotes: e.target.value })}
            placeholder="e.g. &quot;Grandma is hard of hearing - speak slowly.&quot; or &quot;Avoid asking about Uncle Joe.&quot; or &quot;Focus on immigration stories.&quot;"
            rows={3}
            className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
          />
        </section>

        <hr className="border-slate-100" />

        {/* Voice & Personality */}
        <section className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Interview Voice
            </label>
            <select
              value={dossier.selectedVoice}
              onChange={(e) => updateDossier({ selectedVoice: e.target.value as VoicePreset })}
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm"
            >
              <option value="Kore">Kore (Warm)</option>
              <option value="Zephyr">Zephyr (Bright)</option>
              <option value="Puck">Puck (Friendly)</option>
              <option value="Charon">Charon (Deep)</option>
              <option value="Fenrir">Fenrir (Steady)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Interviewer Style
            </label>
            <select
              value={dossier.personality}
              onChange={(e) => updateDossier({ personality: e.target.value as PersonalityMode })}
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm"
            >
              <option value="empathetic">Empathetic Biographer</option>
              <option value="investigative">Oral Historian</option>
              <option value="casual">Close Grandchild</option>
            </select>
          </div>
        </section>

        <hr className="border-slate-100" />

        {/* Response patience — how long the interviewer waits before stepping in */}
        <section className="space-y-1">
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Response Patience
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0.5}
              max={5}
              step={0.5}
              value={dossier.responseWaitSeconds ?? 1.5}
              onChange={(e) => updateDossier({ responseWaitSeconds: parseFloat(e.target.value) })}
              className="flex-1 accent-slate-600"
            />
            <span className="w-14 text-right text-sm font-medium text-slate-700 tabular-nums">
              {(dossier.responseWaitSeconds ?? 1.5).toFixed(1)}s
            </span>
          </div>
          <p className="text-xs text-slate-400">
            How long the interviewer waits after the storyteller pauses before stepping in.
            Higher is more patient — good for storytellers who take their time.
          </p>
        </section>

        <hr className="border-slate-100" />

        {/* Story Queue */}
        <section className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-slate-700">Story Queue</h3>
            <button
              onClick={() => addQuestion('')}
              className="bg-indigo-600 text-white p-1.5 rounded-full hover:bg-indigo-700 shadow-sm"
              title="Add question"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            {questions.length === 0 && (
              <p className="text-sm text-slate-400 italic text-center py-4">
                No questions yet. Add topics you want to explore with {dossier.storytellerName}.
              </p>
            )}
            {questions.map((q) => (
              <div
                key={q.id}
                className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3 relative group"
              >
                {/* Remove button */}
                <button
                  onClick={() => {
                    if (!window.confirm(`Remove question "${q.text}"?`)) return;
                    removeQuestion(q.id!);
                  }}
                  className="absolute top-2 right-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove question"
                >
                  &times;
                </button>

                {/* Status badge + manual override */}
                <div className="flex gap-2 items-center">
                  <span
                    className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${
                      q.status === 'Completed'
                        ? 'bg-green-100 text-green-600'
                        : q.status === 'InProgress'
                          ? 'bg-amber-100 text-amber-600'
                          : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    {q.status}
                  </span>
                  <select
                    value={q.status}
                    onChange={(e) => updateQuestion(q.id!, { status: e.target.value as any })}
                    className="bg-transparent text-[9px] text-slate-400 font-bold border-none p-0 outline-none"
                  >
                    <option value="Unasked">Reset to Unasked</option>
                    <option value="InProgress">Mark In Progress</option>
                    <option value="Completed">Mark Completed</option>
                  </select>
                </div>

                {/* Question text */}
                <textarea
                  className="w-full bg-white p-2 border border-slate-200 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="Story prompt (e.g. Tell me about your first job...)"
                  rows={2}
                  value={q.text}
                  onChange={(e) => updateQuestion(q.id!, { text: e.target.value })}
                />

                {/* AI-generated findings */}
                {q.findings && (
                  <div className="bg-indigo-50/50 p-2 rounded-lg border border-indigo-100/50">
                    <p className="text-[10px] text-indigo-700 italic">
                      Finding: {q.findings}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <hr className="border-slate-100" />

        {/* Prompt Photos */}
        <section className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-slate-700 flex items-center gap-2">
              <svg className="w-5 h-5 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Prompt Photos
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            Upload photos for the interviewer to show {dossier.storytellerName} during sessions. Add a caption or question to guide the conversation.
          </p>

          {/* Upload form */}
          <div className="bg-violet-50 rounded-2xl border border-violet-200 p-4 space-y-3">
            <input
              ref={promptPhotoFileRef}
              type="file"
              accept="image/*"
              className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-violet-100 file:text-violet-700 hover:file:bg-violet-200"
            />
            <input
              type="text"
              value={promptPhotoCaption}
              onChange={(e) => setPromptPhotoCaption(e.target.value)}
              placeholder="Caption or question (e.g. 'Who is this? Tell me about this day.')"
              className="w-full px-3 py-2 border border-violet-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <button
              onClick={async () => {
                const file = promptPhotoFileRef.current?.files?.[0];
                if (!file || !promptPhotoCaption.trim() || !familyId || !dossierId || !user) return;
                setUploadingPhoto(true);
                try {
                  await uploadPromptPhoto(familyId, dossierId, file, promptPhotoCaption.trim(), user.uid);
                  setPromptPhotoCaption('');
                  if (promptPhotoFileRef.current) promptPhotoFileRef.current.value = '';
                  const updated = await getPromptPhotos(familyId, dossierId);
                  setPromptPhotos(updated);
                } catch (err) {
                  console.error('[DossierEditor] Prompt photo upload error:', err);
                  alert('Failed to upload photo');
                } finally {
                  setUploadingPhoto(false);
                }
              }}
              disabled={uploadingPhoto}
              className="px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50"
            >
              {uploadingPhoto ? 'Uploading...' : 'Upload Photo'}
            </button>
          </div>

          {/* Photo list */}
          {promptPhotos.length > 0 && (
            <div className="grid grid-cols-1 gap-3">
              {promptPhotos.map((photo) => (
                <div key={photo.id} className="flex gap-3 items-start bg-slate-50 rounded-xl border border-slate-100 p-3 group">
                  <MediaImage
                    src={photo.storageUrl}
                    alt={photo.caption}
                    className="w-20 h-20 object-cover rounded-lg shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700">{photo.caption}</p>
                  </div>
                  <button
                    onClick={async () => {
                      if (!familyId || !dossierId || !photo.id) return;
                      if (!window.confirm(`Remove photo "${photo.caption}"?`)) return;
                      await deletePromptPhoto(familyId, dossierId, photo.id);
                      setPromptPhotos((prev) => prev.filter((p) => p.id !== photo.id));
                    }}
                    className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-lg shrink-0"
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <hr className="border-slate-100" />

        {/* Historical Context */}
        <section className="space-y-2">
          <h3 className="font-bold text-slate-700">Historical Context</h3>
          <textarea
            value={dossier.historicalContext}
            onChange={(e) => updateDossier({ historicalContext: e.target.value })}
            placeholder="General background (e.g. 'Grew up in coastal Maine during the post-war era')"
            rows={3}
            className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
          />
        </section>

        {/* Miscellaneous Facts — captured during Talk conversations */}
        <section className="space-y-3 pt-2 border-t border-slate-100">
          <div>
            <h3 className="font-bold text-slate-700">Additional Notes</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Facts and corrections captured during "Talk About My Family" conversations.
            </p>
          </div>
          {miscFacts.length === 0 ? (
            <p className="text-xs text-slate-400 italic">
              No notes yet — these appear after Talk conversations.
            </p>
          ) : (
            <ul className="space-y-2">
              {miscFacts.map((fact) => (
                <li key={fact.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                  <div className="flex items-start gap-2">
                    {fact.isCorrection && (
                      <span className="shrink-0 mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase tracking-wide">
                        Correction
                      </span>
                    )}
                    <p className="text-sm text-slate-700">{fact.text}</p>
                  </div>
                  {fact.correctionNote && (
                    <p className="text-xs text-slate-400 italic pl-1">{fact.correctionNote}</p>
                  )}
                  <p className="text-[10px] text-slate-300">
                    {fact.createdAt?.toDate?.()?.toLocaleDateString(undefined, {
                      year: 'numeric', month: 'short', day: 'numeric',
                    }) ?? ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Nudge email — manual re-engagement trigger for admins */}
        <section className="space-y-2 pt-2 border-t border-slate-100">
            <h3 className="font-bold text-slate-700">Re-engagement</h3>
            <p className="text-xs text-slate-500">
              Send {dossier.preferredName ?? dossier.storytellerName} an email previewing upcoming
              topics to encourage their next recording session.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSendNudge}
                disabled={sendingNudge}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {sendingNudge ? 'Sending…' : 'Send nudge email'}
              </button>
              {nudgeResult === 'sent' && (
                <span className="text-sm text-emerald-600 font-medium">Email sent!</span>
              )}
              {nudgeResult === 'error' && (
                <span className="text-sm text-rose-600 font-medium">
                  Could not send — storyteller may have no email or no upcoming topics.
                </span>
              )}
            </div>
          </section>
      </div>
    </div>
  );
};
