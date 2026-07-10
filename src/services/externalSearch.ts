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
 * External search helpers for BiographyBot.
 *
 * Provides search functions that the AI can call during live sessions to look
 * up contextual information.
 *
 * API KEY POLICY
 * ==============
 * Wikipedia and JokeAPI require no key — called directly from the client.
 *
 * Google Maps (Geocoding) and Google Maps Platform Weather API keys are kept
 * exclusively on the server. All Maps and Weather calls are proxied through the
 * `geoProxy` Cloud Function (functions/src/index.ts). The key is stored in
 * functions/.env and never included in the client bundle.
 *
 * Rationale for server-side proxy:
 *   - Prevents the Maps API key from being extracted from the JS bundle
 *   - Latency overhead measured at ~10–26ms vs direct client calls — acceptable
 *     for conversational use
 *   - Weather API (weather.googleapis.com) does not send CORS headers, so
 *     browser-direct calls are always blocked regardless; proxy is required
 *
 * GitHub Issues: #101 (Wikipedia), #102 (Google Maps), #105 (Jokes),
 *                #106 (Weather), #110 (latency diagnostic → closed)
 */

import { httpsCallable } from 'firebase/functions';
import { functions as firebaseFunctions } from './firebase';

// ---------------------------------------------------------------------------
// Wikipedia (#101)
// ---------------------------------------------------------------------------
// searchWikipedia is now provided by @andyfooblah/voice-common.
// It performs RAG over full Wikipedia articles with Firestore-cached embeddings.
// Import it directly from that package — do not add an implementation here.

// ---------------------------------------------------------------------------
// JokeAPI (#105)
// ---------------------------------------------------------------------------

/**
 * Fetch a random joke from JokeAPI v2.
 * Categories: Programming, Miscellaneous, Pun — all harmful content blacklisted.
 * Returns the joke as plain text (single line or two-liner joined by newline).
 */
export async function getJoke(): Promise<string> {
  try {
    const url =
      'https://v2.jokeapi.dev/joke/Programming,Miscellaneous,Pun' +
      '?blacklistFlags=nsfw,religious,political,racist,sexist,explicit&format=txt';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`JokeAPI responded with ${res.status}`);
    const text = await res.text();
    return text.trim() || 'Sorry, I couldn\'t think of a joke right now.';
  } catch (err) {
    console.warn('[JokeAPI] Error:', err);
    return `Joke unavailable at this time.`;
  }
}

// ---------------------------------------------------------------------------
// Google Maps — Geocoding, Distance, Weather (via geoProxy Cloud Function)
// (#102, #106)
//
// The GOOGLE_MAPS_API_KEY lives exclusively in functions/.env and is never
// embedded in the client bundle. All three operations go through the geoProxy
// callable function which requires Firebase Auth.
// ---------------------------------------------------------------------------

interface GeoProxyResult {
  result: string;
}

async function callGeoProxy(
  data: { type: 'geocode' | 'distance' | 'weather'; query: string; queryB?: string },
): Promise<string> {
  const fn = httpsCallable<typeof data, GeoProxyResult>(firebaseFunctions, 'geoProxy');
  const res = await fn(data);
  return res.data.result;
}

/**
 * Translate a Firebase callable error into a message the Gemini Live model
 * can interpret and relay to the user. The httpsCallable wrapper surfaces a
 * server-thrown HttpsError as a FunctionsError with `code` prefixed by
 * `functions/` (e.g. `functions/resource-exhausted`).
 *
 * Rate-limit errors get a specific, retryable message so the model can say
 * "we've hit our daily limit" instead of silently degrading.
 */
function toolErrorMessage(err: unknown, fallback: string): string {
  const code = (err as { code?: string })?.code;
  if (code === 'functions/resource-exhausted') {
    const msg = (err as { message?: string })?.message ?? '';
    return `Rate limit reached: ${msg} The user should be told we've used this service too many times today and can try again tomorrow.`;
  }
  return fallback;
}

/**
 * Look up a place by name and return its formatted address and coordinates.
 * Proxied through the geoProxy Cloud Function — key never leaves the server.
 */
export async function searchPlace(query: string): Promise<string> {
  try {
    return await callGeoProxy({ type: 'geocode', query });
  } catch (err) {
    console.warn('[Maps] searchPlace error:', err);
    return toolErrorMessage(err, 'Maps search unavailable at this time.');
  }
}

/**
 * Calculate the straight-line distance between two named places.
 * Proxied through the geoProxy Cloud Function — key never leaves the server.
 */
export async function getDistanceBetweenPlaces(placeA: string, placeB: string): Promise<string> {
  try {
    return await callGeoProxy({ type: 'distance', query: placeA, queryB: placeB });
  } catch (err) {
    console.warn('[Maps] getDistanceBetweenPlaces error:', err);
    return toolErrorMessage(err, 'Maps distance lookup unavailable at this time.');
  }
}

/**
 * Get current weather conditions and a 3-day forecast for a location.
 * Proxied through the geoProxy Cloud Function — key never leaves the server.
 * (weather.googleapis.com also does not send CORS headers, so browser-direct
 * calls would be blocked regardless.)
 */
export async function getWeather(location: string): Promise<string> {
  try {
    return await callGeoProxy({ type: 'weather', query: location });
  } catch (err) {
    console.warn('[Weather] Error:', err);
    return toolErrorMessage(err, 'Weather lookup unavailable at this time.');
  }
}

// ---------------------------------------------------------------------------
// Wikipedia cache filler (server-side to prevent cache poisoning)
//
// Client writes to `wikipedia_cache` are denied by Firestore rules to
// prevent cache-poisoning (an authenticated user could otherwise overwrite
// a popular article and inject prompts into other users' Gemini tool calls).
// Cache fills go through this server-side callable which fetches Wikipedia
// with the admin SDK and writes using admin privileges.
// ---------------------------------------------------------------------------

interface CacheWikipediaResult {
  chunkCount: number;
  cached: boolean;
}

export async function cacheWikipediaArticle(
  articleId: string,
  title: string,
): Promise<{ chunkCount: number }> {
  const fn = httpsCallable<
    { articleId: string; title: string },
    CacheWikipediaResult
  >(firebaseFunctions, 'cacheWikipediaArticle');
  const res = await fn({ articleId, title });
  return { chunkCount: res.data.chunkCount };
}

// ---------------------------------------------------------------------------
// Semantic context search (#108)
//
// Searches the family's entire accumulated knowledge — biographies, session
// transcripts, events, misc facts, and questions — using vector similarity
// plus keyword matching with RRF reranking.  Runs server-side via the
// searchContext Cloud Function.
// ---------------------------------------------------------------------------

interface SearchContextResponse {
  results: Array<{
    text: string;
    source: string;
    dossierId: string | null;
    sessionId: string | null;
  }>;
}

export type ContextSearchResult = SearchContextResponse['results'][number];

async function callSearchContext(
  familyId: string,
  query: string,
  topK: number,
): Promise<ContextSearchResult[]> {
  const fn = httpsCallable<
    { familyId: string; query: string; topK: number },
    SearchContextResponse
  >(firebaseFunctions, 'searchContext');
  const res = await fn({ familyId, query, topK });
  return res.data.results ?? [];
}

/**
 * Search the family's accumulated knowledge by semantic similarity.
 * Returns a formatted string ready for inclusion in a bot response.
 */
export async function searchContext(
  query: string,
  topK: number,
  familyId: string,
): Promise<string> {
  try {
    const results = await callSearchContext(familyId, query, topK);
    if (!results.length) return 'No relevant context found.';
    return results.map((r) => `[${r.source}] ${r.text}`).join('\n');
  } catch (err) {
    console.warn('[searchContext] Error:', err);
    return toolErrorMessage(err, 'Context search unavailable at this time.');
  }
}

/**
 * Search the family's accumulated knowledge by semantic similarity.
 * Returns structured results for UI rendering.
 */
export async function searchContextRaw(
  query: string,
  topK: number,
  familyId: string,
): Promise<ContextSearchResult[]> {
  return callSearchContext(familyId, query, topK);
}
