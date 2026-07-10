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
 * fetchWithTimeout — bounded outbound HTTP from Cloud Functions.
 *
 * Node's bare `fetch` has a soft default timeout (around 90 s) that is
 * dominated by Cloud Functions' own `timeoutSeconds`. A hung upstream
 * (Maps, Weather, Wikipedia, …) silently consumes the whole function's
 * timeout budget and prevents fast retries / cooperative failure. Wrapping
 * every external call with an explicit `AbortController` deadline turns
 * that into a fast, predictable rejection at a known time. Callers should
 * map `AbortError` to a user-friendly message and let the rate-limit /
 * retry logic do its job.
 */

export class FetchTimeoutError extends Error {
  constructor(public readonly url: string, public readonly timeoutMs: number) {
    super(`fetch(${url}) aborted after ${timeoutMs}ms`);
    this.name = 'FetchTimeoutError';
  }
}

export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new FetchTimeoutError(url, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Suggested timeouts for each external service the broker calls. */
export const TIMEOUTS = {
  /** Maps Geocoding API — typically <500 ms; 5 s is generous. */
  mapsGeocode: 5_000,
  /** Maps Weather API — multi-day forecasts can be slower; 10 s. */
  mapsWeather: 10_000,
  /** Wikipedia article extracts — large pages can be slow; 15 s. */
  wikipediaExtract: 15_000,
} as const;
