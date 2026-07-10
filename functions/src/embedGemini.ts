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
 * embedGemini — server-side proxy for `ai.models.embedContent`.
 *
 * Used by KnowledgeCommon's Wikipedia RAG to embed query + chunk text
 * without ever putting the long-lived GEMINI_API_KEY in the browser.
 * Per-user rate-limited so a compromised account cannot batch-embed
 * arbitrary content.
 */

import { GoogleGenAI } from '@google/genai';
import { HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { enforceRateLimit } from './rateLimit';

const ALLOWED_MODELS = new Set<string>(['gemini-embedding-001']);

/** Cap inputs per call so a single client cannot DOS the embeddings endpoint. */
const MAX_CONTENTS_PER_CALL = 100;

export interface EmbedGeminiRequest {
  model: string;
  contents: string[];
}

export interface EmbedGeminiResponse {
  embeddings: number[][];
}

export function buildEmbedGeminiHandler(deps: { apiKey: () => string }) {
  return async (request: CallableRequest): Promise<EmbedGeminiResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    const uid = request.auth.uid;
    await enforceRateLimit(uid, 'embedGemini');

    const { model, contents } = (request.data ?? {}) as Partial<EmbedGeminiRequest>;
    if (typeof model !== 'string' || !model) {
      throw new HttpsError('invalid-argument', 'model is required.');
    }
    if (!ALLOWED_MODELS.has(model)) {
      throw new HttpsError('permission-denied', `Model ${model} is not allowed.`);
    }
    if (!Array.isArray(contents) || contents.length === 0) {
      throw new HttpsError('invalid-argument', 'contents must be a non-empty array of strings.');
    }
    if (contents.length > MAX_CONTENTS_PER_CALL) {
      throw new HttpsError(
        'invalid-argument',
        `contents has ${contents.length} entries; max ${MAX_CONTENTS_PER_CALL} per call.`,
      );
    }
    if (!contents.every((c) => typeof c === 'string')) {
      throw new HttpsError('invalid-argument', 'contents must be an array of strings.');
    }

    const apiKey = deps.apiKey();
    if (!apiKey) {
      throw new HttpsError('internal', 'GEMINI_API_KEY is not configured on this server.');
    }

    const ai = new GoogleGenAI({ apiKey });
    try {
      const response = await ai.models.embedContent({ model, contents });
      const embeddings = (response.embeddings ?? []).map((e) => e.values ?? []);
      return { embeddings };
    } catch (err: unknown) {
      logger.error('[embedGemini] Gemini embedContent failed', {
        uid,
        model,
        n: contents.length,
        err: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('internal', 'Gemini embedContent failed.');
    }
  };
}
