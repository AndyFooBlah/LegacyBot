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
 * LIVE: the opening greeting arrives exactly once.
 *
 * A doubled greeting (the bot greets, then starts over and greets again) is
 * a known historical defect of native-audio Live models with a large system
 * instruction (google-gemini/cookbook#1197), and it is the first thing a
 * storyteller hears. This test sends the largest instruction production
 * builds (a returning session with a full biography inlined, about 29,000
 * characters for the fictional family), then the same opening cue the app
 * sends, and listens.
 *
 * It mirrors what the app does on the wire: no microphone audio reaches the
 * model while the greeting plays (VoiceCommon mutes the mic to Gemini until
 * the greeting has drained), then the microphone opens. Here the "room" is
 * digital silence, so a second greeting can only be the model's own doing.
 * Tool calls the model makes while opening are answered, as the app would:
 * on this model a tool call ends the turn at once and the bot speaks again
 * when the result arrives, so "the greeting" is everything up to the point
 * where the bot has finished a turn and stayed quiet (see `runGreeting`).
 */

import { it } from 'vitest';
import { LiveTestSession, formatLiveTrace } from '@andyfooblah/voice-common/testing';
import { LIVE_MODEL } from '../../services/gemini';
import { buildFurtadoSessionInputs } from './furtadoSession';
import type { InstructionVariant } from './furtadoSession';
import { answerPendingToolCalls, customCheck, describeLive, runGreeting, targetFor } from './liveEnv';

/** How long the open microphone stays silent after the greeting. */
const LISTEN_AFTER_GREETING_MS = 10_000;

function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

async function greetOnce(variant: InstructionVariant) {
  const inputs = buildFurtadoSessionInputs(variant);
  const target = targetFor(inputs);
  const botName = inputs.dossier.selectedVoice;
  const session = await LiveTestSession.connect({ apiKey: target.apiKey, model: target.model, config: target.config });
  try {
    // The cue goes out as realtime text, as useSession sends autoGreetText.
    const opening = await runGreeting(session, inputs.greetingTrigger);

    // The mic opens: ten seconds of a silent room. Longer than any wait a
    // dossier configures, so a model that was going to restart has time to.
    const lateToolCalls: string[] = [];
    const deadline = Date.now() + LISTEN_AFTER_GREETING_MS;
    while (Date.now() < deadline) {
      await session.sendSilence(500);
      lateToolCalls.push(...answerPendingToolCalls(session, opening.since));
    }
    const after = session.outputText(opening.settled).trim();
    const audioAfterBytes = session.audioBytes(opening.settled);

    const whole = `${opening.greeting} ${after}`;
    // The bot introduces itself by the voice's name; hearing the name twice,
    // or two salutations, is the doubled greeting.
    const nameMentions = count(whole, new RegExp(`\\b${botName}\\b`, 'gi'));
    const salutations = count(whole, /\b(?:hi|hello|welcome back)\b/gi);
    const metrics = {
      instructionChars: inputs.systemInstruction.length,
      firstAudioMs: opening.firstAudioMs,
      openingChars: opening.greeting.length,
      opening: opening.greeting.slice(0, 90),
      botNameMentions: nameMentions,
      salutations,
      toolCallsWhileOpening: opening.toolCalls.join(','),
      turnCompletesWhileOpening: opening.turnCompletes,
      audioBytesAfterOpening: audioAfterBytes,
      saidAfterOpening: after.slice(0, 60),
      toolCallsAfterOpening: lateToolCalls.join(','),
    };

    if (opening.greeting.length === 0) throw new Error('the bot produced audio but no greeting transcript');
    if (nameMentions > 1 || salutations > 1) {
      throw new Error(
        `DOUBLED GREETING: the bot greeted more than once ("${whole.slice(0, 200)}") ` +
          `[${JSON.stringify(metrics)}]\n  ${formatLiveTrace(session.trace, 60).join('\n  ')}`,
      );
    }
    if (nameMentions === 0) {
      throw new Error(`the greeting does not introduce the bot as ${botName}: "${opening.greeting.slice(0, 200)}"`);
    }
    if (after.length > 0) {
      // Speaking again into a silent room is not a doubled greeting, but the
      // instruction says to greet once and wait, so it is worth seeing.
      return { status: 'warn' as const, detail: `greeted once, then spoke again unprompted during ${LISTEN_AFTER_GREETING_MS / 1000} s of silence: "${after.slice(0, 80)}"`, metrics };
    }
    return { detail: `greeted once ("${opening.greeting.slice(0, 60)}") and then waited through ${LISTEN_AFTER_GREETING_MS / 1000} s of silence`, metrics };
  } finally {
    await session.close();
  }
}

describeLive(`live: the greeting arrives exactly once on ${LIVE_MODEL}`, () => {
  it('returning session with a full biography inlined (the largest instruction production builds)', async () => {
    await customCheck('greeting / returning-full-biography', 'greeting-once', () => greetOnce('returning-full-biography'));
  });

  it('returning session with the usual lean instruction', async () => {
    await customCheck('greeting / returning', 'greeting-once', () => greetOnce('returning'));
  });

  it('first session', async () => {
    await customCheck('greeting / first-session', 'greeting-once', () => greetOnce('first-session'));
  });
});
