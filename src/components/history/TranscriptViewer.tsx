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
 * TranscriptViewer — read-only view of a past session's transcript.
 * Loads the transcript from Firestore and displays it as a conversation
 * with speaker labels (Storyteller vs Bot) and timestamps.
 *
 * Phase 5: Per-message inline editing with full edit history.
 * Both admins and storytellers can edit storyteller messages.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../hooks/useAuth';
import { useCurrentRoles } from '../../hooks/useFamily';
import { TranscriptEntry, TranscriptEditHistoryEntry, SessionMetadata, SessionEngagement, SuggestedQuestion, AudioClip } from '../../types';
import { AudioPlayer } from './AudioPlayer';
import { MediaAudio } from '../shared/ResolvedMedia';
import { useMediaSrc } from '../../hooks/useMediaSrc';
import { getEngagementAssessment, getSuggestedQuestions, saveMessageEdit, saveAudioClip, getAudioClips, deleteAudioClip } from '../../services/storage';

function formatClipTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatEditDate(entry: TranscriptEditHistoryEntry): string {
  const d = entry.editedAt?.toDate?.();
  if (!d) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Edit history modal
// ---------------------------------------------------------------------------

interface EditHistoryModalProps {
  entry: TranscriptEntry;
  onClose: () => void;
}

const EditHistoryModal: React.FC<EditHistoryModalProps> = ({ entry, onClose }) => {
  const history = entry.editHistory ?? [];
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-xl max-w-lg w-full p-8 space-y-5 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">Edit History</h3>
          <button
            onClick={onClose}
            className="text-sm text-slate-400 hover:text-slate-600 font-medium"
          >
            Close
          </button>
        </div>

        {/* Original transcription */}
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Original (AI Transcription)
          </p>
          <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3 leading-relaxed">
            {entry.originalText ?? entry.text}
          </p>
        </div>

        {/* Each edit in chronological order */}
        {history.map((h, i) => (
          <div key={i} className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
              Edit {i + 1} &mdash; {h.editedByName} &middot; {formatEditDate(h)}
            </p>
            <p className={`text-sm rounded-xl p-3 leading-relaxed ${
              i === history.length - 1
                ? 'bg-indigo-50 text-indigo-900 border border-indigo-200 font-medium'
                : 'bg-slate-50 text-slate-600'
            }`}>
              {h.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const TranscriptViewer: React.FC = () => {
  const { familyId, dossierId, sessionId } = useParams<{
    familyId: string;
    dossierId: string;
    sessionId: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { isAdmin, isStoryteller } = useCurrentRoles(familyId, user?.uid);

  // Indices of messages to highlight (passed via router state from FamilyEventDetail)
  const highlightedIndices: number[] = (location.state as any)?.highlightIndices ?? [];
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [editedEntries, setEditedEntries] = useState<TranscriptEntry[] | null>(null);
  const [session, setSession] = useState<SessionMetadata | null>(null);
  const audioSrc = useMediaSrc(session?.audioUrl);
  const [engagement, setEngagement] = useState<SessionEngagement | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedQuestion[]>([]);
  const [clips, setClips] = useState<AudioClip[]>([]);
  const [loading, setLoading] = useState(true);

  // Per-message edit state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Edit history modal
  const [historyEntry, setHistoryEntry] = useState<TranscriptEntry | null>(null);

  // Clean transcript toggle (#99)
  const [showClean, setShowClean] = useState(true);

  useEffect(() => {
    if (!familyId || !dossierId || !sessionId) return;

    async function loadData() {
      const sessionRef = doc(
        db,
        'families',
        familyId!,
        'dossiers',
        dossierId!,
        'sessions',
        sessionId!,
      );
      const sessionSnap = await getDoc(sessionRef);
      if (sessionSnap.exists()) {
        setSession({ ...sessionSnap.data(), id: sessionSnap.id } as SessionMetadata);
      }

      const transcriptRef = doc(
        db,
        'families',
        familyId!,
        'dossiers',
        dossierId!,
        'sessions',
        sessionId!,
        'transcript',
        'entries',
      );
      const transcriptSnap = await getDoc(transcriptRef);
      if (transcriptSnap.exists()) {
        const data = transcriptSnap.data();
        setEntries(data.entries ?? []);
        if (data.editedEntries) {
          setEditedEntries(data.editedEntries);
        }
      }

      // Load analysis data and clips (non-blocking)
      getEngagementAssessment(familyId!, dossierId!, sessionId!).then(setEngagement).catch(() => {});
      getSuggestedQuestions(familyId!, dossierId!, sessionId!).then(setSuggestions).catch(() => {});
      getAudioClips(familyId!, dossierId!).then((all) => setClips(all.filter((c) => c.sessionId === sessionId))).catch(() => {});

      setLoading(false);
    }

    loadData();
  }, [familyId, dossierId, sessionId]);

  // Scroll to first highlighted message after transcript loads
  useEffect(() => {
    if (highlightedIndices.length === 0 || entries.length === 0) return;
    const firstIdx = highlightedIndices[0];
    const el = messageRefs.current.get(firstIdx);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [entries, highlightedIndices]);

  const handleSaveEdit = useCallback(async (msgIndex: number) => {
    if (!familyId || !dossierId || !sessionId || !user) return;
    setSavingEdit(true);
    try {
      const displayName = user.displayName ?? user.email ?? 'User';
      await saveMessageEdit(familyId, dossierId, sessionId, msgIndex, editingText, user.uid, displayName);

      // Update local state so UI reflects the edit immediately
      const base = editedEntries ?? entries;
      const updated = base.map((entry, idx) => {
        if ((entry.messageIndex ?? idx) !== msgIndex) return entry;
        return {
          ...entry,
          text: editingText,
          originalText: entry.originalText ?? entry.text,
          editHistory: [
            ...(entry.editHistory ?? []),
            {
              text: editingText,
              editedBy: user.uid,
              editedByName: displayName,
              editedAt: { toDate: () => new Date() } as any,
            },
          ],
        };
      });
      setEditedEntries(updated);
      setEditingIndex(null);
    } catch (err) {
      console.error('[Transcript] Save edit error:', err);
      alert('Failed to save edit.');
    } finally {
      setSavingEdit(false);
    }
  }, [familyId, dossierId, sessionId, user, editingText, editedEntries, entries]);

  const canEdit = isAdmin || isStoryteller;
  const displayEntries = editedEntries ?? entries;
  const hasCleanText = displayEntries.some((e) => e.cleanText);

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
          onClick={() => navigate(isAdmin ? `/family/${familyId}/dossier/${dossierId}/history` : `/family/${familyId}`)}
          className="text-sm text-indigo-600 font-medium hover:underline mb-1"
        >
          &larr; Back to Session History
        </button>
        {isAdmin && (
          <button
            onClick={() => navigate(`/family/${familyId}/dossier/${dossierId}`)}
            className="text-sm text-slate-400 font-medium hover:underline mb-1 ml-4"
          >
            Dossier
          </button>
        )}
        <h2 className="text-2xl font-bold text-slate-800">Session Transcript</h2>
        {session && (
          <p className="text-sm text-slate-400 mt-1">
            {session.startTime?.toDate?.()
              ? session.startTime.toDate().toLocaleDateString(undefined, {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })
              : 'Unknown date'}{' '}
            &middot;{' '}
            <span
              className={`font-semibold ${
                session.status === 'completed' ? 'text-green-600' : 'text-amber-600'
              }`}
            >
              {session.status}
            </span>
          </p>
        )}
      </div>

      {session?.audioUrl && (
        <AudioPlayer
          audioUrl={audioSrc}
          durationSeconds={session.durationSeconds}
          onCreateClip={async (startSeconds, endSeconds) => {
            if (!familyId || !dossierId || !sessionId || !user || !audioSrc) return;
            const title = prompt('Name this clip:');
            if (!title) return;
            try {
              // Fetch the full audio and extract the clip range using MediaSource
              const response = await fetch(audioSrc);
              const fullBlob = await response.blob();
              // For WebM we store the full blob with time range metadata
              // (true audio slicing requires server-side processing)
              await saveAudioClip(familyId, dossierId, fullBlob, {
                sessionId,
                title,
                startSeconds,
                endSeconds,
                eventIds: [],
                createdBy: user.uid,
              });
              const updated = await getAudioClips(familyId, dossierId);
              setClips(updated.filter((c) => c.sessionId === sessionId));
            } catch (err) {
              console.error('[Clip] Save error:', err);
              alert('Failed to save clip.');
            }
          }}
        />
      )}
      {session && !session.audioUrl && (
        <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-400 italic text-center">
          Audio not available for this session.
        </div>
      )}

      {/* Audio clips */}
      {clips.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-3">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Audio Clips ({clips.length})
          </p>
          {clips.map((clip) => (
            <div key={clip.id} className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
              <MediaAudio src={clip.clipUrl} controls className="h-8 flex-1" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{clip.title}</p>
                <p className="text-xs text-slate-400">
                  {formatClipTime(clip.startSeconds)} &ndash; {formatClipTime(clip.endSeconds)}
                </p>
              </div>
              <button
                onClick={async () => {
                  if (!familyId || !dossierId || !clip.id) return;
                  if (!confirm('Delete this clip?')) return;
                  await deleteAudioClip(familyId, dossierId, clip.id);
                  setClips((prev) => prev.filter((c) => c.id !== clip.id));
                }}
                className="text-xs text-rose-500 hover:underline shrink-0"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Transcript */}
      <div className="bg-white rounded-3xl border border-slate-200 p-8 space-y-6 shadow-sm">
        {hasCleanText && (
          <div className="flex justify-end">
            <div className="flex items-center gap-1 bg-slate-100 rounded-full p-1 text-xs font-semibold">
              <button
                onClick={() => setShowClean(false)}
                className={`px-3 py-1 rounded-full transition-colors ${!showClean ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Literal
              </button>
              <button
                onClick={() => setShowClean(true)}
                className={`px-3 py-1 rounded-full transition-colors ${showClean ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Clean
              </button>
            </div>
          </div>
        )}
        {displayEntries.length === 0 ? (
          <p className="text-slate-400 italic text-center py-8">
            No transcript entries for this session.
          </p>
        ) : (
          displayEntries.map((entry, idx) => {
            const msgIndex = entry.messageIndex ?? idx;
            const isHighlighted = highlightedIndices.includes(msgIndex);
            const isEditing = editingIndex === msgIndex;
            const isEdited = Boolean(entry.editHistory?.length);
            const lastEdit = entry.editHistory?.[entry.editHistory.length - 1];
            const showEditButton = canEdit && entry.role === 'user' && !isEditing;

            // Tool call entries render as a compact centred pill
            if (entry.role === 'tool') {
              return (
                <div key={idx} className="flex justify-center">
                  <div className="group flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-[11px] text-slate-400 font-mono">
                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span>{entry.text}</span>
                    {entry.toolResult && (
                      <span className="hidden group-hover:inline ml-1 text-slate-300" title={entry.toolResult}>
                        — {entry.toolResult.slice(0, 80)}{entry.toolResult.length > 80 ? '…' : ''}
                      </span>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={idx}
                ref={(el) => { if (el) messageRefs.current.set(msgIndex, el); }}
                className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'} ${isHighlighted ? 'rounded-2xl ring-2 ring-amber-400 ring-offset-2' : ''}`}
              >
                <div className="max-w-[85%] space-y-1">
                  <div
                    className={`group relative px-5 py-3 rounded-3xl text-sm leading-relaxed ${
                      entry.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-none'
                        : isHighlighted
                          ? 'bg-amber-50 text-slate-700 border border-amber-300 rounded-bl-none'
                          : 'bg-slate-50 text-slate-700 border border-slate-200 rounded-bl-none'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[9px] font-bold uppercase ${
                          entry.role === 'user' ? 'text-indigo-200' : 'text-slate-400'
                        }`}
                      >
                        {entry.role === 'user'
                        ? (entry.speakerLabel ?? 'Storyteller')
                        : 'BiographyBot'}
                      </span>
                      {entry.timestamp?.toDate && (
                        <span
                          className={`text-[9px] opacity-50 ${
                            entry.role === 'user' ? 'text-white' : 'text-slate-400'
                          }`}
                        >
                          {entry.timestamp.toDate().toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                      {/* Edit button — visible on hover */}
                      {showEditButton && (
                        <button
                          onClick={() => {
                            setEditingIndex(msgIndex);
                            setEditingText(entry.text);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto text-[9px] font-semibold text-indigo-200 hover:text-white underline"
                          title="Edit this message"
                        >
                          Edit
                        </button>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          className="w-full bg-indigo-700 text-white placeholder-indigo-300 rounded-xl p-2 resize-none outline-none text-sm leading-relaxed"
                          rows={Math.max(2, Math.ceil(editingText.length / 60))}
                          autoFocus
                        />
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleSaveEdit(msgIndex)}
                            disabled={savingEdit || editingText.trim() === entry.text.trim()}
                            className="px-3 py-1 bg-white text-indigo-700 rounded-full text-xs font-bold hover:bg-indigo-50 transition-colors disabled:opacity-50"
                          >
                            {savingEdit ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingIndex(null)}
                            className="text-xs text-indigo-200 hover:text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      showClean ? (entry.cleanText ?? entry.text) : entry.text
                    )}
                  </div>

                  {/* Edited badge */}
                  {isEdited && lastEdit && !isEditing && (
                    <div className="flex justify-end">
                      <button
                        onClick={() => setHistoryEntry(entry)}
                        className="text-[10px] text-slate-400 hover:text-indigo-600 transition-colors"
                        title="View edit history"
                      >
                        Edited by {lastEdit.editedByName} &middot; {formatEditDate(lastEdit)} &middot; View history
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Engagement Assessment (admin-only) */}
      {isAdmin && engagement && (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm space-y-4">
          <h3 className="text-lg font-bold text-slate-800">Session Analysis</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-50 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-indigo-600">{engagement.comfortScore}</p>
              <p className="text-xs text-slate-400 font-medium mt-1">Comfort Score</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-indigo-600">{Math.round(engagement.speakingRatio * 100)}%</p>
              <p className="text-xs text-slate-400 font-medium mt-1">Storyteller Speaking</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-indigo-600">{Math.round(engagement.avgResponseLength)}</p>
              <p className="text-xs text-slate-400 font-medium mt-1">Avg Words/Response</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 text-center">
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                engagement.sentiment === 'positive' ? 'bg-green-100 text-green-700'
                  : engagement.sentiment === 'guarded' ? 'bg-amber-100 text-amber-700'
                  : engagement.sentiment === 'distressed' ? 'bg-rose-100 text-rose-700'
                  : 'bg-slate-100 text-slate-700'
              }`}>
                {engagement.sentiment}
              </span>
              <p className="text-xs text-slate-400 font-medium mt-2">Sentiment</p>
            </div>
          </div>
          {engagement.flags.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-600">Flags</p>
              <div className="flex flex-wrap gap-2">
                {engagement.flags.map((flag, i) => (
                  <span key={i} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1">
                    {flag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Suggested Questions (admin-only) */}
      {isAdmin && suggestions.length > 0 && (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm space-y-4">
          <h3 className="text-lg font-bold text-slate-800">Suggested Follow-up Questions</h3>
          <p className="text-sm text-slate-400">Based on this session, consider adding these to the Story Queue:</p>
          <div className="space-y-3">
            {suggestions.map((s, i) => (
              <div key={i} className="bg-slate-50 rounded-xl p-4 space-y-1">
                <p className="font-medium text-slate-800">&ldquo;{s.text}&rdquo;</p>
                <p className="text-sm text-slate-400">{s.rationale}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit history modal */}
      {historyEntry && (
        <EditHistoryModal
          entry={historyEntry}
          onClose={() => setHistoryEntry(null)}
        />
      )}
    </div>
  );
};
