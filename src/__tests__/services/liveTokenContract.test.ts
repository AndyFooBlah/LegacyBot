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
 * Client ↔ token broker contract.
 *
 * The browser opens a Live session with an ephemeral token minted by the
 * `mintGeminiLiveToken` callable (functions/src/liveToken.ts). Two things
 * must agree across that boundary, and the two sides are separate packages
 * that deploy separately:
 *   - the API version the token is minted on must be one whose tokens open a
 *     session on the version the client connects on;
 *   - if the token is ever locked to a model, it must be the model the client
 *     connects with.
 * functions/src/liveTokenConfig.ts holds the broker's side as import-free
 * data, so this test can load it without the functions package's
 * dependencies (which root CI does not install).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { LIVE_API_VERSION } from '@andyfooblah/voice-common';
import {
  LIVE_TOKEN_API_VERSION,
  LIVE_TOKEN_MODEL_CONSTRAINT,
  buildLiveTokenRequest,
} from '../../../functions/src/liveTokenConfig';
import { LIVE_MODEL } from '../../services/gemini';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * (mint version, connect version) pairs measured to work against the real
 * API on 2026-11-15, by VoiceCommon's live suite and by this repo's
 * (`npm run test:live` mints with the broker's request and connects with the
 * client's config on every run).
 */
const MEASURED_COMPATIBLE: ReadonlyArray<readonly [mint: string, connect: string]> = [
  ['v1alpha', 'v1alpha'],
  ['v1alpha', 'v1beta'],
  ['v1beta', 'v1alpha'],
  ['v1beta', 'v1beta'],
];

describe('Live token broker ↔ client', () => {
  it('the broker mints on a version whose tokens the client can connect with', () => {
    expect(MEASURED_COMPATIBLE.map((pair) => pair.join('→'))).toContain(
      `${LIVE_TOKEN_API_VERSION}→${LIVE_API_VERSION}`,
    );
  });

  it('a model lock on the token, if any, is the client model constant', () => {
    if (LIVE_TOKEN_MODEL_CONSTRAINT !== null) expect(LIVE_TOKEN_MODEL_CONSTRAINT).toBe(LIVE_MODEL);
    const lock = buildLiveTokenRequest(Date.now()).config.liveConnectConstraints?.model ?? null;
    expect(lock).toBe(LIVE_TOKEN_MODEL_CONSTRAINT);
    if (lock !== null) expect(lock).toBe(LIVE_MODEL);
  });

  it('the token is single use and outlives the 1-minute window to open the session', () => {
    const now = Date.parse('2026-11-15T12:00:00.000Z');
    const { config } = buildLiveTokenRequest(now);
    expect(config.uses).toBe(1);
    expect(Date.parse(config.newSessionExpireTime) - now).toBe(60_000);
    expect(Date.parse(config.expireTime) - now).toBe(30 * 60_000);
  });

  it('the handler mints with that shared request and version, not its own copy', () => {
    const handler = fs.readFileSync(path.resolve(HERE, '../../../functions/src/liveToken.ts'), 'utf8');
    expect(handler).toMatch(/authTokens\.create\(tokenRequest\)/);
    expect(handler).toMatch(/const tokenRequest = buildLiveTokenRequest\(Date\.now\(\)\)/);
    expect(handler).toMatch(/httpOptions: \{ apiVersion: LIVE_TOKEN_API_VERSION \}/);
    expect(handler).not.toMatch(/apiVersion: '/);
  });

  it('VoiceCommon gets its token from that callable and nothing else', () => {
    const entry = fs.readFileSync(path.resolve(HERE, '../../index.tsx'), 'utf8');
    expect(entry).toMatch(/tokenProvider: mintGeminiLiveToken,/);
    const broker = fs.readFileSync(path.resolve(HERE, '../../services/geminiBroker.ts'), 'utf8');
    expect(broker).toMatch(/httpsCallable<void, MintGeminiLiveTokenResponse>\(\s*firebaseFunctions,\s*'mintGeminiLiveToken',/);
  });
});
