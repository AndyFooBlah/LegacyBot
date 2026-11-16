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
 * What the Live token broker asks the provider for, as pure data.
 *
 * NO IMPORTS, on purpose. functions/ and the web client are separate
 * TypeScript projects, and the client's tests cannot install this package's
 * dependencies. Because this file imports nothing, both sides can load it:
 *   - liveToken.ts mints with exactly these values;
 *   - src/__tests__/services/liveTokenContract.test.ts (client side) checks
 *     them against the model constant and the API version the client
 *     connects on, so the two cannot drift apart;
 *   - the live suite (`npm run test:live`) mints a real token with them and
 *     opens a real session with the client's production config.
 */

/** How long the minted token is valid before Gemini rejects it. */
export const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
/** How long after minting the token may be used to open a new session. */
export const NEW_SESSION_WINDOW_MS = 60 * 1000; // 1 minute

/**
 * API version the token is minted on. `authTokens.create` is not served on
 * the SDK's default `v1`. Measured 2026-11-15: a token minted on `v1alpha`
 * opens a Live session on `v1alpha` (what the client pins) and on `v1beta`.
 * See https://ai.google.dev/gemini-api/docs/ephemeral-tokens
 */
export const LIVE_TOKEN_API_VERSION = 'v1alpha';

/**
 * Model the token is locked to through `liveConnectConstraints`, or null for
 * a token that is not tied to a model.
 *
 * It is null today: the client chooses the model (`LIVE_MODEL` in
 * src/services/gemini.ts), so a model change is a client-only deploy and the
 * broker cannot hold a stale id. If this is ever set, it must equal the
 * client's `LIVE_MODEL`; the client-side contract test fails otherwise.
 */
export const LIVE_TOKEN_MODEL_CONSTRAINT: string | null = null;

export interface LiveTokenRequest {
  config: {
    uses: number;
    expireTime: string;
    newSessionExpireTime: string;
    liveConnectConstraints?: { model: string };
  };
}

/** The `authTokens.create` request for a token minted at `nowMs`. */
export function buildLiveTokenRequest(nowMs: number): LiveTokenRequest {
  return {
    config: {
      // One session per token: a leaked token cannot be replayed.
      uses: 1,
      expireTime: new Date(nowMs + TOKEN_TTL_MS).toISOString(),
      newSessionExpireTime: new Date(nowMs + NEW_SESSION_WINDOW_MS).toISOString(),
      ...(LIVE_TOKEN_MODEL_CONSTRAINT
        ? { liveConnectConstraints: { model: LIVE_TOKEN_MODEL_CONSTRAINT } }
        : {}),
    },
  };
}
