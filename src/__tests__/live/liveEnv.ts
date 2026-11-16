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
import { buildLiveConnectConfig, makeRedactor } from '@andyfooblah/voice-common/testing';
import type { LiveAppProfile, LiveCheckResult, LiveCheckTarget } from '@andyfooblah/voice-common/testing';
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
    const detail = redact(err instanceof Error ? err.message : String(err));
    console.log(`[live] FAIL             ${label} :: ${name} :: ${detail}`);
    record({ label, name, pass: false, status: 'fail', detail, metrics: {}, durationMs: Date.now() - startedAt });
    throw new Error(`[${label}] ${name} failed: ${detail}`);
  }
}
