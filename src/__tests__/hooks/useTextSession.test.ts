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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { invokeGemini, createSession, finalizeSession, syncTranscriptToFirestore } = vi.hoisted(() => ({
  invokeGemini: vi.fn(),
  createSession: vi.fn(),
  finalizeSession: vi.fn(),
  syncTranscriptToFirestore: vi.fn(),
}));

vi.mock('../../services/geminiBroker', () => ({ invokeGemini }));
vi.mock('@andyfooblah/voice-common', () => ({
  ConnectionStatus: { DISCONNECTED: 'DISCONNECTED', CONNECTING: 'CONNECTING', CONNECTED: 'CONNECTED', ERROR: 'ERROR' },
  createSession,
  finalizeSession,
  syncTranscriptToFirestore,
}));
vi.mock('firebase/firestore', () => ({ Timestamp: { fromDate: (d: Date) => ({ at: d.getTime() }) } }));

import { useTextSession } from '../../hooks/useTextSession';

const reply = (t: string) => ({ text: t, candidates: [{ content: { role: 'model', parts: [{ text: t }] } }] });
const toolThen = (name: string, args: Record<string, unknown>) =>
  ({ text: '', candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] } }] });

const onToolCall = vi.fn();
const onSessionEnd = vi.fn();
const render = () => renderHook(() => useTextSession({
  userId: 'fx-teo',
  tools: [{ name: 'recordFact', description: 'Record a fact' }] as never,
  sessionsCollection: 'families/fx-furtado/dossiers/fx-dossier-teo/sessions',
  additionalSessionData: { storytellerUid: 'fx-teo' },
  onToolCall,
  onSessionEnd,
}));

beforeEach(() => {
  vi.clearAllMocks();
  createSession.mockResolvedValue('session-1');
  finalizeSession.mockResolvedValue(undefined);
  syncTranscriptToFirestore.mockResolvedValue(undefined);
  onToolCall.mockResolvedValue('Fact recorded.');
});

async function started() {
  invokeGemini.mockResolvedValueOnce(reply('Hello Teo. Where did you grow up?'));
  const h = render();
  await act(async () => { await h.result.current.startSession('BASE INSTRUCTION', 'Greet Teo.'); });
  return h;
}

describe('useTextSession', () => {
  it('opens a written session: creates the record marked as chat, and the interviewer writes first', async () => {
    const { result } = await started();
    expect(createSession).toHaveBeenCalledWith('fx-teo', 'families/fx-furtado/dossiers/fx-dossier-teo/sessions', { storytellerUid: 'fx-teo', mode: 'chat' });
    expect(result.current.connectionStatus).toBe('CONNECTED');
    expect(result.current.isRecording).toBe(true);
    expect(result.current.sessionId).toBe('session-1');
    expect(result.current.messages.map((m) => [m.role, m.text])).toEqual([['bot', 'Hello Teo. Where did you grow up?']]);
  });

  it("uses the interviewer's own instruction with the written-mode rules appended, and only function declarations as tools", async () => {
    await started();
    const req = invokeGemini.mock.calls[0][0];
    expect(req.model).toBe('gemini-3.8-flash');
    expect(req.config.systemInstruction.startsWith('BASE INSTRUCTION')).toBe(true);
    expect(req.config.systemInstruction).toMatch(/TYPED, not spoken/);
    expect(req.config.tools).toHaveLength(1);
    expect(req.config.tools[0].functionDeclarations.map((d: { name: string }) => d.name)).toEqual(['recordFact', 'endSession']);
    expect(req.contents).toEqual(expect.arrayContaining([{ role: 'user', parts: [{ text: 'Greet Teo.' }] }]));
  });

  it("answers a message, runs the interviewer's tools, and saves the transcript with typed words marked as typed", async () => {
    const { result } = await started();
    invokeGemini.mockResolvedValueOnce(toolThen('recordFact', { fact: 'Born in Capelo' })).mockResolvedValueOnce(reply('Capelo. What was the house like?'));
    let ok = false;
    await act(async () => { ok = await result.current.sendText('  In Capelo, on Faial.  '); });

    expect(ok).toBe(true);
    expect(onToolCall).toHaveBeenCalledWith('recordFact', { fact: 'Born in Capelo' });
    expect(result.current.messages.map((m) => m.role)).toEqual(['bot', 'user', 'tool', 'bot']);
    const saved = syncTranscriptToFirestore.mock.calls.at(-1)!;
    expect(saved[0]).toBe('session-1');
    expect(saved[1][1]).toMatchObject({ role: 'user', text: 'In Capelo, on Faial.', source: 'typed', messageIndex: 1 });
    expect(saved[1][0].source).toBeUndefined();
    expect(saved[1][2]).toMatchObject({ role: 'tool', toolName: 'recordFact', toolResult: 'Fact recorded.' });
  });

  it('takes an unanswered message back out and reports it, so nothing is lost or duplicated', async () => {
    const { result } = await started();
    invokeGemini.mockRejectedValueOnce(new Error('network'));
    let ok = true;
    await act(async () => { ok = await result.current.sendText('A long answer.'); });

    expect(ok).toBe(false);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.error).toMatch(/didn't go through/);
    expect(result.current.connectionStatus).toBe('CONNECTED');

    // The retry sends the same conversation, with the message once.
    invokeGemini.mockResolvedValueOnce(reply('Thank you.'));
    await act(async () => { await result.current.sendText('A long answer.'); });
    const contents = invokeGemini.mock.calls.at(-1)![0].contents as { parts: { text?: string }[] }[];
    expect(contents.filter((c) => c.parts[0]?.text === 'A long answer.')).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('ignores an empty message and a message sent before the session is open', async () => {
    const idle = render();
    await act(async () => { expect(await idle.result.current.sendText('hello')).toBe(false); });
    const { result } = await started();
    await act(async () => { expect(await result.current.sendText('   ')).toBe(false); });
    expect(invokeGemini).toHaveBeenCalledTimes(1);
  });

  it('ends when the interviewer ends it: the goodbye is shown, the session is finalized, the analysis hook fires', async () => {
    const { result } = await started();
    invokeGemini.mockResolvedValueOnce({ text: 'Rest well, Teo.', candidates: [{ content: { parts: [{ text: 'Rest well, Teo.' }, { functionCall: { name: 'endSession', args: {} } }] } }] });
    await act(async () => { await result.current.sendText('I am tired now.'); });

    expect(result.current.messages.at(-1)).toMatchObject({ role: 'bot', text: 'Rest well, Teo.' });
    expect(finalizeSession).toHaveBeenCalledWith('session-1', 'completed', expect.any(Number), undefined, 'families/fx-furtado/dossiers/fx-dossier-teo/sessions');
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
    expect(result.current.isRecording).toBe(false);
  });

  it('ends when the storyteller ends it, once', async () => {
    const { result } = await started();
    await act(async () => { await result.current.stopSession(); await result.current.stopSession(); });
    expect(finalizeSession).toHaveBeenCalledTimes(1);
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
  });

  it('ends when its screen goes away', async () => {
    const { unmount } = await started();
    await act(async () => { unmount(); });
    expect(finalizeSession).toHaveBeenCalledWith('session-1', 'completed', expect.any(Number), undefined, expect.any(String));
  });

  it('reports a failed start and marks the orphaned record interrupted', async () => {
    invokeGemini.mockRejectedValueOnce(new Error('boom'));
    const { result } = render();
    await act(async () => { await result.current.startSession('BASE', 'Greet.'); });
    expect(result.current.connectionStatus).toBe('ERROR');
    expect(result.current.error).toMatch(/could not be started/);
    expect(finalizeSession).toHaveBeenCalledWith('session-1', 'interrupted', 0, undefined, expect.any(String));
    expect(result.current.isRecording).toBe(false);
  });
});
