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
 * Tests for the external search helpers in externalSearch.ts.
 *
 * Note: Wikipedia search is now provided by @andyfooblah/voice-common
 * (RAG over cached full articles). Tests for that implementation live in
 * the VoiceCommon repo. This file covers the helpers that remain in
 * LegacyBot: getJoke, searchPlace, getDistanceBetweenPlaces, getWeather,
 * searchContext.
 *
 * References: src/services/externalSearch.ts | GitHub Issue #115
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getJoke, searchPlace, getDistanceBetweenPlaces, getWeather, searchContext } from '../../services/externalSearch';

// ---------------------------------------------------------------------------
// Mock firebase/functions so the module can be imported without a real backend
// ---------------------------------------------------------------------------

const mockCallable = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mockCallable),
}));

vi.mock('../../services/firebase', () => ({
  functions: {},
}));

// ---------------------------------------------------------------------------
// JokeAPI
// ---------------------------------------------------------------------------

describe('getJoke', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns joke text from JokeAPI', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'Why do programmers prefer dark mode? Because light attracts bugs.',
    }) as unknown as typeof fetch;

    const result = await getJoke();

    expect(result).toBe('Why do programmers prefer dark mode? Because light attracts bugs.');
  });

  it('returns fallback message when JokeAPI fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => '',
    }) as unknown as typeof fetch;

    const result = await getJoke();

    expect(result).toContain('unavailable');
  });

  it('returns fallback on network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch;

    const result = await getJoke();

    expect(result).toContain('unavailable');
  });
});

// ---------------------------------------------------------------------------
// Geo proxy helpers (searchPlace, getDistanceBetweenPlaces, getWeather)
// ---------------------------------------------------------------------------

describe('searchPlace', () => {
  beforeEach(() => {
    mockCallable.mockReset();
  });

  it('returns the proxy result', async () => {
    mockCallable.mockResolvedValue({ data: { result: 'Lincoln, Nebraska, USA (40.8136°N, 96.7026°W)' } });

    const result = await searchPlace('Lincoln Nebraska');

    expect(result).toBe('Lincoln, Nebraska, USA (40.8136°N, 96.7026°W)');
  });

  it('returns unavailable message on error', async () => {
    mockCallable.mockRejectedValue(new Error('functions error'));

    const result = await searchPlace('somewhere');

    expect(result).toContain('unavailable');
  });
});

describe('getDistanceBetweenPlaces', () => {
  beforeEach(() => {
    mockCallable.mockReset();
  });

  it('returns the distance result', async () => {
    mockCallable.mockResolvedValue({ data: { result: '1,500 miles' } });

    const result = await getDistanceBetweenPlaces('New York', 'Los Angeles');

    expect(result).toBe('1,500 miles');
  });

  it('returns unavailable message on error', async () => {
    mockCallable.mockRejectedValue(new Error('functions error'));

    const result = await getDistanceBetweenPlaces('A', 'B');

    expect(result).toContain('unavailable');
  });
});

describe('getWeather', () => {
  beforeEach(() => {
    mockCallable.mockReset();
  });

  it('returns the weather result', async () => {
    mockCallable.mockResolvedValue({ data: { result: 'Sunny, 72°F' } });

    const result = await getWeather('San Francisco');

    expect(result).toBe('Sunny, 72°F');
  });

  it('returns unavailable message on error', async () => {
    mockCallable.mockRejectedValue(new Error('functions error'));

    const result = await getWeather('somewhere');

    expect(result).toContain('unavailable');
  });
});

// ---------------------------------------------------------------------------
// searchContext
// ---------------------------------------------------------------------------

describe('searchContext', () => {
  beforeEach(() => {
    mockCallable.mockReset();
  });

  it('formats results as [source] text pairs', async () => {
    mockCallable.mockResolvedValue({
      data: {
        results: [
          { source: 'transcript', text: 'She grew up in Lincoln.', dossierId: 'd1', sessionId: 's1' },
          { source: 'event', text: 'Moved to Omaha in 1962.', dossierId: 'd1', sessionId: null },
        ],
      },
    });

    const result = await searchContext('childhood home', 5, 'family-1');

    expect(result).toBe('[transcript] She grew up in Lincoln.\n[event] Moved to Omaha in 1962.');
  });

  it('returns no-results message when empty', async () => {
    mockCallable.mockResolvedValue({ data: { results: [] } });

    const result = await searchContext('anything', 5, 'family-1');

    expect(result).toBe('No relevant context found.');
  });

  it('returns unavailable message on error', async () => {
    mockCallable.mockRejectedValue(new Error('functions error'));

    const result = await searchContext('anything', 5, 'family-1');

    expect(result).toContain('unavailable');
  });
});
