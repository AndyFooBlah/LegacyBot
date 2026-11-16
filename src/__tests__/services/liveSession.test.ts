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
 * The interview session's Live setup, checked offline.
 *
 * `buildLiveConnectConfig` is the function VoiceCommon's `useSession` calls
 * to build the `config` it hands `ai.live.connect` (VoiceCommon's own tests
 * prove the hook passes its output through unchanged). So feeding it the
 * app's real inputs, built by the app's real builders for the fictional
 * Furtado family, gives the exact setup a production session sends, and this
 * file pins it. A model swap, a stray thinking level, a changed VAD setting
 * or a dropped tool fails here before it can reach a storyteller.
 *
 * The same inputs are run against the real API by `npm run test:live`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  LiveConfigError,
  buildLiveConnectConfig,
  getLiveModelInfo,
} from '@andyfooblah/voice-common';
import { LIVE_MODEL, LIVE_THINKING_LEVEL } from '../../services/gemini';
import {
  DEFAULT_RESPONSE_WAIT_SECONDS,
  TURN_MODE,
  buildGreetingTrigger,
  buildSessionLiveOptions,
  buildSessionTools,
} from '../../services/liveSession';
import { buildFurtadoSessionInputs } from '../live/furtadoSession';
import type { FurtadoSessionInputs } from '../live/furtadoSession';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** What `useSession` does with the options: the same call, the same fields. */
function connectConfigFor(inputs: FurtadoSessionInputs) {
  const o = inputs.liveOptions;
  return buildLiveConnectConfig({
    model: o.liveModel,
    systemInstruction: inputs.systemInstruction,
    tools: inputs.tools,
    thinkingLevel: o.thinkingLevel,
    speechConfig: o.speechConfig,
    manualTurnControl: o.manualTurnControl,
    endOfSpeechSilenceMs: o.endOfSpeechSilenceMs,
    endOfSpeechSensitivity: o.endOfSpeechSensitivity,
  });
}

const SESSION_TOOL_NAMES = [
  'updateQuestionStatus',
  'reportEmotionalObservation',
  'setPreferredName',
  'identifySpeaker',
  'recordFact',
  'searchContext',
  'getBiography',
  'getQuestionFindings',
  'searchPlace',
  'getDistanceBetweenPlaces',
  'getJoke',
  'getWeather',
  'searchWikipedia',
  'computeTimeDifference',
  'computeTimeOffset',
];

describe('buildSessionLiveOptions', () => {
  it('uses the model constant, auto thinking, the dossier voice and its patience', () => {
    expect(buildSessionLiveOptions({ selectedVoice: 'Kore', responseWaitSeconds: 3 })).toEqual({
      liveModel: LIVE_MODEL,
      thinkingLevel: 'auto',
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      endOfSpeechSilenceMs: 3000,
      endOfSpeechSensitivity: 'LOW',
      manualTurnControl: false,
    });
  });

  it('falls back to the 1.5 s default wait when the dossier has none', () => {
    expect(DEFAULT_RESPONSE_WAIT_SECONDS).toBe(1.5);
    expect(buildSessionLiveOptions({ selectedVoice: 'Puck' }).endOfSpeechSilenceMs).toBe(1500);
  });

  it('rounds fractional seconds to whole milliseconds', () => {
    expect(buildSessionLiveOptions({ selectedVoice: 'Puck', responseWaitSeconds: 2.3456 }).endOfSpeechSilenceMs).toBe(2346);
  });

  it('sends no voice before the dossier has loaded', () => {
    const options = buildSessionLiveOptions(undefined);
    expect(options.speechConfig).toBeUndefined();
    expect(options.liveModel).toBe(LIVE_MODEL);
    expect(options.endOfSpeechSilenceMs).toBe(1500);
  });

  it("the app runs in 'auto' turn mode; 'manual' is the supported alternative", () => {
    expect(TURN_MODE).toBe('auto');
    expect(buildSessionLiveOptions({ selectedVoice: 'Kore' }).manualTurnControl).toBe(false);
    expect(buildSessionLiveOptions({ selectedVoice: 'Kore' }, 'manual').manualTurnControl).toBe(true);
  });
});

describe('buildSessionTools', () => {
  it('declares the fifteen session tools, in order, without endSession', () => {
    expect(buildSessionTools(false).map((t) => t.name)).toEqual(SESSION_TOOL_NAMES);
  });

  it('adds showPhoto only when the dossier has prompt photos', () => {
    expect(buildSessionTools(true).map((t) => t.name)).toEqual([...SESSION_TOOL_NAMES, 'showPhoto']);
  });

  it('every declaration has a description and an object schema, and none asks for BLOCKING', () => {
    for (const tool of buildSessionTools(true)) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.parameters?.type, tool.name).toBe('OBJECT');
      // A BLOCKING declaration is rejected at setup by models that only run
      // tools asynchronously; the session does not depend on it.
      expect((tool as { behavior?: string }).behavior, tool.name).toBeUndefined();
    }
  });
});

describe('buildGreetingTrigger', () => {
  it('cues a first session and a returning session differently', () => {
    expect(buildGreetingTrigger(0, 'Teodoro Furtado')).toBe(
      '[First session with Teodoro Furtado. Introduce yourself and begin as instructed.]',
    );
    expect(buildGreetingTrigger(5, 'Teodoro Furtado')).toBe(
      '[Returning session #6 with Teodoro Furtado. Welcome them back as instructed and continue their story.]',
    );
  });
});

describe('the Live setup a session sends (buildLiveConnectConfig on the real inputs)', () => {
  const inputs = buildFurtadoSessionInputs('returning');
  const config = connectConfigFor(inputs);

  it('is exactly this, for a returning session with server VAD', () => {
    expect(inputs.liveOptions.liveModel).toBe(LIVE_MODEL);
    expect(config).toEqual({
      systemInstruction: { parts: [{ text: inputs.systemInstruction }] },
      responseModalities: ['AUDIO'],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: [...buildSessionTools(false), expect.objectContaining({ name: 'endSession' })] }],
      realtimeInputConfig: {
        automaticActivityDetection: {
          startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
          endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
          // The fixture dossier asks for a 3 s wait.
          silenceDurationMs: 3000,
        },
      },
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      // {} starts a fresh resumable session: a dropped connection resumes
      // with full context and the recording continues uninterrupted.
      sessionResumption: {},
      contextWindowCompression: { slidingWindow: {} },
    });
  });

  it('carries the thinking config the registry says the model accepts', () => {
    const info = getLiveModelInfo(LIVE_MODEL)!;
    if (info.thinking.support === 'rejected') {
      expect(config).not.toHaveProperty('thinkingConfig');
    } else if (info.thinking.support === 'required') {
      expect(config.thinkingConfig?.thinkingLevel).toBe(info.thinking.autoLevel);
    }
  });

  it("'auto' thinking gives the same setup as the previous hand-set 'none'", () => {
    // This is the proof that replacing thinkingLevel: 'none' with 'auto'
    // changed nothing for the current model.
    expect(LIVE_THINKING_LEVEL).toBe('auto');
    const o = inputs.liveOptions;
    const withNone = buildLiveConnectConfig({
      model: o.liveModel,
      systemInstruction: inputs.systemInstruction,
      tools: inputs.tools,
      thinkingLevel: 'none',
      speechConfig: o.speechConfig,
      manualTurnControl: o.manualTurnControl,
      endOfSpeechSilenceMs: o.endOfSpeechSilenceMs,
      endOfSpeechSensitivity: o.endOfSpeechSensitivity,
    });
    expect(config).toEqual(withNone);
  });

  it('a thinking level the model rejects fails before connecting, not as a 1007 close', () => {
    const info = getLiveModelInfo(LIVE_MODEL)!;
    if (info.thinking.support !== 'rejected') return;
    expect(() =>
      buildLiveConnectConfig({ model: LIVE_MODEL, systemInstruction: 'x', thinkingLevel: 'MINIMAL' }),
    ).toThrow(LiveConfigError);
  });

  it("follows the dossier's responseWaitSeconds", () => {
    const patient = connectConfigFor(buildFurtadoSessionInputs('returning', { responseWaitSeconds: 5 }));
    expect(patient.realtimeInputConfig?.automaticActivityDetection?.silenceDurationMs).toBe(5000);
    const unset = connectConfigFor(buildFurtadoSessionInputs('returning', { responseWaitSeconds: null }));
    expect(unset.realtimeInputConfig?.automaticActivityDetection?.silenceDurationMs).toBe(1500);
  });

  it("in 'manual' turn mode the server's VAD is off and nothing else changes", () => {
    const manual = connectConfigFor(buildFurtadoSessionInputs('returning', { turnMode: 'manual' }));
    expect(manual.realtimeInputConfig).toEqual({ automaticActivityDetection: { disabled: true } });
    expect({ ...manual, realtimeInputConfig: null }).toEqual({ ...config, realtimeInputConfig: null });
  });

  it('the first-session and full-biography instructions build valid setups too', () => {
    const first = buildFurtadoSessionInputs('first-session');
    expect(first.systemInstruction).toContain('MANDATORY START (FIRST SESSION)');
    expect(connectConfigFor(first).systemInstruction).toEqual({ parts: [{ text: first.systemInstruction }] });

    const full = buildFurtadoSessionInputs('returning-full-biography');
    // The size production reaches when a long biography is inlined (the
    // range seen in production is roughly 14,000 to 35,000 characters).
    expect(full.systemInstruction.length).toBeGreaterThan(14_000);
    expect(full.systemInstruction.length).toBeLessThan(40_000);
    expect(full.systemInstruction).toContain('MANDATORY START (RETURNING SESSION');
    const declared = connectConfigFor(full).tools?.[0];
    expect(
      (declared as { functionDeclarations: { name?: string }[] }).functionDeclarations.map((t) => t.name),
    ).toEqual([...SESSION_TOOL_NAMES, 'showPhoto', 'endSession']);
  });
});

describe('services/liveSession.ts stays loadable in plain Node', () => {
  it('imports no React, DOM or Firebase module', () => {
    const source = fs.readFileSync(path.resolve(HERE, '../../services/liveSession.ts'), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['../types', './gemini', '@andyfooblah/knowledge-common', '@google/genai', '@google/genai'].sort());
  });
});
