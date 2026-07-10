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
 * TalkView — the "Talk About My Family" conversational screen (#95).
 *
 * A lightweight, unstructured version of SessionView.
 * Key differences:
 *   - No "Live Archival Vault Active" indicator (nothing is archived)
 *   - No reconnect logic (conversation can simply be restarted)
 *   - Shows live transcript in memory (not synced to Firestore)
 *   - Friendly framing: "just chatting", not "giving an interview"
 *
 * References: design.md §3.7 | GitHub Issue #95
 */

import React, { useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useFamily } from '../../hooks/useFamily';
import { useDossier } from '../../hooks/useDossier';
import { useTalkSession } from '../../hooks/useTalkSession';
import { Visualizer } from '../session/Visualizer';
import { TranscriptFeed } from '../session/TranscriptFeed';
import { ConnectionStatus } from '../../types';
import { Logo } from '../shared/Logo';

export const TalkView: React.FC = () => {
  const { familyId, dossierId } = useParams<{ familyId: string; dossierId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { family } = useFamily(familyId);
  const { dossier, loading: dossierLoading, updateDossier } = useDossier(familyId, dossierId);

  const handlePreferredNameUpdate = useCallback(
    (name: string) => {
      updateDossier({ preferredName: name });
    },
    [updateDossier],
  );

  const {
    status,
    messages,
    isBotSpeaking,
    deviceError,
    connectivityWarning,
    clearDeviceError,
    dismissConnectivityWarning,
    startTalk,
    stopTalk,
  } = useTalkSession({
    familyId: familyId ?? '',
    dossierId: dossierId ?? '',
    storytellerUid: user?.uid ?? '',
    dossier: dossier!,
    familyTree: family?.familyTree,
    onPreferredNameUpdate: handlePreferredNameUpdate,
  });

  if (dossierLoading || !dossier) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  const displayName = dossier.preferredName ?? dossier.storytellerName;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 space-y-8">
      {/* Back link */}
      <button
        onClick={() => navigate(`/family/${familyId}`)}
        className="absolute top-4 left-4 text-sm text-slate-400 hover:text-slate-600 transition-colors"
      >
        &larr; Back to Home
      </button>

      {/* Header */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-3">
          <Logo size={48} />
          <h1 className="text-5xl font-bold text-slate-800 tracking-tighter font-display">
            BiographyBot
          </h1>
        </div>
        <p className="text-slate-400 font-medium italic">
          Talking with {displayName}
        </p>
      </div>

      {/* Connectivity warning */}
      {connectivityWarning && (
        <div className="w-full max-w-2xl bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
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

      {/* Main card */}
      <div className="w-full max-w-2xl bg-white p-12 rounded-[3.5rem] shadow-2xl border border-slate-100 flex flex-col items-center space-y-12 relative overflow-hidden">
        {/* "Just chatting" indicator */}
        {status === ConnectionStatus.CONNECTED && (
          <div className="absolute top-6 right-6 flex items-center gap-2 px-3 py-1 bg-emerald-50 border border-emerald-100 rounded-full">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
              Just Chatting
            </span>
          </div>
        )}

        <Visualizer
          isActive={status === ConnectionStatus.CONNECTED}
          isBotSpeaking={isBotSpeaking}
        />

        <div className="flex flex-col items-center gap-6 w-full">
          {status !== ConnectionStatus.CONNECTED ? (
            <button
              onClick={startTalk}
              disabled={status === ConnectionStatus.CONNECTING}
              className="w-28 h-28 bg-emerald-600 rounded-full text-white shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center group disabled:opacity-50"
            >
              {status === ConnectionStatus.CONNECTING ? (
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white" />
              ) : (
                <svg className="w-12 h-12 ml-1 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
                </svg>
              )}
            </button>
          ) : (
            <button
              onClick={stopTalk}
              className="w-28 h-28 bg-slate-800 rounded-full text-white shadow-2xl hover:bg-slate-900 transition-all flex items-center justify-center"
            >
              <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" />
              </svg>
            </button>
          )}

          <div className="text-center space-y-1">
            <p className="text-xl font-bold text-slate-800">
              {status === ConnectionStatus.CONNECTED
                ? `Just talk, ${displayName}…`
                : status === ConnectionStatus.CONNECTING
                  ? `One moment, ${displayName}…`
                  : `Ready when you are, ${displayName}`}
            </p>
            <p className="text-sm text-slate-400">
              {status === ConnectionStatus.CONNECTED
                ? 'This is just a conversation — nothing is recorded.'
                : status === ConnectionStatus.CONNECTING
                  ? 'Getting ready to chat…'
                  : 'Press the button to start talking about your family.'}
            </p>
          </div>
        </div>
      </div>

      {/* Live transcript (in-memory only) */}
      {messages.length > 0 && (
        <TranscriptFeed messages={messages} sessionId={null} />
      )}

      {/* Microphone error dialog */}
      {status === ConnectionStatus.ERROR && deviceError && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 text-center">
          <div className="bg-white p-8 rounded-[2rem] shadow-2xl max-w-md space-y-6">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-800">Microphone Issue</h2>
            <p className="text-slate-500">{deviceError}</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  clearDeviceError();
                  startTalk();
                }}
                className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={() => navigate(`/family/${familyId}`)}
                className="w-full py-3 text-slate-500 font-medium hover:text-slate-700 transition-colors"
              >
                Back to Home
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session complete — AI said goodbye, navigate back home */}
      {status === ConnectionStatus.COMPLETED && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 text-center">
          <div className="bg-white p-8 rounded-[2rem] shadow-2xl max-w-md space-y-6">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-800">Conversation Complete</h2>
            <p className="text-slate-500">
              Great chat! Start a new conversation whenever you&apos;re ready.
            </p>
            <button
              onClick={() => navigate(`/family/${familyId}`)}
              className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-colors"
            >
              Back to Home
            </button>
          </div>
        </div>
      )}

      {/* Connection error — no auto-reconnect for talk sessions, just show a restart option */}
      {status === ConnectionStatus.ERROR && !deviceError && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 text-center">
          <div className="bg-white p-8 rounded-[2rem] shadow-2xl max-w-md space-y-6">
            <h2 className="text-2xl font-bold text-slate-800">Connection Lost</h2>
            <p className="text-slate-500">
              The connection dropped. Start a new conversation whenever you&apos;re ready.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={startTalk}
                className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-colors"
              >
                Start New Conversation
              </button>
              <button
                onClick={() => navigate(`/family/${familyId}`)}
                className="w-full py-3 text-slate-500 font-medium hover:text-slate-700 transition-colors"
              >
                Back to Home
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
