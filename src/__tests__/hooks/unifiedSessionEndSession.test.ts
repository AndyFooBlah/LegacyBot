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
 * Structural regression test for LegacyBot #127: endSession hang.
 *
 * The endSession bug was caused by `setTimeout` polling a closure-captured
 * `isBotSpeaking` React state value — the poll never saw the state flip
 * because it was frozen in the closure. The fix mirrors the state into a
 * ref (`isBotSpeakingRef`) and reads the ref on each poll.
 *
 * A proper integration test would require a heavy useUnifiedSession harness
 * (VoiceCommon, audio mocks, timers). The pragmatic alternative: a source
 * lint that fails if anyone removes the ref indirection and regresses to
 * reading state directly inside the callback.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE_PATH = path.resolve(__dirname, '../../hooks/useUnifiedSession.ts');

describe('useUnifiedSession — endSession callback', () => {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');

  it('declares isBotSpeakingRef and keeps it in sync with isBotSpeaking', () => {
    expect(source).toMatch(/isBotSpeakingRef\s*=\s*useRef/);
    expect(source).toMatch(/isBotSpeakingRef\.current\s*=\s*isBotSpeaking/);
  });

  it('onSessionEndRequest polls the ref, not the state variable', () => {
    const match = source.match(
      /onSessionEndRequest:\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\},/,
    );
    expect(match).not.toBeNull();
    const body = match![1];

    // Must read isBotSpeakingRef.current inside the poll callback (fresh value).
    expect(body).toMatch(/isBotSpeakingRef\.current/);

    // Must NOT read the bare `isBotSpeaking` state variable inside the poll
    // loop — that's the bug pattern (stale closure).
    const pollFn = body.match(/waitForAudio\s*=\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}/);
    expect(pollFn).not.toBeNull();
    expect(pollFn![1]).not.toMatch(/\bisBotSpeaking\b(?!Ref)/);

    // Must actually call stopSession when the condition is met.
    expect(body).toMatch(/vcSession\.stopSession/);
  });

  it('deadline is capped at a reasonable (<= 15s) ceiling', () => {
    // Regression safeguard: the original 30s budget was too long — users hit
    // End Call before the fallback fired. Keep under 15 000 ms.
    const match = source.match(
      /onSessionEndRequest:\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\},/,
    );
    expect(match).not.toBeNull();
    const body = match![1];
    const deadlineMatch = body.match(/Date\.now\(\)\s*\+\s*(\d+(?:_\d+)?)/);
    expect(deadlineMatch).not.toBeNull();
    const deadlineMs = Number(deadlineMatch![1].replace(/_/g, ''));
    expect(deadlineMs).toBeLessThanOrEqual(15_000);
    expect(deadlineMs).toBeGreaterThan(0);
  });
});
