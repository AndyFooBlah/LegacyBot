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
 * LIVE: turn-taking with the app's real settings.
 *
 * Storytellers pause for a long time while remembering. The interviewer's
 * patience is `Dossier.responseWaitSeconds`, sent to the server as
 * `silenceDurationMs` with LOW end-of-speech sensitivity (TURN_MODE 'auto').
 * These tests check the server honours it for the default wait and for a
 * long one, and that the supported 'manual' mode (client-driven turns) works
 * with the same production instruction and tools.
 *
 * The audio is clean synthetic speech with digital silence in the pause. It
 * shows the setting reaches the server and is obeyed; it does not reproduce
 * a noisy room (see TESTING.md, Limitations).
 */

import { it } from 'vitest';
import {
  checkAudioTurn,
  checkBargeIn,
  checkLatency,
  checkManualTurnControl,
  checkPatience,
  checkSetupAccepted,
  checkToolRoundTrip,
} from '@andyfooblah/voice-common/testing';
import { LIVE_MODEL } from '../../services/gemini';
import { DEFAULT_RESPONSE_WAIT_SECONDS } from '../../services/liveSession';
import { buildFurtadoSessionInputs } from './furtadoSession';
import { describeLive, expectCheck, targetFor } from './liveEnv';

const LONG_WAIT_SECONDS = 5;

describeLive(`live: patience under server VAD on ${LIVE_MODEL}`, () => {
  it(`the default wait (${DEFAULT_RESPONSE_WAIT_SECONDS} s): a pause shorter than the wait is one turn, and the bot stays silent through it`, async () => {
    const inputs = buildFurtadoSessionInputs('returning', { responseWaitSeconds: null });
    expectCheck(await checkPatience(targetFor(inputs)), `auto / wait=${DEFAULT_RESPONSE_WAIT_SECONDS}s (default)`);
  });

  it(`a long wait (${LONG_WAIT_SECONDS} s): a ${LONG_WAIT_SECONDS * 0.6} s pause is one turn, and the bot stays silent through it`, async () => {
    const inputs = buildFurtadoSessionInputs('returning', { responseWaitSeconds: LONG_WAIT_SECONDS });
    expectCheck(await checkPatience(targetFor(inputs), { timeoutMs: 60_000 }), `auto / wait=${LONG_WAIT_SECONDS}s`);
  });

  it('with the long wait a spoken turn is still transcribed and answered', async () => {
    const inputs = buildFurtadoSessionInputs('returning', { responseWaitSeconds: LONG_WAIT_SECONDS });
    expectCheck(await checkAudioTurn(targetFor(inputs), { timeoutMs: 60_000 }), `auto / wait=${LONG_WAIT_SECONDS}s`);
  });
});

describeLive(`live: manual turn control on ${LIVE_MODEL} (TURN_MODE 'manual')`, () => {
  const inputs = buildFurtadoSessionInputs('returning', { turnMode: 'manual' });
  const target = targetFor(inputs);
  const label = 'manual';

  it('setup is accepted with automatic activity detection disabled', async () => {
    expectCheck(await checkSetupAccepted(target), label);
  });

  it('activityStart + speech + activityEnd yields a reply', async () => {
    expectCheck(await checkManualTurnControl(target), label);
  });

  it('a tool round trip works', async () => {
    expectCheck(
      await checkToolRoundTrip(target, {
        prompt:
          'Here is something new for the record: my first job in America was at a rope walk, ' +
          'and I started there in 1959. Please note that down.',
        expectTool: 'recordFact',
        result: 'Fact recorded.',
      }),
      `${label} / recordFact`,
    );
  });

  it('barge-in interrupts the bot', async () => {
    expectCheck(await checkBargeIn(target), label);
  });

  it('latency from activityEnd to first bot audio', async () => {
    expectCheck(await checkLatency(target), label);
  });
});
