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
 * SessionView — the live recording session screen.
 *
 * This is the Storyteller-facing view. It prioritizes simplicity:
 *   - A compact control bar pinned at the top (Start/Stop + live recorded
 *     time + recording indicator), leaving the rest of the screen for the
 *     transcript
 *   - Live transcript feed that fills the remaining height
 *
 * The Archivist panel (Dossier editor) is accessible via a floating
 * button but hidden by default to keep the Storyteller's view clean.
 *
 * Error handling:
 *   - Connection errors show a reassuring message (not a stack trace)
 *   - Partial session data is flushed on disconnect
 *   - A "Reconnect" button is offered for recovery
 *
 * References: product_requirements.md §4 | GitHub Issues #17, #19
 */

import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useFamily, useCurrentRoles } from '../../hooks/useFamily';
import { useDossier } from '../../hooks/useDossier';
import { useUnifiedSession } from '../../hooks/useUnifiedSession';
import { getPromptPhotos } from '../../services/storage';
import { TranscriptFeed } from './TranscriptFeed';
import { ConnectionStatus, PromptPhoto } from '../../types';
import { Logo } from '../shared/Logo';
import { useMediaSrc } from '../../hooks/useMediaSrc';

/**
 * Format an elapsed-seconds count as `M:SS` (or `H:MM:SS` past an hour).
 * Used for the live recorded-time readout in the session control bar.
 */
function formatElapsed(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

export const SessionView: React.FC = () => {
  const { familyId, dossierId } = useParams<{ familyId: string; dossierId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { family } = useFamily(familyId);
  const { isAdmin } = useCurrentRoles(familyId, user?.uid);
  const {
    dossier,
    questions,
    loading: dossierLoading,
    updateQuestion,
    updateDossier,
  } = useDossier(familyId, dossierId);

  // Prompt photos
  const [promptPhotos, setPromptPhotos] = useState<PromptPhoto[]>([]);
  const [activePhoto, setActivePhoto] = useState<PromptPhoto | null>(null);
  const activePhotoSrc = useMediaSrc(activePhoto?.storageUrl);

  useEffect(() => {
    if (!familyId || !dossierId) return;
    getPromptPhotos(familyId, dossierId).then(setPromptPhotos).catch(console.error);
  }, [familyId, dossierId]);

  const handleShowPhoto = useCallback(
    (photoId: string) => {
      const photo = promptPhotos.find((p) => p.id === photoId);
      if (photo) setActivePhoto(photo);
    },
    [promptPhotos],
  );

  /** Handler for Gemini function-calling question updates during a session. */
  const handleQuestionUpdate = useCallback(
    (questionId: string, status: string, findings?: string) => {
      updateQuestion(questionId, { status: status as any, ...(findings ? { findings } : {}) });
    },
    [updateQuestion],
  );

  /** Handler for when the AI records the storyteller's preferred name. */
  const handlePreferredNameUpdate = useCallback(
    (name: string) => {
      updateDossier({ preferredName: name });
    },
    [updateDossier],
  );

  // Auto-reconnect on the first unexpected disconnect without asking the user.
  // If the auto-reconnect itself fails, fall through to the manual modal.
  const [autoReconnectDone, setAutoReconnectDone] = useState(false);

  // Elapsed recorded time (mm:ss). Driven from a single start timestamp so it
  // keeps counting across reconnections — on a resume the status briefly leaves
  // CONNECTED, but the recording (and therefore the elapsed time) is continuous.
  const [elapsedSec, setElapsedSec] = useState(0);
  const sessionStartRef = useRef<number | null>(null);

  const {
    status,
    messages,
    isBotSpeaking,
    sessionId,
    deviceError,
    connectivityWarning,
    clearDeviceError,
    dismissConnectivityWarning,
    startSession,
    reconnectSession,
    stopSession,
    flushPartialSession,
  } = useUnifiedSession({
    familyId: familyId ?? '',
    dossierId: dossierId ?? '',
    storytellerUid: user?.uid ?? '',
    dossier: dossier!,
    questions,
    familyTree: family?.familyTree,
    promptPhotos,
    onQuestionUpdate: handleQuestionUpdate,
    onShowPhoto: handleShowPhoto,
    onPreferredNameUpdate: handlePreferredNameUpdate,
  });

  useEffect(() => {
    if (status === ConnectionStatus.ERROR && !deviceError && !autoReconnectDone) {
      // Unexpected disconnect — reconnect without starting a new session.
      // reconnectSession() keeps the existing session ID and transcript so
      // the conversation continues naturally after the brief interruption.
      // A short delay gives the browser a moment to settle (e.g. network re-up).
      const timer = setTimeout(async () => {
        setAutoReconnectDone(true);
        await reconnectSession();
      }, 500);
      return () => clearTimeout(timer);
    }
    if (status === ConnectionStatus.CONNECTED) {
      setAutoReconnectDone(false); // Reset so the next disconnect auto-reconnects too
    }
  }, [status, deviceError, autoReconnectDone, reconnectSession]);

  // Stamp the session start the first time we reach CONNECTED. A reconnection
  // passes back through CONNECTED but the ref is already set, so the clock
  // never restarts mid-interview.
  useEffect(() => {
    if (status === ConnectionStatus.CONNECTED && sessionStartRef.current === null) {
      sessionStartRef.current = Date.now();
      setElapsedSec(0);
    }
  }, [status]);

  // Tick once per second while the session is live (or briefly reconnecting).
  useEffect(() => {
    const active =
      status === ConnectionStatus.CONNECTED || status === ConnectionStatus.CONNECTING;
    if (!active || sessionStartRef.current === null) return;
    const id = setInterval(() => {
      if (sessionStartRef.current !== null) {
        setElapsedSec(Math.floor((Date.now() - sessionStartRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  // Start a brand-new session — reset the elapsed clock first so it counts from
  // zero (as opposed to reconnectSession(), which preserves the running clock).
  const handleStart = useCallback(() => {
    sessionStartRef.current = null;
    setElapsedSec(0);
    startSession();
  }, [startSession]);

  if (dossierLoading || !dossier) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  const isConnected = status === ConnectionStatus.CONNECTED;
  const isConnecting = status === ConnectionStatus.CONNECTING;
  const isActive = isConnected || isConnecting;

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Compact control bar — pinned at the top */}
      <div className="shrink-0 px-4 pt-4 space-y-3">
        <div className="mx-auto w-full max-w-3xl bg-white rounded-3xl shadow-lg border border-slate-100 px-4 py-3 flex items-center gap-3">
          {/* Back (role-aware) */}
          <button
            onClick={() => navigate(isAdmin
              ? `/family/${familyId}/dossier/${dossierId}`
              : `/family/${familyId}`
            )}
            className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors p-1 -ml-1"
            aria-label={isAdmin ? 'Back to Dossier' : 'Back to Home'}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Identity + status */}
          <div className="flex items-center gap-2.5 min-w-0">
            <Logo size={30} />
            <div className="min-w-0 leading-tight">
              <p className="text-sm font-bold text-slate-800 truncate font-display">
                BiographyBot
              </p>
              <p className="text-xs text-slate-400 truncate">
                {isConnected
                  ? isBotSpeaking
                    ? 'Speaking…'
                    : `Listening to ${dossier.storytellerName}…`
                  : isConnecting
                    ? messages.length > 0
                      ? 'Reconnecting…'
                      : 'Starting…'
                    : `Session with ${dossier.storytellerName}`}
              </p>
            </div>
          </div>

          <div className="flex-1" />

          {/* Live recording indicator + elapsed recorded time */}
          {isActive && (
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-rose-50 border border-rose-100 rounded-full">
              <div className={`w-2 h-2 bg-rose-500 rounded-full ${isConnected ? 'animate-pulse' : ''}`} />
              <span className="text-xs font-bold text-rose-600 tabular-nums" aria-label="Recorded time">
                {formatElapsed(elapsedSec)}
              </span>
            </div>
          )}

          {/* Call-to-action next to the start button (idle only) */}
          {!isActive && (
            <span className="shrink-0 text-sm font-semibold text-green-700 whitespace-nowrap">
              Press to start recording
            </span>
          )}

          {/* Start / End call button — phone metaphor */}
          {!isConnected ? (
            <button
              onClick={handleStart}
              disabled={isConnecting}
              className="shrink-0 w-12 h-12 bg-green-500 rounded-full text-white shadow-lg hover:bg-green-600 active:scale-95 transition-all flex items-center justify-center disabled:opacity-50"
              aria-label="Start a conversation"
            >
              {isConnecting ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
              ) : (
                /* Phone handset — answer call */
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
                </svg>
              )}
            </button>
          ) : (
            <button
              onClick={stopSession}
              className="shrink-0 w-12 h-12 bg-red-500 rounded-full text-white shadow-lg hover:bg-red-600 active:scale-95 transition-all flex items-center justify-center"
              aria-label="End conversation"
            >
              {/* Rotated phone handset — hang up */}
              <svg className="w-6 h-6 rotate-[135deg]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
              </svg>
            </button>
          )}
        </div>

        {/* Connectivity warning */}
        {connectivityWarning && (
          <div className="mx-auto w-full max-w-3xl bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm text-amber-800">{connectivityWarning}</p>
            </div>
            <button
              onClick={dismissConnectivityWarning}
              className="text-amber-600 hover:text-amber-800 text-sm font-medium shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Live transcript feed — fills the remaining height. `listening` shows an
          animated placeholder while the bot is idle: the native-audio model only
          sends the user's transcription at end-of-turn, so their words can't
          stream word-by-word — this signals the mic is open in the meantime. */}
      <div className="flex-1 min-h-0 px-4 pb-4 pt-3">
        <TranscriptFeed
          messages={messages}
          sessionId={sessionId}
          listening={isConnected && !isBotSpeaking && messages.length > 0}
        />
      </div>

      {/* Prompt photo display */}
      {activePhoto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-lg w-full overflow-hidden">
            <img
              src={activePhotoSrc ?? undefined}
              alt={activePhoto.caption}
              className="w-full max-h-[60vh] object-contain bg-slate-100"
            />
            <div className="p-6 space-y-3">
              <p className="text-slate-600 text-sm italic">{activePhoto.caption}</p>
              <button
                onClick={() => setActivePhoto(null)}
                className="w-full py-3 bg-slate-100 text-slate-600 rounded-2xl font-medium hover:bg-slate-200 transition-colors text-sm"
              >
                Close Photo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Device error dialog (microphone issues) */}
      {status === ConnectionStatus.ERROR && deviceError && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 text-center">
          <div className="bg-white p-8 rounded-[2rem] shadow-2xl max-w-md space-y-6">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-800">
              Session Stopped
            </h2>
            <p className="text-slate-500">
              {deviceError}
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  clearDeviceError();
                  handleStart();
                }}
                className="w-full py-4 bg-green-500 text-white rounded-2xl font-bold hover:bg-green-600 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={() => navigate(isAdmin
                  ? `/family/${familyId}/dossier/${dossierId}`
                  : `/family/${familyId}`
                )}
                className="w-full py-3 text-slate-500 font-medium hover:text-slate-700 transition-colors"
              >
                {isAdmin ? 'Back to Dossier' : 'Back to Home'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reconnecting banner — auto-reconnect in progress (brief, no user action needed) */}
      {status === ConnectionStatus.ERROR && !deviceError && !autoReconnectDone && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-slate-800 text-white px-6 py-3 rounded-2xl shadow-xl flex items-center gap-3">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white shrink-0" />
          <span className="text-sm font-medium">Reconnecting…</span>
        </div>
      )}

      {/* Session complete overlay — shown when AI (or user) ends the session intentionally */}
      {status === ConnectionStatus.COMPLETED && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 text-center">
          <div className="bg-white p-8 rounded-[2rem] shadow-2xl max-w-md space-y-6">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-800">Session Complete</h2>
            <p className="text-slate-500">
              Great session! Everything has been saved. You can review the transcript and
              recordings from the session history.
            </p>
            <button
              onClick={() => navigate(isAdmin
                ? `/family/${familyId}/dossier/${dossierId}`
                : `/family/${familyId}`
              )}
              className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-colors"
            >
              {isAdmin ? 'Back to Dossier' : 'Back to Home'}
            </button>
          </div>
        </div>
      )}

      {/* Connection error dialog — shown only when auto-reconnect has already been attempted */}
      {status === ConnectionStatus.ERROR && !deviceError && autoReconnectDone && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 text-center">
          <div className="bg-white p-8 rounded-[2rem] shadow-2xl max-w-md space-y-6">
            <h2 className="text-2xl font-bold text-slate-800">
              Connection Interrupted
            </h2>
            <p className="text-slate-500">
              Don&apos;t worry — everything you&apos;ve shared so far has been
              saved. You can try reconnecting or end the session.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={async () => {
                  setAutoReconnectDone(false);
                  await reconnectSession();
                }}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={async () => {
                  await flushPartialSession();
                  navigate(isAdmin
                    ? `/family/${familyId}/dossier/${dossierId}`
                    : `/family/${familyId}`
                  );
                }}
                className="w-full py-3 text-slate-500 font-medium hover:text-slate-700 transition-colors"
              >
                End Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
