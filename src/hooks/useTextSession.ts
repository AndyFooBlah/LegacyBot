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
 * Text transport for written interviews (issue #210).
 *
 * Implements the same contract as VoiceCommon's `useSession` (messages,
 * connectionStatus, startSession, stopSession, isRecording, sessionId, error)
 * so that `useUnifiedSession` can swap it in for the voice transport and keep
 * everything else: the interviewer's instruction, its tools and their
 * handlers, and the post-session analysis. It adds `sendText` and
 * `isThinking`.
 *
 * There is no microphone, no audio and no recording. The transcript is the
 * storyteller's own typed words, saved after every turn.
 *
 * Like the voice transport, a session ends when its screen goes away.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ThinkingLevel, type FunctionDeclaration } from '@google/genai';
import { Timestamp } from 'firebase/firestore';
import {
  ConnectionStatus as TransportStatus,
  createSession,
  finalizeSession,
  syncTranscriptToFirestore,
  type Message,
  type TranscriptEntry,
} from '@andyfooblah/voice-common';
import { invokeGemini } from '../services/geminiBroker';
import { REASONING_MODEL } from '../services/gemini';
import {
  runTextTurn,
  TEXT_END_SESSION_TOOL,
  WRITTEN_MODE_ADDENDUM,
  type TextContent,
  type TextFunctionDeclaration,
  type TextTurnResult,
} from '../services/textInterview';

export interface UseTextSessionOptions {
  userId: string;
  tools: FunctionDeclaration[];
  sessionsCollection: string;
  additionalSessionData?: Record<string, unknown>;
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<string>;
  onSessionEnd?: () => void | Promise<void>;
}

export interface UseTextSessionReturn {
  messages: Message[];
  connectionStatus: TransportStatus;
  startSession: (overrideInstruction?: string, overrideAutoGreetText?: string) => Promise<void>;
  stopSession: () => Promise<void>;
  /** True while a written session is open (the name is the voice transport's). */
  isRecording: boolean;
  sessionId: string | null;
  error: string | null;
  /** Send the storyteller's message. Resolves false if it could not be answered; the caller keeps the draft. */
  sendText: (text: string) => Promise<boolean>;
  /** The interviewer is composing a reply. */
  isThinking: boolean;
}

const newId = () => Math.random().toString(36).slice(2, 11);

export function useTextSession(options: UseTextSessionOptions): UseTextSessionReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<TransportStatus>(TransportStatus.DISCONNECTED);
  const [isRecording, setIsRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const messagesRef = useRef<Message[]>([]);
  const contentsRef = useRef<TextContent[]>([]);
  const instructionRef = useRef('');
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const unmountedRef = useRef(false);

  const publish = useCallback(() => setMessages([...messagesRef.current]), []);

  const push = useCallback((m: Omit<Message, 'id' | 'timestamp'>) => {
    messagesRef.current.push({ ...m, id: newId(), timestamp: new Date() });
  }, []);

  const saveTranscript = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const entries = messagesRef.current.map((m, i) => ({
      role: m.role,
      text: m.text,
      timestamp: Timestamp.fromDate(m.timestamp),
      messageIndex: i,
      // The storyteller typed this; it was not transcribed from speech.
      ...(m.role === 'user' ? { source: 'typed' } : {}),
      ...(m.toolName ? { toolName: m.toolName, toolArgs: m.toolArgs ?? {}, toolResult: m.toolResult ?? '' } : {}),
    })) as unknown as TranscriptEntry[];
    try {
      await syncTranscriptToFirestore(sid, entries, optionsRef.current.sessionsCollection);
    } catch (err) {
      console.error('[TextSession] Transcript save failed:', err);
    }
  }, []);

  const generate = useCallback(
    (req: { systemInstruction: string; contents: TextContent[]; tools: TextFunctionDeclaration[] }) =>
      invokeGemini({
        model: REASONING_MODEL,
        contents: req.contents,
        config: {
          systemInstruction: req.systemInstruction,
          tools: [{ functionDeclarations: req.tools }],
          // A reply should arrive in a few seconds; deep reasoning is for the analysis afterwards.
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          // Thinking tokens count against this, so leave room or a reply can be cut off before it starts.
          maxOutputTokens: 4096,
          temperature: 0.7,
        },
      }),
    [],
  );

  const turn = useCallback(async (): Promise<TextTurnResult> => {
    const tools: TextFunctionDeclaration[] = [
      ...(optionsRef.current.tools as unknown as TextFunctionDeclaration[]),
      TEXT_END_SESSION_TOOL,
    ];
    const result = await runTextTurn(contentsRef.current, {
      generate,
      onToolCall: (name, args) => optionsRef.current.onToolCall(name, args),
      systemInstruction: instructionRef.current,
      tools,
    });
    for (const t of result.toolEvents) {
      push({ role: 'tool', text: t.name, toolName: t.name, toolArgs: t.args, toolResult: t.result.slice(0, 2000), toolDurationMs: t.durationMs });
    }
    push({ role: 'bot', text: result.replyText });
    publish();
    return result;
  }, [generate, publish, push]);

  const stopSession = useCallback(async () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    const sid = sessionIdRef.current;
    const seconds = Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000));
    setIsRecording(false);
    setConnectionStatus(TransportStatus.DISCONNECTED);
    try {
      await saveTranscript();
      if (sid) await finalizeSession(sid, 'completed', seconds, undefined, optionsRef.current.sessionsCollection);
    } catch (err) {
      console.error('[TextSession] Could not finalize the session:', err);
    }
    await optionsRef.current.onSessionEnd?.();
  }, [saveTranscript]);

  const startSession = useCallback(async (overrideInstruction?: string, overrideAutoGreetText?: string) => {
    if (activeRef.current || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    messagesRef.current = [];
    contentsRef.current = [];
    publish();
    setConnectionStatus(TransportStatus.CONNECTING);
    setIsThinking(true);
    let sid: string | null = null;
    try {
      const o = optionsRef.current;
      sid = await createSession(o.userId, o.sessionsCollection, { ...(o.additionalSessionData ?? {}), mode: 'chat' });
      if (unmountedRef.current) throw new Error('closed');
      sessionIdRef.current = sid;
      setSessionId(sid);
      startedAtRef.current = Date.now();
      instructionRef.current = (overrideInstruction ?? '') + WRITTEN_MODE_ADDENDUM;
      // The same nudge the voice session uses to make the interviewer open the conversation.
      contentsRef.current.push({ role: 'user', parts: [{ text: overrideAutoGreetText || 'Begin the conversation.' }] });
      activeRef.current = true;
      await turn();
      if (unmountedRef.current) { await stopSession(); return; }
      setIsRecording(true);
      setConnectionStatus(TransportStatus.CONNECTED);
      await saveTranscript();
    } catch (err) {
      console.error('[TextSession] Start failed:', err);
      activeRef.current = false;
      if (sid) {
        finalizeSession(sid, 'interrupted', 0, undefined, optionsRef.current.sessionsCollection).catch(console.error);
      }
      if (!unmountedRef.current) {
        setError('The written conversation could not be started. Please try again.');
        setConnectionStatus(TransportStatus.ERROR);
      }
    } finally {
      busyRef.current = false;
      setIsThinking(false);
    }
  }, [publish, saveTranscript, stopSession, turn]);

  const sendText = useCallback(async (text: string): Promise<boolean> => {
    const body = text.trim();
    if (!body || !activeRef.current || busyRef.current) return false;
    busyRef.current = true;
    setIsThinking(true);
    setError(null);
    const messagesBefore = messagesRef.current.length;
    const contentsBefore = contentsRef.current.length;
    push({ role: 'user', text: body });
    publish();
    contentsRef.current.push({ role: 'user', parts: [{ text: body }] });
    try {
      const result = await turn();
      await saveTranscript();
      if (result.endRequested) await stopSession();
      return true;
    } catch (err) {
      console.error('[TextSession] Turn failed:', err);
      // Take the unanswered message back out so the storyteller can send it again unchanged.
      messagesRef.current.length = messagesBefore;
      contentsRef.current.length = contentsBefore;
      publish();
      setError("That didn't go through. Your message is still in the box; please send it again.");
      return false;
    } finally {
      busyRef.current = false;
      setIsThinking(false);
    }
  }, [publish, push, saveTranscript, stopSession, turn]);

  // A session never outlives its screen (the voice transport does the same).
  const stopRef = useRef(stopSession);
  stopRef.current = stopSession;
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      void stopRef.current();
    };
  }, []);

  return { messages, connectionStatus, startSession, stopSession, isRecording, sessionId, error, sendText, isThinking };
}
