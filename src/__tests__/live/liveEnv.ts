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
 * Shared plumbing for the live suite (`npm run test:live`).
 *
 * The key is read from the process environment and handed to the kit; it is
 * never printed or written anywhere. Each check prints one line and, when
 * LIVE_RESULTS_FILE is set, is appended to that file as a JSON line (the kit
 * redacts results) so CI can publish a table.
 */

import fs from 'node:fs';
import { describe } from 'vitest';
import { LiveWaitError, buildLiveConnectConfig, formatLiveTrace, makeRedactor } from '@andyfooblah/voice-common/testing';
import type { LiveAppProfile, LiveCheckResult, LiveCheckTarget, LiveTestSession } from '@andyfooblah/voice-common/testing';
import type { FurtadoSessionInputs } from './furtadoSession';

export const LIVE_API_KEY = process.env.GEMINI_API_KEY ?? '';

/** Removes the key, and anything shaped like a key or an ephemeral token. */
export const redact = makeRedactor([LIVE_API_KEY]);

/** `describe` that skips the whole block (green) when no key is configured. */
export const describeLive = describe.skipIf(!LIVE_API_KEY);

/** The session's inputs as a kit profile: the fields `useSession` receives. */
export function profileFor(name: string, inputs: FurtadoSessionInputs): LiveAppProfile {
  const o = inputs.liveOptions;
  return {
    name,
    model: o.liveModel,
    thinkingLevel: o.thinkingLevel,
    systemInstruction: inputs.systemInstruction,
    tools: inputs.tools,
    speechConfig: o.speechConfig,
    manualTurnControl: o.manualTurnControl,
    endOfSpeechSilenceMs: o.endOfSpeechSilenceMs,
    endOfSpeechSensitivity: o.endOfSpeechSensitivity,
  };
}

/** A check target built by the function `useSession` uses for its connect config. */
export function targetFor(inputs: FurtadoSessionInputs): LiveCheckTarget {
  const o = inputs.liveOptions;
  return {
    apiKey: LIVE_API_KEY,
    model: o.liveModel,
    config: buildLiveConnectConfig({
      model: o.liveModel,
      systemInstruction: inputs.systemInstruction,
      tools: inputs.tools,
      thinkingLevel: o.thinkingLevel,
      speechConfig: o.speechConfig,
      manualTurnControl: o.manualTurnControl,
      endOfSpeechSilenceMs: o.endOfSpeechSilenceMs,
      endOfSpeechSensitivity: o.endOfSpeechSensitivity,
    }),
  };
}

function record(row: Record<string, unknown>): void {
  if (!process.env.LIVE_RESULTS_FILE) return;
  fs.appendFileSync(process.env.LIVE_RESULTS_FILE, redact(JSON.stringify({ at: new Date().toISOString(), ...row })) + '\n');
}

/**
 * Print a kit result, record it, and fail the test when the check failed or
 * a provider contract changed. `warn` and `skipped` pass.
 */
export function expectCheck(result: LiveCheckResult, label: string): LiveCheckResult {
  const metrics = Object.entries(result.metrics)
    .filter(([, v]) => v !== '' && v !== -1)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.log(`[live] ${result.status.toUpperCase().padEnd(16)} ${label} :: ${result.name} :: ${result.detail}${metrics ? ` [${metrics}]` : ''}`);
  record({ label, ...result });
  if (!result.pass && result.trace?.length) {
    console.log(`[live] trace for ${label} :: ${result.name}\n  ${result.trace.join('\n  ')}`);
  }
  if (result.status === 'contract-changed') throw new Error(`[${label}] ${result.detail}`);
  if (!result.pass) throw new Error(`[${label}] ${result.name} failed: ${result.detail}`);
  return result;
}

/**
 * Run an app-specific check that the kit has no named check for, and report
 * it in the same shape. `body` returns a one-line detail and metrics, or
 * throws; a thrown error is the failure detail.
 */
export async function customCheck(
  label: string,
  name: string,
  body: () => Promise<{ detail: string; metrics?: Record<string, number | string | boolean>; status?: 'pass' | 'warn' }>,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const { detail, metrics = {}, status = 'pass' } = await body();
    expectCheck({ name, pass: true, status, detail, metrics, durationMs: Date.now() - startedAt }, label);
  } catch (err) {
    // The first line is the verdict; any further lines are an event trace.
    const full = redact(err instanceof Error ? err.message : String(err));
    const [detail, ...trace] = full.split('\n').map((line) => line.trim());
    console.log(`[live] FAIL             ${label} :: ${name} :: ${full}`);
    record({ label, name, pass: false, status: 'fail', detail, metrics: {}, durationMs: Date.now() - startedAt, ...(trace.length ? { trace } : {}) });
    throw new Error(`[${label}] ${name} failed: ${full}`);
  }
}

/**
 * What the app's `onToolCall` would hand back, near enough for a test: the
 * model must never be left waiting on a call nobody answers.
 */
export function stubToolResult(name: string): string {
  if (name === 'updateQuestionStatus') return 'Question status updated.';
  if (name === 'recordFact') return 'Fact recorded.';
  return 'No additional information found.';
}

/** Answer every tool call in the trace that has not been answered yet. */
export function answerPendingToolCalls(session: LiveTestSession, since: number): string[] {
  const answered: string[] = [];
  for (const event of session.events('toolCall', since)) {
    for (const call of event.calls) {
      if (session.trace.some((e) => e.type === 'sentToolResponse' && e.id === call.id)) continue;
      session.respondToTool(call, stubToolResult(call.name));
      answered.push(call.name);
    }
  }
  return answered;
}

export interface GreetingRun {
  /** Trace index where the cue was sent. */
  since: number;
  /** Trace index where the opening was judged finished. */
  settled: number;
  /** Everything the bot said from the cue until it settled. */
  greeting: string;
  /** Tools the bot called while opening, in order (each was answered). */
  toolCalls: string[];
  firstAudioMs: number;
  turnCompletes: number;
}

/**
 * Send the opening cue as the app does and collect the bot's whole opening.
 *
 * On this model a tool call is asynchronous: the turn that issues it ends at
 * once (`turnComplete`), and the bot speaks again when the result arrives. A
 * returning-session opening often looks like "greeting sentence, tool call,
 * turnComplete, tool result, follow-up question, turnComplete", and a tool
 * may even be called before the first word. So the opening is over only when
 * the bot has spoken, a `turnComplete` has followed its last audio, and it
 * has then stayed quiet for `quietMs`. Tool calls are answered as they come,
 * as the app's `onToolCall` would.
 */
export async function runGreeting(
  session: LiveTestSession,
  cue: string,
  options: { timeoutMs?: number; quietMs?: number } = {},
): Promise<GreetingRun> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const quietMs = options.quietMs ?? 4_000;
  const since = session.mark();
  const sentAt = session.now();
  session.sendText(cue);

  const deadline = Date.now() + timeoutMs;
  const toolCalls: string[] = [];
  let cursor = since;
  let firstAudioT: number | undefined;
  let turnCompleteAfterAudio = false;
  const fail = (what: string): never => {
    throw new Error(
      `${what} (tool calls answered: ${toolCalls.join(', ') || 'none'}; said: "${session.outputText(since).trim().slice(0, 120)}")\n  ` +
        formatLiveTrace(session.trace, 60).join('\n  '),
    );
  };

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) fail(`the opening did not finish within ${timeoutMs} ms`);
    const canSettle = firstAudioT !== undefined && turnCompleteAfterAudio;
    const event = await session
      .waitFor((e) => e.type === 'audio' || e.type === 'toolCall' || e.type === 'turnComplete', canSettle ? Math.min(quietMs, remaining) : remaining, {
        since: cursor,
        description: 'the opening greeting',
      })
      .catch((err: unknown) => {
        if (err instanceof LiveWaitError && !err.closed) return undefined; // timed out
        throw err;
      });
    if (!event) {
      if (canSettle) break; // quiet for quietMs after a finished turn
      fail(firstAudioT === undefined ? `the bot never spoke after the opening cue` : `the bot started speaking but its turn never completed`);
      break;
    }
    cursor = session.trace.indexOf(event) + 1;
    if (event.type === 'audio') {
      firstAudioT ??= event.t;
      turnCompleteAfterAudio = false;
    } else if (event.type === 'turnComplete') {
      if (firstAudioT !== undefined) turnCompleteAfterAudio = true;
    } else if (event.type === 'toolCall') {
      for (const call of event.calls) {
        session.respondToTool(call, stubToolResult(call.name));
        toolCalls.push(call.name);
      }
    }
  }

  return {
    since,
    settled: session.mark(),
    greeting: session.outputText(since).trim(),
    toolCalls,
    firstAudioMs: Math.round((firstAudioT ?? sentAt) - sentAt),
    turnCompletes: session.events('turnComplete', since).length,
  };
}
