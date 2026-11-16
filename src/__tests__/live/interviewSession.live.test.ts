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
 * LIVE: the interview session's production configuration against the real
 * Gemini Live API.
 *
 * The profile is what `useUnifiedSession` gives VoiceCommon for the fictional
 * Furtado family's dossier: the real instruction builder (a returning
 * session), the real fifteen tool declarations, the dossier's voice, server
 * VAD with LOW end sensitivity and the dossier's 3-second wait. The connect
 * config comes from `buildLiveConnectConfig`, the function `useSession`
 * calls.
 *
 * Runs only via `npm run test:live` with GEMINI_API_KEY set. See TESTING.md.
 */

import { it } from 'vitest';
import {
  LiveTestSession,
  checkAudioTurn,
  checkBargeIn,
  checkContextWindowCompression,
  checkEphemeralToken,
  checkLatency,
  checkModelListed,
  checkSessionResumption,
  checkSetupAccepted,
  checkToolDeclarationsAccepted,
  checkToolRoundTrip,
} from '@andyfooblah/voice-common/testing';
import { LIVE_MODEL } from '../../services/gemini';
import { buildFurtadoSessionInputs } from './furtadoSession';
import type { FurtadoSessionInputs } from './furtadoSession';
import { LIVE_API_KEY, customCheck, describeLive, expectCheck, runGreeting, targetFor } from './liveEnv';

/**
 * Send the opening cue as the app does and require a spoken, transcribed
 * opening. Tool calls made on the way are answered (see `runGreeting`): a
 * returning-session opening sometimes looks something up before speaking.
 */
async function openingCue(inputs: FurtadoSessionInputs) {
  const target = targetFor(inputs);
  const session = await LiveTestSession.connect({ apiKey: target.apiKey, model: target.model, config: target.config });
  try {
    const opening = await runGreeting(session, inputs.greetingTrigger);
    if (!opening.greeting) throw new Error('the bot produced audio but no transcript');
    return {
      detail: `bot opened with "${opening.greeting.slice(0, 60)}"`,
      metrics: {
        firstAudioMs: opening.firstAudioMs,
        audioSeconds: Number((session.audioBytes(opening.since) / 48_000).toFixed(2)),
        toolCallsWhileOpening: opening.toolCalls.join(','),
        turnCompletes: opening.turnCompletes,
      },
    };
  } finally {
    await session.close();
  }
}

describeLive(`live: interview session on ${LIVE_MODEL} (returning session, server VAD, 3 s wait)`, () => {
  const inputs = buildFurtadoSessionInputs('returning');
  const target = targetFor(inputs);
  const label = 'interview / returning';

  it('setup is accepted with the production instruction, tools, voice and VAD settings', async () => {
    expectCheck(await checkSetupAccepted(target), label);
  });

  it('all sixteen tool declarations are accepted and a turn runs with them', async () => {
    expectCheck(await checkToolDeclarationsAccepted(target), label);
  });

  it('the opening cue produces a spoken greeting with a transcript', async () => {
    await customCheck(label, 'opening-cue', () => openingCue(inputs));
  });

  it('a spoken turn under the app\'s server VAD is transcribed and answered', async () => {
    expectCheck(await checkAudioTurn(target), label);
  });

  it('tool round trip: recordFact is called for a new fact and the bot carries on', async () => {
    expectCheck(
      await checkToolRoundTrip(target, {
        prompt:
          'Here is something new for the record: my first job in America was at a rope walk, ' +
          'and I started there in 1959. Please note that down.',
        expectTool: 'recordFact',
        // What onToolCall returns after saving the fact.
        result: 'Fact recorded.',
      }),
      `${label} / recordFact`,
    );
  });

  it('tool round trip: searchContext is called to recall something and the result is used', async () => {
    expectCheck(
      await checkToolRoundTrip(target, {
        prompt:
          'What was the name of the first boat I worked on, before we bought ours? ' +
          'I told you about it before. Can you look it up?',
        expectTool: 'searchContext',
        // A stubbed search result in the shape the real tool returns: plain
        // text. The fact is from the fictional family's timeline and is NOT
        // in this instruction, so a reply that names the boat used the result.
        result: 'From a previous session: Teo first went to sea in 1966, on the scalloper Estrela do Mar.',
        expectInReply: 'Estrela',
      }),
      `${label} / searchContext`,
    );
  });

  it('barge-in: speaking over the bot interrupts it', async () => {
    expectCheck(await checkBargeIn(target), label);
  });

  it('session resumption keeps the conversation across a reconnect', async () => {
    // The recording-integrity design depends on this: a dropped connection
    // resumes the same session instead of restarting the interview.
    expectCheck(await checkSessionResumption(target), label);
  });

  it('context window compression is accepted (sessions longer than 15 minutes)', async () => {
    expectCheck(await checkContextWindowCompression(target), label);
  });

  it('the model is listed with bidiGenerateContent', async () => {
    expectCheck(await checkModelListed(LIVE_API_KEY, LIVE_MODEL), label);
  });

  it('ephemeral-token path with the production config', async () => {
    expectCheck(await checkEphemeralToken(target), label);
  });

  it('latency from end of speech to first bot audio', async () => {
    expectCheck(await checkLatency(target), label);
  });
});

describeLive(`live: interview session on ${LIVE_MODEL} (first session)`, () => {
  const inputs = buildFurtadoSessionInputs('first-session');
  const target = targetFor(inputs);
  const label = 'interview / first-session';

  it('setup is accepted', async () => {
    expectCheck(await checkSetupAccepted(target), label);
  });

  it('the first-session cue produces a spoken introduction', async () => {
    await customCheck(label, 'opening-cue', () => openingCue(inputs));
  });
});
