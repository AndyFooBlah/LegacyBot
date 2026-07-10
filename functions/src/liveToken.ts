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
 * mintGeminiLiveToken — server-side minting of short-lived Gemini Live tokens.
 *
 * Clients must never see the real GEMINI_API_KEY. Before opening a Gemini
 * Live WebSocket, signed-in users call this callable to obtain an ephemeral
 * token scoped to a single Live session with a ~30 minute expiry. Once the
 * session is opened (or the token expires), the token is useless.
 *
 * The primary defence this provides:
 *   - A bundled static API key can be harvested from a page's JavaScript and
 *     replayed indefinitely. An ephemeral token is single-use and short-lived,
 *     so even if a client exposes it, the blast radius is one session.
 *   - A per-user rate limit (`geminiLiveToken` bucket) stops a compromised
 *     account from minting unlimited tokens.
 */

import { GoogleGenAI } from '@google/genai';
import { HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { enforceRateLimit } from './rateLimit';

/** How long the minted token is valid before Gemini rejects it. */
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
/** How long after minting the token may be used to open a new session. */
const NEW_SESSION_WINDOW_MS = 60 * 1000; // 1 minute

export interface MintGeminiLiveTokenResponse {
  /** Ephemeral token string to pass as the `apiKey` field on the client Live connect. */
  token: string;
  /** ISO timestamp when the Live session expires. Clients should reconnect before this. */
  expireTime: string;
}

export function buildMintGeminiLiveTokenHandler(deps: {
  apiKey: () => string;
}) {
  return async (request: CallableRequest): Promise<MintGeminiLiveTokenResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    await enforceRateLimit(request.auth.uid, 'mintGeminiLiveToken');

    const apiKey = deps.apiKey();
    if (!apiKey) {
      throw new HttpsError('internal', 'GEMINI_API_KEY is not configured on this server.');
    }

    const now = Date.now();
    const expireTime = new Date(now + TOKEN_TTL_MS).toISOString();
    const newSessionExpireTime = new Date(now + NEW_SESSION_WINDOW_MS).toISOString();

    // authTokens.create is exposed only on the v1alpha endpoint; the SDK
    // defaults to v1, which returns 404 for this method. Pin v1alpha here.
    // See https://ai.google.dev/gemini-api/docs/ephemeral-tokens
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
    try {
      const token = await ai.authTokens.create({
        config: {
          uses: 1,
          expireTime,
          newSessionExpireTime,
        },
      });
      if (!token?.name) {
        throw new Error('authTokens.create returned empty token');
      }
      return { token: token.name, expireTime };
    } catch (err) {
      logger.error('[mintGeminiLiveToken] Failed to mint token', err);
      throw new HttpsError('internal', 'Failed to mint Gemini Live token.');
    }
  };
}
