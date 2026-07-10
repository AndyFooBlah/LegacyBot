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
 * Client-side wrappers for the server-side Gemini broker callables.
 *
 * The browser never holds GEMINI_API_KEY. To talk to Gemini:
 *   - Live (WebSocket): mint a single-use ephemeral token via
 *     mintGeminiLiveToken(), then pass it as the `apiKey` to GoogleGenAI's
 *     live.connect(). The token expires in ~30 minutes.
 *   - Non-realtime text: call invokeGemini() instead of constructing a
 *     GoogleGenAI client. Returns the same `{ text, candidates, usageMetadata }`
 *     shape as the SDK's response so callers don't need other changes.
 *
 * Both callables are per-user rate-limited on the server. See
 * functions/src/liveToken.ts and functions/src/invokeGemini.ts.
 */

import { httpsCallable } from 'firebase/functions';
import { functions as firebaseFunctions } from './firebase';

export interface MintGeminiLiveTokenResponse {
  token: string;
  expireTime: string;
}

export async function mintGeminiLiveToken(): Promise<MintGeminiLiveTokenResponse> {
  const fn = httpsCallable<void, MintGeminiLiveTokenResponse>(
    firebaseFunctions,
    'mintGeminiLiveToken',
  );
  const res = await fn();
  return res.data;
}

export interface InvokeGeminiRequest {
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
}

export interface InvokeGeminiResponse {
  text: string;
  candidates: unknown;
  usageMetadata?: unknown;
}

export async function invokeGemini(
  req: InvokeGeminiRequest,
): Promise<InvokeGeminiResponse> {
  const fn = httpsCallable<InvokeGeminiRequest, InvokeGeminiResponse>(
    firebaseFunctions,
    'invokeGemini',
  );
  const res = await fn(req);
  return res.data;
}

export interface EmbedGeminiRequest {
  model: string;
  contents: string[];
}

export interface EmbedGeminiResponse {
  embeddings: number[][];
}

export async function embedGemini(
  req: EmbedGeminiRequest,
): Promise<EmbedGeminiResponse> {
  const fn = httpsCallable<EmbedGeminiRequest, EmbedGeminiResponse>(
    firebaseFunctions,
    'embedGemini',
  );
  const res = await fn(req);
  return res.data;
}
