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
 * `useUnifiedSession` → VoiceCommon: what the hook really hands `useSession`.
 *
 * VoiceCommon is NOT mocked wholesale here. Only `useSession` is replaced by
 * a spy that records its options; the registry and `buildLiveConnectConfig`
 * are the real ones. The recorded options are then run through the real
 * builder, which gives the `config` VoiceCommon would pass to
 * `ai.live.connect`, and that is compared with the expected setup.
 *
 * So this fails if the hook stops using the model constant, hand-sets a
 * thinking level, changes a turn-taking option, drops a tool, or passes a
 * different instruction or greeting cue than the shared builders produce.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { UseSessionOptions } from '@andyfooblah/voice-common';
import { buildLiveConnectConfig } from '@andyfooblah/voice-common';
import { LIVE_MODEL } from '../../services/gemini';
import { buildSessionLiveOptions, buildSessionTools } from '../../services/liveSession';
import { useUnifiedSession } from '../../hooks/useUnifiedSession';
import { buildFurtadoSessionInputs, loadFurtadoDossier } from '../live/furtadoSession';

const { useSessionSpy, vcStartSession, storageMock } = vi.hoisted(() => {
  const vcStartSession = vi.fn().mockResolvedValue(undefined);
  const useSessionSpy = vi.fn((_options: unknown) => ({
    connectionStatus: 'DISCONNECTED',
    messages: [],
    sessionId: null,
    error: null,
    isRecording: false,
    startSession: vcStartSession,
    stopSession: vi.fn().mockResolvedValue(undefined),
  }));
  const storageMock = {
    getCompletedSessionCount: vi.fn(),
    getPreviousSessionSummary: vi.fn(),
    getLastSessionDate: vi.fn(),
    getRecentSessionDates: vi.fn(),
  };
  return { useSessionSpy, vcStartSession, storageMock };
});

// Partial mock: everything VoiceCommon exports stays real except the hook.
vi.mock('@andyfooblah/voice-common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@andyfooblah/voice-common')>()),
  useSession: useSessionSpy,
}));

vi.mock('../../services/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/storage')>()),
  ...storageMock,
}));

const TEO = loadFurtadoDossier();

function lastOptions(): UseSessionOptions {
  return useSessionSpy.mock.calls[useSessionSpy.mock.calls.length - 1][0] as UseSessionOptions;
}

function renderSession(overrides: Partial<Parameters<typeof useUnifiedSession>[0]> = {}) {
  return renderHook(() =>
    useUnifiedSession({
      familyId: 'fx-furtado',
      dossierId: 'fx-dossier-teo',
      storytellerUid: 'fx-teo',
      dossier: TEO.dossier,
      questions: TEO.questions,
      familyTree: TEO.familyTree,
      onQuestionUpdate: vi.fn(),
      ...overrides,
    }),
  );
}

describe('useUnifiedSession passes the shared Live settings to VoiceCommon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getCompletedSessionCount.mockResolvedValue(0);
    storageMock.getPreviousSessionSummary.mockResolvedValue(undefined);
    storageMock.getLastSessionDate.mockResolvedValue(undefined);
    storageMock.getRecentSessionDates.mockResolvedValue([]);
  });

  it('model, thinking, voice and turn-taking come from buildSessionLiveOptions', () => {
    renderSession();
    const options = lastOptions();
    const expected = buildSessionLiveOptions(TEO.dossier);
    expect(options.liveModel).toBe(LIVE_MODEL);
    expect({
      liveModel: options.liveModel,
      thinkingLevel: options.thinkingLevel,
      speechConfig: options.speechConfig,
      endOfSpeechSilenceMs: options.endOfSpeechSilenceMs,
      endOfSpeechSensitivity: options.endOfSpeechSensitivity,
      manualTurnControl: options.manualTurnControl,
    }).toEqual(expected);
    // Nothing overrides the API version VoiceCommon pins for ephemeral tokens.
    expect(options.liveApiVersion).toBeUndefined();
  });

  it('the tools are the shared declarations; showPhoto only with prompt photos', () => {
    renderSession();
    expect(lastOptions().tools).toEqual(buildSessionTools(false));

    renderSession({
      promptPhotos: [{ id: 'fx-photo-1', storageUrl: 'https://photos.example/1.jpg', caption: 'The dock', uploadedBy: 'fx-marisa', createdAt: TEO.dossier.createdAt }],
    });
    expect(lastOptions().tools).toEqual(buildSessionTools(true));
  });

  it('the setup VoiceCommon would send for these options is the expected one', async () => {
    const { result } = renderSession();
    await act(async () => {
      await result.current.startSession();
    });

    expect(vcStartSession).toHaveBeenCalledTimes(1);
    const [instruction, greeting] = vcStartSession.mock.calls[0] as [string, string];
    const options = lastOptions();

    // What useSession does with its options, using the real builder.
    const config = buildLiveConnectConfig({
      model: options.liveModel,
      systemInstruction: instruction,
      tools: options.tools,
      thinkingLevel: options.thinkingLevel ?? 'auto',
      speechConfig: options.speechConfig,
      manualTurnControl: options.manualTurnControl,
      endOfSpeechSilenceMs: options.endOfSpeechSilenceMs,
      endOfSpeechSensitivity: options.endOfSpeechSensitivity,
    });

    expect(config).not.toHaveProperty('thinkingConfig');
    expect(config).toEqual({
      systemInstruction: { parts: [{ text: instruction }] },
      responseModalities: ['AUDIO'],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: [...buildSessionTools(false), expect.objectContaining({ name: 'endSession' })] }],
      realtimeInputConfig: {
        automaticActivityDetection: {
          startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
          endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
          silenceDurationMs: 3000,
        },
      },
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      sessionResumption: {},
      contextWindowCompression: { slidingWindow: {} },
    });

    // The instruction and cue are the ones the shared builders produce for a
    // first session (the fixture helper the live suite uses builds the same).
    const fixture = buildFurtadoSessionInputs('first-session');
    expect(greeting).toBe(fixture.greetingTrigger);
    expect(instruction).toContain('MANDATORY START (FIRST SESSION)');
    expect(instruction).toContain('Greet ONCE');
    // Identical apart from the wall-clock line.
    const withoutClock = (text: string) => text.replace(/- Current date and time: .*/, '');
    expect(withoutClock(instruction)).toBe(withoutClock(fixture.systemInstruction));
  });

  it('a returning storyteller gets the returning cue and instruction', async () => {
    storageMock.getCompletedSessionCount.mockResolvedValue(5);
    storageMock.getPreviousSessionSummary.mockResolvedValue('The crossing and the rope walk');
    const { result } = renderSession();
    await act(async () => {
      await result.current.startSession();
    });
    const [instruction, greeting] = vcStartSession.mock.calls[0] as [string, string];
    expect(greeting).toBe('[Returning session #6 with Teodoro Furtado. Welcome them back as instructed and continue their story.]');
    expect(instruction).toContain('MANDATORY START (RETURNING SESSION — session #6)');
    expect(instruction).toContain('Previous session context: The crossing and the rope walk');
  });
});
