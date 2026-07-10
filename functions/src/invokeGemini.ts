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
 * invokeGemini — generic server-side proxy for `ai.models.generateContent`.
 *
 * The client no longer holds the Gemini API key; instead it POSTs the same
 * params shape (`{ model, contents, config }`) to this callable and gets the
 * response back. GEMINI_API_KEY lives only in Firebase Secret Manager.
 *
 * Request must come from a signed-in user. Each call is rate-limited so a
 * compromised account cannot rack up arbitrary bills. The model allow-list
 * keeps callers off very expensive tiers that aren't used in production.
 *
 * This is specifically for non-realtime text generation (event extraction,
 * engagement analysis, date normalization, transcript cleanup, ...). Live
 * API WebSocket sessions use `mintGeminiLiveToken` instead — see liveToken.ts.
 */

import { GoogleGenAI } from '@google/genai';
import { HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { enforceRateLimit } from './rateLimit';

/**
 * Models the client is allowed to invoke through the proxy. Keep this tight
 * — any model in this list can be invoked with arbitrary params by any
 * signed-in user (subject to the rate limit), so only include what our
 * features actually need.
 */
const ALLOWED_MODELS = new Set<string>([
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash',
  'gemini-embedding-001',
]);

/** Cap output tokens to bound the worst-case cost of a single call. */
const MAX_OUTPUT_TOKENS_CEILING = 32_768;

export interface InvokeGeminiRequest {
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
}

export interface InvokeGeminiResponse {
  /** Shorthand: response.text (the concatenation used by almost every caller). */
  text: string;
  /**
   * Candidates array passed through from the Gemini response. Includes the
   * parts (inlineData, functionCall, etc.) that some callers need but most
   * do not. Safe to JSON-serialise for text-only responses.
   */
  candidates: unknown;
  /** Prompt + response token counts for telemetry. */
  usageMetadata?: unknown;
}

export function buildInvokeGeminiHandler(deps: {
  apiKey: () => string;
}) {
  return async (request: CallableRequest): Promise<InvokeGeminiResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    const uid = request.auth.uid;
    await enforceRateLimit(uid, 'invokeGemini');

    const { model, contents, config } = (request.data ?? {}) as Partial<InvokeGeminiRequest>;
    if (typeof model !== 'string' || !model) {
      throw new HttpsError('invalid-argument', 'model is required.');
    }
    if (!ALLOWED_MODELS.has(model)) {
      throw new HttpsError('permission-denied', `Model ${model} is not allowed.`);
    }
    if (contents === undefined || contents === null) {
      throw new HttpsError('invalid-argument', 'contents is required.');
    }

    const safeConfig = { ...(config ?? {}) } as Record<string, unknown>;
    if (
      typeof safeConfig.maxOutputTokens === 'number' &&
      safeConfig.maxOutputTokens > MAX_OUTPUT_TOKENS_CEILING
    ) {
      safeConfig.maxOutputTokens = MAX_OUTPUT_TOKENS_CEILING;
    }

    const apiKey = deps.apiKey();
    if (!apiKey) {
      throw new HttpsError('internal', 'GEMINI_API_KEY is not configured on this server.');
    }

    const ai = new GoogleGenAI({ apiKey });
    try {
      const response = await ai.models.generateContent({
        model,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        contents: contents as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config: safeConfig as any,
      });
      return {
        text: response.text ?? '',
        candidates: response.candidates ?? [],
        usageMetadata: response.usageMetadata,
      };
    } catch (err: unknown) {
      logger.error('[invokeGemini] Gemini call failed', {
        uid,
        model,
        err: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('internal', 'Gemini call failed.');
    }
  };
}
