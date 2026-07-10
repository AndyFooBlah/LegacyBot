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
 * Thin wrapper around VoiceCommon's useSession for LegacyBot.
 *
 * VoiceCommon handles all of the voice infrastructure:
 *   - Gemini Live WebSocket lifecycle
 *   - Audio mixing (mic input + bot audio recording)
 *   - Auto-reconnect on unexpected disconnects (up to 3 attempts)
 *   - Repetition detection and recovery
 *   - Firestore session create/finalize and transcript sync
 *   - GCS audio archival
 *
 * This wrapper adds LegacyBot-specific concerns:
 *   - Async context loading before startSession (completedSessionCount,
 *     previousSessionSummary, recentDates)
 *   - System instruction building (buildSessionInstruction) — kept deliberately
 *     small: a short rolling profile (not the full biography), the Story Queue
 *     (topics + status, no findings), and family tree. Prior detail (biography,
 *     transcripts, events, facts, per-question findings) is fetched on demand
 *     via searchContext / getBiography / getQuestionFindings, not inlined.
 *   - Turn-taking mode selected by TURN_MODE (auto server VAD + LOW sensitivity,
 *     or client-side manual turn control in VoiceCommon).
 *   - Family-scoped Firestore path:
 *       families/{familyId}/dossiers/{dossierId}/sessions
 *   - 15 LB-specific tool declarations (endSession is injected by VC;
 *     showPhoto is added only when prompt photos exist)
 *   - Tool call dispatch: LB-specific tools + KC knowledge tools
 *   - Post-session analysis: extractEvents, assessEngagement, suggestQuestions,
 *     generateProfileSummary (rolling profile stored on the dossier)
 *   - Speaker tracking for recordFact attribution
 *   - Connectivity warning detection (latency > 500 ms during context load)
 *
 * References: design.md §3.2, §3.7 | GitHub Issues #116, #146, #147, #148
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Type, FunctionDeclaration } from '@google/genai';
import { Timestamp } from 'firebase/firestore';
import { useSession } from '@andyfooblah/voice-common';
import {
  searchWikipedia,
  wikipediaTool,
  computeTimeDifferenceTool,
  computeTimeOffsetTool,
  getTimeDifference,
  getTimeOffset,
} from '@andyfooblah/knowledge-common';
import { Message, Dossier, InterviewQuestion, FamilyMember, PromptPhoto, TranscriptEntry, ConnectionStatus } from '../types';
import { buildSessionInstruction } from '../services/gemini';
import { getJoke, searchPlace, getDistanceBetweenPlaces, getWeather, searchContext } from '../services/externalSearch';
import {
  updateQuestionStateInFirestore,
  getCompletedSessionCount,
  getPreviousSessionSummary,
  getLastSessionDate,
  getRecentSessionDates,
  logEmotionalObservation,
  saveExtractedEvents,
  saveFamilyEvents,
  saveEngagementAssessment,
  saveSuggestedQuestions,
  getEvents,
  saveMiscFact,
  saveProfileSummary,
  archiveAudioToGCS,
} from '../services/storage';
import { extractEvents, assessEngagement, suggestQuestions, generateProfileSummary } from '../services/postSessionAnalysis';

/**
 * Turn-taking mode (flip to compare):
 *   'manual' — client-side VAD; the bot waits `responseWaitSeconds` of real
 *              silence before responding (patient, robust to eager end-of-turn).
 *   'auto'   — Gemini server VAD with LOW end-of-speech sensitivity (snappier,
 *              but can grab the turn during a pause on this native-audio model).
 */
const TURN_MODE: 'manual' | 'auto' = 'auto';

export interface UseUnifiedSessionOptions {
  familyId: string;
  dossierId: string;
  storytellerUid: string;
  dossier: Dossier;
  questions: InterviewQuestion[];
  familyTree?: FamilyMember[];
  promptPhotos?: PromptPhoto[];
  onQuestionUpdate: (id: string, status: string, findings?: string) => void;
  onShowPhoto?: (photoId: string) => void;
  onPreferredNameUpdate?: (name: string) => void;
}

export interface UseUnifiedSessionReturn {
  status: ConnectionStatus;
  messages: Message[];
  isBotSpeaking: boolean;
  sessionId: string | null;
  deviceError: string | null;
  connectivityWarning: string | null;
  clearDeviceError: () => void;
  dismissConnectivityWarning: () => void;
  startSession: () => Promise<void>;
  reconnectSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  flushPartialSession: () => void;
}

// ---------------------------------------------------------------------------
// Tool declarations
// ---------------------------------------------------------------------------

const updateQuestionStatusTool: FunctionDeclaration = {
  name: 'updateQuestionStatus',
  description: 'Mark a story queue question as asked, skipped, or answered. Call after each question is addressed.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING, description: 'Question ID from the story queue.' },
      status: { type: Type.STRING, description: 'New status: "asked", "answered", or "skipped".' },
      findings: { type: Type.STRING, description: 'Optional summary of what was said.' },
    },
    required: ['id', 'status'],
  },
};

const reportEmotionalObservationTool: FunctionDeclaration = {
  name: 'reportEmotionalObservation',
  description: 'Log an emotional observation about the storyteller (e.g. distress, joy, nostalgia).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      mood: { type: Type.STRING, description: 'Observed emotional state.' },
      confidence: { type: Type.STRING, description: 'Confidence: "high", "medium", or "low".' },
      trigger: { type: Type.STRING, description: 'What seemed to trigger this emotion.' },
      recommendation: { type: Type.STRING, description: 'Suggested response or topic change.' },
    },
    required: ['mood', 'confidence'],
  },
};

const setPreferredNameTool: FunctionDeclaration = {
  name: 'setPreferredName',
  description: 'Record the name the storyteller prefers to be called by.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: 'The preferred name.' },
    },
    required: ['name'],
  },
};

const identifySpeakerTool: FunctionDeclaration = {
  name: 'identifySpeaker',
  description: 'Identify who is currently speaking (e.g. a family member who joined). Use null for the primary storyteller.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      speakerLabel: { type: Type.STRING, description: 'Name of current speaker, or null for primary storyteller.' },
      confidence: { type: Type.STRING, description: 'Confidence: "high", "medium", or "low".' },
    },
    required: ['confidence'],
  },
};

const recordFactTool: FunctionDeclaration = {
  name: 'recordFact',
  description: 'Record a noteworthy fact or correction shared during the conversation.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING, description: 'The fact to record.' },
      isCorrection: { type: Type.BOOLEAN, description: 'True if this corrects a previously recorded fact.' },
      correctionNote: { type: Type.STRING, description: 'Explanation of the correction (optional).' },
    },
    required: ['text', 'isCorrection'],
  },
};

const searchContextTool: FunctionDeclaration = {
  name: 'searchContext',
  description: 'Search the family\'s accumulated knowledge for context relevant to the current conversation topic.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'The topic or question to search for.' },
      topK: { type: Type.NUMBER, description: 'Number of results to return (default 4).' },
    },
    required: ['query'],
  },
};

const getBiographyTool: FunctionDeclaration = {
  name: 'getBiography',
  description: "Retrieve the storyteller's full background/biography on record. The prompt only carries a short profile; call this when you want the complete background before asking about something specific.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
    required: [],
  },
};

const getQuestionFindingsTool: FunctionDeclaration = {
  name: 'getQuestionFindings',
  description: 'Retrieve what has already been learned (accumulated findings) about a specific Story Queue question, by its id. Call this before revisiting a topic so you build on prior answers instead of repeating them.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      questionId: { type: Type.STRING, description: 'The id of the Story Queue question.' },
    },
    required: ['questionId'],
  },
};

const searchPlaceTool: FunctionDeclaration = {
  name: 'searchPlace',
  description: 'Look up a place by name and return its address and location details.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'Place name or address to look up.' },
    },
    required: ['query'],
  },
};

const getDistanceTool: FunctionDeclaration = {
  name: 'getDistanceBetweenPlaces',
  description: 'Calculate the approximate distance between two named places.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      placeA: { type: Type.STRING, description: 'First place name.' },
      placeB: { type: Type.STRING, description: 'Second place name.' },
    },
    required: ['placeA', 'placeB'],
  },
};

const getJokeTool: FunctionDeclaration = {
  name: 'getJoke',
  description: 'Fetch a random clean joke to lighten the mood.',
  parameters: {
    type: Type.OBJECT,
    properties: {},
    required: [],
  },
};

const getWeatherTool: FunctionDeclaration = {
  name: 'getWeather',
  description: 'Get the current weather for a location the storyteller mentions.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      location: { type: Type.STRING, description: 'City or place name.' },
    },
    required: ['location'],
  },
};

const showPhotoTool: FunctionDeclaration = {
  name: 'showPhoto',
  description: 'Display a prompt photo to the storyteller to help them recall a memory.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      photoId: { type: Type.STRING, description: 'ID of the photo to display.' },
    },
    required: ['photoId'],
  },
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUnifiedSession({
  familyId,
  dossierId,
  storytellerUid,
  dossier,
  questions,
  familyTree,
  promptPhotos,
  onQuestionUpdate,
  onShowPhoto,
  onPreferredNameUpdate,
}: UseUnifiedSessionOptions): UseUnifiedSessionReturn {
  // Family-scoped Firestore collection path — all session docs, transcript
  // subcollections, and finalization calls go under this prefix.
  const sessionsCollection = `families/${familyId}/dossiers/${dossierId}/sessions`;

  // ---------------------------------------------------------------------------
  // Stable refs for values used inside callbacks (prevents stale closures)
  // ---------------------------------------------------------------------------

  const familyIdRef = useRef(familyId);
  familyIdRef.current = familyId;
  const dossierIdRef = useRef(dossierId);
  dossierIdRef.current = dossierId;
  const storytellerUidRef = useRef(storytellerUid);
  storytellerUidRef.current = storytellerUid;
  const dossierRef = useRef(dossier);
  dossierRef.current = dossier;
  const questionsRef = useRef(questions);
  questionsRef.current = questions;
  const promptPhotosRef = useRef(promptPhotos);
  promptPhotosRef.current = promptPhotos;
  const onQuestionUpdateRef = useRef(onQuestionUpdate);
  onQuestionUpdateRef.current = onQuestionUpdate;
  const onShowPhotoRef = useRef(onShowPhoto);
  onShowPhotoRef.current = onShowPhoto;
  const onPreferredNameUpdateRef = useRef(onPreferredNameUpdate);
  onPreferredNameUpdateRef.current = onPreferredNameUpdate;

  // Tracks who is currently speaking (set by identifySpeaker tool)
  const currentSpeakerRef = useRef<string | null>(null);

  // Current date/time string built at session start, used by time tools
  const currentDateTimeRef = useRef<string>('');

  // Latest messages snapshot for post-session analysis
  const messagesLatestRef = useRef<Message[]>([]);

  // Latest session ID for post-session analysis (VC may clear it before onSessionEnd fires)
  const sessionIdForAnalysisRef = useRef<string | null>(null);

  // ---------------------------------------------------------------------------
  // Local state
  // ---------------------------------------------------------------------------

  const [isBotSpeaking, setIsBotSpeaking] = useState(false);
  const [connectivityWarning, setConnectivityWarning] = useState<string | null>(null);
  // True after onSessionEnd fires; reset to false when startSession is called.
  const [sessionCompleted, setSessionCompleted] = useState(false);

  // Mirror isBotSpeaking into a ref so the endSession poll loop sees live
  // updates instead of the stale value captured when onSessionEndRequest fired.
  const isBotSpeakingRef = useRef(false);
  useEffect(() => {
    isBotSpeakingRef.current = isBotSpeaking;
  }, [isBotSpeaking]);

  // Whether an endSession tool call is in progress (waiting for bot audio to finish)
  const endingRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Tool list — only changes when promptPhotos changes
  // ---------------------------------------------------------------------------

  const tools: FunctionDeclaration[] = useMemo(() => [
    updateQuestionStatusTool,
    reportEmotionalObservationTool,
    setPreferredNameTool,
    identifySpeakerTool,
    recordFactTool,
    searchContextTool,
    getBiographyTool,
    getQuestionFindingsTool,
    searchPlaceTool,
    getDistanceTool,
    getJokeTool,
    getWeatherTool,
    wikipediaTool,
    computeTimeDifferenceTool,
    computeTimeOffsetTool,
    ...(promptPhotos && promptPhotos.length > 0 ? [showPhotoTool] : []),
    // Note: endSession is injected by VoiceCommon's useSession automatically
  ], [promptPhotos]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Post-session analysis (runs after VC finalizes the session)
  // ---------------------------------------------------------------------------

  const onSessionEnd = useCallback(async () => {
    setSessionCompleted(true);

    const fId = familyIdRef.current;
    const dId = dossierIdRef.current;
    const stUid = storytellerUidRef.current;
    const d = dossierRef.current;
    const qs = questionsRef.current;
    const msgs = messagesLatestRef.current;
    const sid = sessionIdForAnalysisRef.current;

    if (!sid || msgs.length === 0) return;

    const transcriptEntries: TranscriptEntry[] = msgs
      .filter((m) => m.role === 'user' || m.role === 'bot')
      .map((m, idx) => ({
        role: m.role as 'user' | 'bot',
        text: m.text,
        timestamp: Timestamp.fromDate(m.timestamp),
        messageIndex: idx,
      }));

    if (transcriptEntries.length === 0) return;

    // Run post-session analysis non-blocking so the UI can reflect completion
    (async () => {
      try {
        const existingEvents = await getEvents(fId, dId).catch(() => []);
        const [events, engagement, suggestedQs, profileSummary] = await Promise.all([
          extractEvents(transcriptEntries, sid, existingEvents).catch(() => []),
          assessEngagement(transcriptEntries, qs).catch(() => null),
          suggestQuestions(transcriptEntries, qs, d).catch(() => []),
          generateProfileSummary(transcriptEntries, qs, d).catch(() => ''),
        ]);
        const familyEvents = events.map((e) => ({
          familyId: fId,
          title: e.title,
          ...(e.date != null && { date: e.date }),
          description: e.description,
          storytellerUids: [stUid],
          sessionIds: [sid],
          createdBy: stUid,
          messageReferences: (e.sources?.[0]?.entryIndices ?? []).map((idx) => ({
            sessionId: sid,
            dossierId: dId,
            messageIndex: idx,
          })),
        }));
        await Promise.all([
          events.length > 0 ? saveExtractedEvents(fId, dId, events) : Promise.resolve(),
          familyEvents.length > 0 ? saveFamilyEvents(fId, familyEvents) : Promise.resolve(),
          engagement ? saveEngagementAssessment(fId, dId, sid, engagement) : Promise.resolve(),
          suggestedQs.length > 0 ? saveSuggestedQuestions(fId, dId, sid, suggestedQs) : Promise.resolve(),
          profileSummary ? saveProfileSummary(fId, dId, profileSummary) : Promise.resolve(),
        ]);
        console.log(`[PostSession] Analysis complete: ${events.length} events, ${suggestedQs.length} suggestions, profile ${profileSummary ? 'updated' : 'unchanged'}`);
      } catch (err) {
        console.error('[PostSession] Analysis failed:', err);
      }
    })();
  }, []); // all values read from refs

  // ---------------------------------------------------------------------------
  // Tool call dispatch
  // ---------------------------------------------------------------------------

  const onToolCall = useCallback(async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> => {
    const fId = familyIdRef.current;
    const dId = dossierIdRef.current;
    const d = dossierRef.current;

    switch (name) {
      case 'updateQuestionStatus': {
        const { id, status, findings } = args as { id: string; status: string; findings?: string };
        // The model occasionally invents question IDs. Validate against the
        // loaded Story Queue before writing: an unknown ID would otherwise
        // throw an uncaught "No document to update" rejection (onQuestionUpdate
        // → updateQuestion) and create a phantom doc (setDoc merge). Return an
        // informative result so the model stops inventing IDs.
        if (!questionsRef.current.some((q) => q.id === id)) {
          console.warn(`[Session] updateQuestionStatus: unknown Story Queue question id "${id}"; ignoring.`);
          return `No Story Queue question exists with id "${id}". Only use ids from the provided story queue; do not invent ids.`;
        }
        onQuestionUpdateRef.current(id, status, findings);
        updateQuestionStateInFirestore(fId, dId, id, status, findings ?? '').catch(
          (err) => console.error('[Firestore] Question update error:', err),
        );
        return 'ok';
      }

      case 'showPhoto': {
        const { photoId } = args as { photoId: string };
        const photos = promptPhotosRef.current;
        const photo = photos?.find((p) => p.id === photoId);
        if (photo) {
          onShowPhotoRef.current?.(photoId);
          return `Showing photo: ${photo.caption}`;
        }
        return 'Photo not found.';
      }

      case 'identifySpeaker': {
        const { speakerLabel } = args as { speakerLabel?: string };
        currentSpeakerRef.current = speakerLabel ?? null;
        console.log(`[Session] Speaker identified: "${speakerLabel ?? 'primary storyteller'}"`);
        return 'ok';
      }

      case 'setPreferredName': {
        const { name } = args as { name: string };
        console.log(`[Session] AI recorded preferred name: "${name}"`);
        onPreferredNameUpdateRef.current?.(name);
        return 'ok';
      }

      case 'reportEmotionalObservation': {
        const { mood, confidence, trigger, recommendation } = args as {
          mood: string;
          confidence: string;
          trigger?: string;
          recommendation?: string;
        };
        const sid = sessionIdForAnalysisRef.current;
        if (sid) {
          logEmotionalObservation(fId, dId, sid, {
            mood,
            confidence,
            ...(trigger ? { trigger } : {}),
            ...(recommendation ? { recommendation } : {}),
          }).catch(
            (err) => console.error('[Firestore] Emotion log error:', err),
          );
        }
        return 'ok';
      }

      case 'recordFact': {
        const { text, isCorrection, correctionNote } = args as {
          text: string;
          isCorrection: boolean;
          correctionNote?: string;
        };
        const activeSpeaker = currentSpeakerRef.current;
        console.log(`[Session] AI recording fact (isCorrection=${isCorrection}${activeSpeaker ? `, speaker=${activeSpeaker}` : ''}): ${text}`);
        saveMiscFact(fId, dId, {
          text,
          isCorrection: Boolean(isCorrection),
          ...(correctionNote ? { correctionNote } : {}),
          ...(activeSpeaker ? { speakerLabel: activeSpeaker } : {}),
          source: 'talk',
        }).catch((err) => console.error('[Session] saveMiscFact error:', err));
        return 'ok';
      }

      case 'searchWikipedia': {
        const { question, maxChunks, maxAgeDays } = args as {
          question: string;
          maxChunks?: number;
          maxAgeDays?: number;
        };
        console.log(`[Session] AI searching Wikipedia: "${question}"`);
        return await searchWikipedia({ question, maxChunks, maxAgeDays });
      }

      case 'searchPlace': {
        const { query } = args as { query: string };
        console.log(`[Session] AI searching place: "${query}"`);
        return await searchPlace(query);
      }

      case 'getDistanceBetweenPlaces': {
        const { placeA, placeB } = args as { placeA: string; placeB: string };
        console.log(`[Session] AI calculating distance: "${placeA}" → "${placeB}"`);
        return await getDistanceBetweenPlaces(placeA, placeB);
      }

      case 'getJoke': {
        console.log('[Session] AI fetching joke');
        return await getJoke();
      }

      case 'getWeather': {
        const { location } = args as { location: string };
        console.log(`[Session] AI checking weather for: "${location}"`);
        return await getWeather(location);
      }

      case 'searchContext': {
        const { query, topK = 4 } = args as { query: string; topK?: number };
        console.log(`[Session] AI searching family context: "${query}"`);
        return await searchContext(query, topK, fId);
      }

      case 'getBiography': {
        const bio = dossierRef.current?.storytellerContext?.trim();
        console.log('[Session] AI requested full biography');
        return bio && bio.length > 0
          ? bio
          : 'No detailed biography is on record for this storyteller.';
      }

      case 'getQuestionFindings': {
        const { questionId } = args as { questionId: string };
        const q = questionsRef.current.find((x) => x.id === questionId);
        console.log(`[Session] AI requested findings for question ${questionId}`);
        if (!q) return 'No matching Story Queue question found for that id.';
        const f = q.findings?.trim();
        return f && f.length > 0
          ? `Findings so far for "${q.text}": ${f}`
          : `Nothing has been recorded yet for "${q.text}".`;
      }

      case 'computeTimeDifference': {
        const { dateA, dateB, currentDateTime } = args as {
          dateA: string;
          dateB: string;
          currentDateTime?: string;
        };
        console.log(`[Session] AI computing time difference: "${dateA}" vs "${dateB}"`);
        return await getTimeDifference(dateA, dateB, currentDateTime ?? currentDateTimeRef.current);
      }

      case 'computeTimeOffset': {
        const { date, offset, currentDateTime } = args as {
          date: string;
          offset: string;
          currentDateTime?: string;
        };
        console.log(`[Session] AI computing time offset: "${offset}" from "${date}"`);
        return await getTimeOffset(date, offset, currentDateTime ?? currentDateTimeRef.current);
      }

      default:
        console.warn(`[Session] Unknown tool: ${name}`);
        return 'Tool not available.';
    }
  }, []); // all values read from refs

  // ---------------------------------------------------------------------------
  // VoiceCommon session
  // ---------------------------------------------------------------------------

  const vcSession = useSession({
    userId: storytellerUid,
    // Placeholder until startSession computes the real instruction async.
    // The override params on startSession() bypass this before connecting.
    systemInstruction: '',
    tools,
    sessionsCollection,
    additionalSessionData: { storytellerUid },
    onToolCall,
    onSessionEndRequest: () => {
      // AI called endSession — wait for bot audio to finish, then stop.
      // Cap waits aggressively: 10s max total, and read isBotSpeaking via ref
      // so each poll sees the live value (not a closure-captured stale one).
      if (endingRef.current) return;
      endingRef.current = true;
      console.log('[Session] AI called endSession — waiting for closing audio');
      const deadline = Date.now() + 10_000;
      const waitForAudio = () => {
        if (!isBotSpeakingRef.current || Date.now() > deadline) {
          endingRef.current = false;
          console.log('[Session] endSession: stopping session now');
          void vcSession.stopSession();
        } else {
          setTimeout(waitForAudio, 200);
        }
      };
      setTimeout(waitForAudio, 500);
    },
    onSessionEnd,
    onBotSpeaking: setIsBotSpeaking,
    // Route VC's audio archival through LegacyBot's family/dossier path so
    // storage rules scoped to `{familyId}/{dossierId}/{sessionId}.webm` pass.
    // VC's default path (`sessions/{userId}/...`) is not permitted here.
    archiveAudio: async (blob, _uid, sessionId) => {
      const fId = familyIdRef.current;
      const dId = dossierIdRef.current;
      if (!fId || !dId) {
        console.warn('[Session] archiveAudio called before familyId/dossierId ready; skipping upload');
        return '';
      }
      return archiveAudioToGCS(blob, fId, dId, sessionId);
    },
    speechConfig: dossier ? {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: dossier.selectedVoice },
      },
    } : undefined,
    // How patiently the interviewer waits before stepping in when the
    // storyteller pauses. Configured per-dossier in seconds; default 1.5s.
    endOfSpeechSilenceMs: Math.round((dossier?.responseWaitSeconds ?? 1.5) * 1000),
    // Storytellers often pause mid-thought while recalling. In 'manual' mode we
    // drive turn boundaries client-side (bot waits responseWaitSeconds of real
    // silence). In 'auto' mode we fall back to Gemini's server VAD with LOW
    // end-of-speech sensitivity so it's at least less eager to grab the turn.
    // See TURN_MODE at the top of this file to switch.
    endOfSpeechSensitivity: 'LOW',
    manualTurnControl: TURN_MODE === 'manual',
  });

  // Keep messagesLatestRef and sessionIdForAnalysisRef up to date
  useEffect(() => {
    messagesLatestRef.current = vcSession.messages;
  }, [vcSession.messages]);

  useEffect(() => {
    if (vcSession.sessionId) sessionIdForAnalysisRef.current = vcSession.sessionId;
  }, [vcSession.sessionId]);

  // ---------------------------------------------------------------------------
  // Wrapped startSession — loads context then calls VC with override params
  // ---------------------------------------------------------------------------

  const startSession = useCallback(async () => {
    const fId = familyIdRef.current;
    const dId = dossierIdRef.current;
    const d = dossierRef.current;
    const qs = questionsRef.current;

    setConnectivityWarning(null);
    setSessionCompleted(false);
    endingRef.current = false;
    currentSpeakerRef.current = null;

    const currentDateTime = new Date().toLocaleString(navigator.language, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
    currentDateTimeRef.current = currentDateTime;

    // Load context needed to build the system instruction.
    // All fetches have individual fallbacks so a partial failure degrades
    // gracefully rather than blocking the session from starting.
    let completedSessionCount = 0;
    let previousSessionSummary: string | undefined;
    let lastSessionDate: Date | undefined;
    let recentSessionDates: Date[] = [];

    const loadStart = Date.now();
    try {
      [completedSessionCount, previousSessionSummary, lastSessionDate, recentSessionDates] =
        await Promise.all([
          Promise.race([
            getCompletedSessionCount(fId, dId),
            new Promise<number>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5_000)),
          ]).catch(() => 0),
          getPreviousSessionSummary(fId, dId).catch(() => undefined),
          getLastSessionDate(fId, dId).catch(() => undefined),
          getRecentSessionDates(fId, dId).catch(() => [] as Date[]),
        ]);

      const latency = Date.now() - loadStart;
      console.log(`[Session] Firestore context fetch: ${latency}ms`);
      if (latency > 500) {
        setConnectivityWarning(
          `Your connection seems slow (${Math.round(latency)}ms latency). The session may experience interruptions.`,
        );
      }
    } catch {
      setConnectivityWarning(
        'Network connectivity issue detected. The session may be unreliable — check your internet connection.',
      );
    }

    const systemInstruction = buildSessionInstruction({
      dossier: d,
      questions: qs,
      familyTree: familyTreeRef.current,
      promptPhotos: promptPhotosRef.current,
      completedSessionCount,
      previousSessionSummary,
      lastSessionDate,
      preferredName: d.preferredName,
      currentDateTime,
      recentSessionDates,
    });

    const greetingTrigger =
      completedSessionCount === 0
        ? `[First session with ${d.storytellerName}. Introduce yourself and begin as instructed.]`
        : `[Returning session #${completedSessionCount + 1} with ${d.storytellerName}. Welcome them back as instructed and continue their story.]`;

    console.log('[Session] currentDateTime:', currentDateTime);

    // System-instruction size diagnostic. Native-audio greeting-restart /
    // repeating correlates with large prompts (#1197), so we keep the prompt
    // lean and log the total plus the biggest remaining dynamic contributors
    // to watch for regressions. Prior-session transcripts, events, and misc
    // facts are no longer inlined — the bot retrieves them via searchContext.
    const storyQueueChars = JSON.stringify(
      qs.map((q) => ({ id: q.id, text: q.text, status: q.status })),
    ).length;
    const profileChars = (d.profileSummary ?? d.storytellerContext ?? '').length;
    console.log(
      `[Session] System instruction: ${systemInstruction.length} chars ` +
        `(profile=${profileChars}${d.profileSummary ? '' : ' [full bio, no summary yet]'}, ` +
        `storyQueue=${storyQueueChars} chars / ${qs.length} questions, ` +
        `familyTree=${(familyTreeRef.current ?? d.familyTree ?? []).length} members)`,
    );

    await vcSession.startSession(systemInstruction, greetingTrigger);
  }, [vcSession]); // eslint-disable-line react-hooks/exhaustive-deps

  // familyTree also needs a ref so it's available in the startSession callback
  const familyTreeRef = useRef(familyTree);
  familyTreeRef.current = familyTree;

  // ---------------------------------------------------------------------------
  // Manual reconnect — useful when VC's auto-reconnect exhausts its 3 attempts
  // and the UI shows a "reconnect" button. Simply restarts a fresh session.
  // ---------------------------------------------------------------------------

  const reconnectSession = useCallback(async () => {
    console.log('[Session] Manual reconnect requested');
    await startSession();
  }, [startSession]);

  // flushPartialSession — stub in this architecture; VC handles cleanup via
  // auto-reconnect or stop. Kept for interface compatibility.
  const flushPartialSession = useCallback(() => {
    console.log('[Session] flushPartialSession called — no-op in VC-backed session');
  }, []);

  const clearDeviceError = useCallback(() => {
    // VC surfaces device errors via the `error` field. There's no separate
    // clearDeviceError in VC's return, so we just log it. The error state
    // resets automatically when startSession is called next.
    console.log('[Session] clearDeviceError — error will clear on next startSession');
  }, []);

  const dismissConnectivityWarning = useCallback(() => setConnectivityWarning(null), []);

  // Map VC's connectionStatus to LB's richer enum. The enum values are the same
  // strings so the cast is safe. COMPLETED is added when onSessionEnd fires.
  const status: ConnectionStatus = sessionCompleted
    ? ConnectionStatus.COMPLETED
    : (vcSession.connectionStatus as unknown as ConnectionStatus);

  return {
    status,
    messages: vcSession.messages,
    isBotSpeaking,
    sessionId: vcSession.sessionId,
    deviceError: vcSession.error,
    connectivityWarning,
    clearDeviceError,
    dismissConnectivityWarning,
    startSession,
    reconnectSession,
    stopSession: vcSession.stopSession,
    flushPartialSession,
  };
}
