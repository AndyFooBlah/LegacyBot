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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseBestEstimate,
  diffInDays,
  diffInSeconds,
  formatDuration,
  formatDate,
  computeTimeDifference,
  computeTimeOffset,
  normalizeDate,
  type NormalizedDate,
  type DateTimePoint,
} from '../../services/dateTimeUtils';

// ---------------------------------------------------------------------------
// Mock GoogleGenAI
// ---------------------------------------------------------------------------

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function() {
    return {
      models: {
        generateContent: vi.fn(),
      },
    };
  }),
}));

import { GoogleGenAI } from '@google/genai';

function mockGenerateContent(jsonResponse: object) {
  const instance = new (GoogleGenAI as any)();
  instance.models.generateContent.mockResolvedValue({
    candidates: [{ content: { parts: [{ text: JSON.stringify(jsonResponse) }] } }],
  });
  // Re-mock constructor so next `new GoogleGenAI()` call in the module also returns this
  (GoogleGenAI as any).mockImplementation(function() { return instance; });
  return instance;
}

const API_KEY = 'test-api-key';
const NOW = 'Sunday, April 12, 2026, 12:00 AM PDT';

/** Convenience: build a full DateTimePoint; time-of-day defaults to noon. */
function pt(year: number, month: number, day: number, hour = 12, minute = 0, second = 0): DateTimePoint {
  return { year, month, day, hour, minute, second };
}

// ---------------------------------------------------------------------------
// parseBestEstimate
// ---------------------------------------------------------------------------

describe('parseBestEstimate', () => {
  it('parses a full YYYY-MM-DD date (defaults to noon)', () => {
    const nd: NormalizedDate = { best_estimate: '1776-07-04', confidence: 'exact', resolution: 'day', description: 'July 4th, 1776' };
    expect(parseBestEstimate(nd)).toEqual(pt(1776, 7, 4));
  });

  it('parses a YYYY-MM date (defaults day to 15, time to noon)', () => {
    const nd: NormalizedDate = { best_estimate: '1997-07', confidence: 'approximate', resolution: 'month', description: 'summer 1997' };
    expect(parseBestEstimate(nd)).toEqual(pt(1997, 7, 15));
  });

  it('parses a year-only date (defaults month 7, day 1, time noon)', () => {
    const nd: NormalizedDate = { best_estimate: '1969', confidence: 'approximate', resolution: 'year', description: '1969' };
    expect(parseBestEstimate(nd)).toEqual(pt(1969, 7, 1));
  });

  it('parses a decade midpoint (e.g. "1965" for the 60s)', () => {
    const nd: NormalizedDate = { best_estimate: '1965', confidence: 'approximate', resolution: 'decade', description: 'the 1960s' };
    expect(parseBestEstimate(nd)).toEqual(pt(1965, 7, 1));
  });

  it('handles a negative year (BC date)', () => {
    const nd: NormalizedDate = { best_estimate: '-0044', confidence: 'approximate', resolution: 'year', description: '44 BC' };
    expect(parseBestEstimate(nd).year).toBe(-44);
  });

  it('parses YYYY-MM-DDTHH (hour resolution; defaults minute to 30)', () => {
    const nd: NormalizedDate = { best_estimate: '2023-11-09T14', confidence: 'approximate', resolution: 'hour', description: 'around 2pm on Nov 9, 2023' };
    expect(parseBestEstimate(nd)).toEqual({ year: 2023, month: 11, day: 9, hour: 14, minute: 30, second: 0 });
  });

  it('parses YYYY-MM-DDTHH:MM (minute resolution; defaults second to 30)', () => {
    const nd: NormalizedDate = { best_estimate: '2023-11-09T14:30', confidence: 'exact', resolution: 'minute', description: '2:30 PM on Nov 9, 2023' };
    expect(parseBestEstimate(nd)).toEqual({ year: 2023, month: 11, day: 9, hour: 14, minute: 30, second: 30 });
  });

  it('parses YYYY-MM-DDTHH:MM:SS (second resolution; all components exact)', () => {
    const nd: NormalizedDate = { best_estimate: '2023-11-09T14:30:45', confidence: 'exact', resolution: 'second', description: '2:30:45 PM on Nov 9, 2023' };
    expect(parseBestEstimate(nd)).toEqual({ year: 2023, month: 11, day: 9, hour: 14, minute: 30, second: 45 });
  });

  it('parses midnight (00:00:00)', () => {
    const nd: NormalizedDate = { best_estimate: '2000-01-01T00:00:00', confidence: 'exact', resolution: 'second', description: 'midnight Jan 1, 2000' };
    expect(parseBestEstimate(nd)).toEqual({ year: 2000, month: 1, day: 1, hour: 0, minute: 0, second: 0 });
  });

  it('throws on unrecognised format', () => {
    const nd: NormalizedDate = { best_estimate: 'not-a-date', confidence: 'exact', resolution: 'day', description: '' };
    expect(() => parseBestEstimate(nd)).toThrow('Unrecognised best_estimate format');
  });
});

// ---------------------------------------------------------------------------
// diffInDays
// ---------------------------------------------------------------------------

describe('diffInDays', () => {
  it('returns 0 for same date', () => {
    expect(diffInDays({ year: 2000, month: 1, day: 1 }, { year: 2000, month: 1, day: 1 })).toBe(0);
  });

  it('returns positive when b is after a', () => {
    expect(diffInDays({ year: 2000, month: 1, day: 1 }, { year: 2001, month: 1, day: 1 })).toBe(366); // 2000 is a leap year
  });

  it('returns negative when b is before a', () => {
    expect(diffInDays({ year: 2001, month: 1, day: 1 }, { year: 2000, month: 1, day: 1 })).toBe(-366);
  });

  it('handles cross-century boundary', () => {
    expect(diffInDays({ year: 1900, month: 1, day: 1 }, { year: 2000, month: 1, day: 1 })).toBe(36524);
  });

  it('handles same month boundary', () => {
    expect(diffInDays({ year: 2020, month: 3, day: 1 }, { year: 2020, month: 3, day: 31 })).toBe(30);
  });

  it('accepts DateTimePoint (ignores sub-day fields)', () => {
    // 1 hour apart on the same day → 0 days
    expect(diffInDays(pt(2000, 1, 1, 8), pt(2000, 1, 1, 9))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// diffInSeconds
// ---------------------------------------------------------------------------

describe('diffInSeconds', () => {
  it('returns 0 for identical timestamps', () => {
    expect(diffInSeconds(pt(2000, 1, 1, 12, 0, 0), pt(2000, 1, 1, 12, 0, 0))).toBe(0);
  });

  it('returns 1 for a 1-second difference', () => {
    expect(diffInSeconds(pt(2000, 1, 1, 12, 0, 0), pt(2000, 1, 1, 12, 0, 1))).toBe(1);
  });

  it('returns 60 for a 1-minute difference', () => {
    expect(diffInSeconds(pt(2000, 1, 1, 12, 0, 0), pt(2000, 1, 1, 12, 1, 0))).toBe(60);
  });

  it('returns 3600 for a 1-hour difference', () => {
    expect(diffInSeconds(pt(2000, 1, 1, 12, 0, 0), pt(2000, 1, 1, 13, 0, 0))).toBe(3600);
  });

  it('returns 86400 for a 1-day difference', () => {
    expect(diffInSeconds(pt(2000, 1, 1, 12, 0, 0), pt(2000, 1, 2, 12, 0, 0))).toBe(86400);
  });

  it('returns negative when b is before a', () => {
    expect(diffInSeconds(pt(2000, 1, 1, 12, 1, 0), pt(2000, 1, 1, 12, 0, 0))).toBe(-60);
  });

  it('spans midnight correctly', () => {
    expect(diffInSeconds(pt(2000, 1, 1, 23, 30, 0), pt(2000, 1, 2, 0, 30, 0))).toBe(3600);
  });

  it('handles 90-second difference', () => {
    expect(diffInSeconds(pt(2000, 1, 1, 12, 0, 0), pt(2000, 1, 1, 12, 1, 30))).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe('formatDuration', () => {
  // --- zero ---
  it('returns "the same time" for 0 seconds', () => {
    expect(formatDuration(0, 'day', 'exact')).toBe('the same time');
  });

  it('returns "the same time" for 0 seconds at second resolution', () => {
    expect(formatDuration(0, 'second', 'exact')).toBe('the same time');
  });

  // --- seconds ---
  it('formats 1 second', () => {
    expect(formatDuration(1, 'second', 'exact')).toBe('1 second');
  });

  it('formats 30 seconds', () => {
    expect(formatDuration(30, 'second', 'exact')).toBe('30 seconds');
  });

  it('adds "about" qualifier for approximate seconds', () => {
    expect(formatDuration(45, 'second', 'approximate')).toBe('about 45 seconds');
  });

  it('adds "roughly" qualifier for vague seconds', () => {
    expect(formatDuration(10, 'second', 'vague')).toBe('roughly 10 seconds');
  });

  // --- minutes ---
  it('formats 1 minute', () => {
    expect(formatDuration(60, 'minute', 'exact')).toBe('1 minute');
  });

  it('formats 2 minutes from 90 seconds at minute resolution', () => {
    expect(formatDuration(90, 'minute', 'exact')).toBe('2 minutes');
  });

  it('formats 5 minutes', () => {
    expect(formatDuration(300, 'minute', 'exact')).toBe('5 minutes');
  });

  it('adds "about" qualifier for approximate minutes', () => {
    expect(formatDuration(120, 'minute', 'approximate')).toBe('about 2 minutes');
  });

  it('shows minutes for second-resolution input under an hour', () => {
    expect(formatDuration(120, 'second', 'exact')).toBe('2 minutes');
  });

  // --- hours ---
  it('formats 1 hour', () => {
    expect(formatDuration(3600, 'hour', 'exact')).toBe('1 hour');
  });

  it('formats 2 hours', () => {
    expect(formatDuration(7200, 'hour', 'exact')).toBe('2 hours');
  });

  it('adds "about" qualifier for approximate hours', () => {
    expect(formatDuration(7200, 'hour', 'approximate')).toBe('about 2 hours');
  });

  it('rounds to nearest hour', () => {
    expect(formatDuration(5400, 'hour', 'exact')).toBe('2 hours'); // 1.5h → 2h
  });

  it('shows hours for minute-resolution input under a day', () => {
    expect(formatDuration(7200, 'minute', 'exact')).toBe('2 hours');
  });

  // --- days (now expressed in seconds) ---
  it('formats exact single day', () => {
    expect(formatDuration(1 * 86400, 'day', 'exact')).toBe('1 day');
  });

  it('formats exact 7 days', () => {
    expect(formatDuration(7 * 86400, 'day', 'exact')).toBe('7 days');
  });

  it('formats exact 2 weeks', () => {
    expect(formatDuration(14 * 86400, 'day', 'exact')).toBe('2 weeks');
  });

  it('shows days for hour-resolution input >= 1 day', () => {
    expect(formatDuration(1 * 86400, 'hour', 'exact')).toBe('1 day');
  });

  // --- months ---
  it('adds "about" qualifier for approximate months', () => {
    expect(formatDuration(365 * 86400, 'month', 'approximate')).toBe('about 12 months');
  });

  it('formats months for sub-18-month day-resolution', () => {
    expect(formatDuration(90 * 86400, 'day', 'exact')).toBe('3 months');
  });

  // --- years ---
  it('adds "roughly" qualifier for vague years', () => {
    expect(formatDuration(365 * 10 * 86400, 'year', 'vague')).toBe('roughly 10 years');
  });

  it('formats whole years for year-resolution inputs', () => {
    expect(formatDuration(365 * 27 * 86400, 'year', 'approximate')).toBe('about 27 years');
  });

  it('rounds to nearest 5 for decade resolution', () => {
    expect(formatDuration(365 * 27 * 86400, 'decade', 'approximate')).toBe('about 25 years');
  });

  it('formats a single year', () => {
    expect(formatDuration(366 * 86400, 'year', 'exact')).toBe('1 year');
  });

  it('formats many years', () => {
    expect(formatDuration(365 * 50 * 86400, 'year', 'approximate')).toBe('about 50 years');
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('formats a decade', () => {
    expect(formatDate(pt(1965, 7, 1), 'decade', 'approximate')).toBe('around the 1960s');
  });

  it('formats a year exactly', () => {
    expect(formatDate(pt(1969, 7, 1), 'year', 'exact')).toBe('1969');
  });

  it('formats a year approximately', () => {
    expect(formatDate(pt(1992, 7, 1), 'year', 'approximate')).toBe('around 1992');
  });

  it('formats a month-year', () => {
    expect(formatDate(pt(1997, 7, 15), 'month', 'approximate')).toBe('around July 1997');
  });

  it('formats a full day', () => {
    expect(formatDate(pt(1776, 7, 4), 'day', 'exact')).toBe('July 4, 1776');
  });

  it('formats a vague date', () => {
    expect(formatDate(pt(1980, 1, 1), 'year', 'vague')).toBe('around 1980');
  });

  it('formats hour resolution (2:00 PM, exact)', () => {
    expect(formatDate(pt(2023, 11, 9, 14, 0, 0), 'hour', 'exact')).toBe('November 9, 2023 at 2:00 PM');
  });

  it('formats hour resolution with "around" for approximate', () => {
    expect(formatDate(pt(2023, 11, 9, 14, 30, 0), 'hour', 'approximate')).toBe('around November 9, 2023 at 2:00 PM');
  });

  it('formats minute resolution (2:30 PM)', () => {
    expect(formatDate(pt(2023, 11, 9, 14, 30, 0), 'minute', 'exact')).toBe('November 9, 2023 at 2:30 PM');
  });

  it('formats minute resolution for AM time', () => {
    expect(formatDate(pt(2023, 11, 9, 9, 15, 0), 'minute', 'exact')).toBe('November 9, 2023 at 9:15 AM');
  });

  it('formats midnight (12:00 AM)', () => {
    expect(formatDate(pt(2000, 1, 1, 0, 0, 0), 'minute', 'exact')).toBe('January 1, 2000 at 12:00 AM');
  });

  it('formats noon (12:00 PM)', () => {
    expect(formatDate(pt(2000, 1, 1, 12, 0, 0), 'hour', 'exact')).toBe('January 1, 2000 at 12:00 PM');
  });

  it('formats second resolution (2:30:45 PM)', () => {
    expect(formatDate(pt(2023, 11, 9, 14, 30, 45), 'second', 'exact')).toBe('November 9, 2023 at 2:30:45 PM');
  });

  it('formats second resolution with leading zeros', () => {
    expect(formatDate(pt(2023, 1, 1, 8, 5, 3), 'second', 'exact')).toBe('January 1, 2023 at 8:05:03 AM');
  });
});

// ---------------------------------------------------------------------------
// normalizeDate (mocked)
// ---------------------------------------------------------------------------

describe('normalizeDate', () => {
  it('returns parsed JSON from Gemini (month resolution)', async () => {
    const expected: NormalizedDate = {
      best_estimate: '1997-07',
      confidence: 'approximate',
      resolution: 'month',
      description: 'mid-summer 1997',
    };
    mockGenerateContent(expected);
    expect(await normalizeDate('summer 1997', NOW, API_KEY)).toEqual(expected);
  });

  it('returns parsed JSON from Gemini (minute resolution)', async () => {
    const expected: NormalizedDate = {
      best_estimate: '2023-11-09T14:30',
      confidence: 'exact',
      resolution: 'minute',
      description: '2:30 PM on November 9, 2023',
    };
    mockGenerateContent(expected);
    expect(await normalizeDate('2:30 PM on Nov 9 2023', NOW, API_KEY)).toEqual(expected);
  });

  it('returns parsed JSON from Gemini (second resolution)', async () => {
    const expected: NormalizedDate = {
      best_estimate: '2000-01-01T00:00:00',
      confidence: 'exact',
      resolution: 'second',
      description: 'midnight, January 1st, 2000',
    };
    mockGenerateContent(expected);
    expect(await normalizeDate('midnight New Year 2000', NOW, API_KEY)).toEqual(expected);
  });

  it('throws on malformed JSON response', async () => {
    const instance = new (GoogleGenAI as any)();
    instance.models.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'not json' }] } }],
    });
    (GoogleGenAI as any).mockImplementation(function() { return instance; });
    await expect(normalizeDate('bad input', NOW, API_KEY)).rejects.toThrow('Failed to parse');
  });

  it('throws on missing required fields', async () => {
    mockGenerateContent({ best_estimate: '1997' }); // missing confidence and resolution
    await expect(normalizeDate('partial', NOW, API_KEY)).rejects.toThrow('Missing required fields');
  });
});

// ---------------------------------------------------------------------------
// computeTimeDifference (end-to-end with mocked Gemini)
// ---------------------------------------------------------------------------

describe('computeTimeDifference', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function setupNormalizeMocks(a: NormalizedDate, b: NormalizedDate) {
    let callCount = 0;
    const instance = new (GoogleGenAI as any)();
    instance.models.generateContent.mockImplementation(() => {
      callCount++;
      const result = callCount === 1 ? a : b;
      return Promise.resolve({
        candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
      });
    });
    (GoogleGenAI as any).mockImplementation(function() { return instance; });
  }

  it('computes ~27 years between summer 1997 and summer 2024', async () => {
    setupNormalizeMocks(
      { best_estimate: '1997-07', confidence: 'approximate', resolution: 'month', description: 'summer 1997' },
      { best_estimate: '2024-07', confidence: 'approximate', resolution: 'month', description: 'summer 2024' },
    );
    const { result } = await computeTimeDifference('summer 1997', 'summer 2024', NOW, API_KEY);
    expect(result).toMatch(/27/);
    expect(result).toMatch(/year/);
  });

  it('handles same-time inputs', async () => {
    const same: NormalizedDate = { best_estimate: '2000-01-01', confidence: 'exact', resolution: 'day', description: 'January 1st, 2000' };
    setupNormalizeMocks(same, same);
    const { result } = await computeTimeDifference('January 1 2000', 'January 1 2000', NOW, API_KEY);
    expect(result).toMatch(/same time/);
  });

  it('indicates direction: B after A', async () => {
    setupNormalizeMocks(
      { best_estimate: '1969-07-20', confidence: 'exact', resolution: 'day', description: 'July 20, 1969 (moon landing)' },
      { best_estimate: '1989-11-09', confidence: 'exact', resolution: 'day', description: 'November 9, 1989 (Berlin Wall)' },
    );
    const { result } = await computeTimeDifference('moon landing', 'Berlin Wall fell', NOW, API_KEY);
    expect(result).toMatch(/after/);
  });

  it('indicates direction: A after B', async () => {
    setupNormalizeMocks(
      { best_estimate: '1989-11-09', confidence: 'exact', resolution: 'day', description: 'November 9, 1989' },
      { best_estimate: '1969-07-20', confidence: 'exact', resolution: 'day', description: 'July 20, 1969' },
    );
    const { result } = await computeTimeDifference('Berlin Wall fell', 'moon landing', NOW, API_KEY);
    expect(result).toMatch(/before/);
  });

  it('uses "roughly" for vague inputs', async () => {
    setupNormalizeMocks(
      { best_estimate: '1960', confidence: 'vague', resolution: 'year', description: 'a long time ago' },
      { best_estimate: '2026', confidence: 'exact', resolution: 'year', description: 'now' },
    );
    const { result } = await computeTimeDifference('a long time ago', 'now', NOW, API_KEY);
    expect(result).toMatch(/roughly/);
  });

  it('uses "about" for approximate inputs', async () => {
    setupNormalizeMocks(
      { best_estimate: '1965', confidence: 'approximate', resolution: 'decade', description: 'the 1960s' },
      { best_estimate: '2026', confidence: 'exact', resolution: 'year', description: 'now' },
    );
    const { result } = await computeTimeDifference('the 60s', 'now', NOW, API_KEY);
    expect(result).toMatch(/about/);
  });

  it('computes months for short day-resolution intervals', async () => {
    setupNormalizeMocks(
      { best_estimate: '2025-01-01', confidence: 'exact', resolution: 'day', description: 'January 1, 2025' },
      { best_estimate: '2025-04-01', confidence: 'exact', resolution: 'day', description: 'April 1, 2025' },
    );
    const { result } = await computeTimeDifference('Jan 1 2025', 'April 1 2025', NOW, API_KEY);
    expect(result).toMatch(/month/);
  });

  it('returns parsedA and parsedB', async () => {
    const a: NormalizedDate = { best_estimate: '1997-07', confidence: 'approximate', resolution: 'month', description: 'summer 1997' };
    const b: NormalizedDate = { best_estimate: '2024-07', confidence: 'approximate', resolution: 'month', description: 'summer 2024' };
    setupNormalizeMocks(a, b);
    const { parsedA, parsedB } = await computeTimeDifference('summer 1997', 'summer 2024', NOW, API_KEY);
    expect(parsedA).toEqual(a);
    expect(parsedB).toEqual(b);
  });

  // --- sub-day resolution ---

  it('computes hours between two same-day times', async () => {
    setupNormalizeMocks(
      { best_estimate: '2023-11-09T09:00', confidence: 'exact', resolution: 'minute', description: '9:00 AM' },
      { best_estimate: '2023-11-09T14:00', confidence: 'exact', resolution: 'minute', description: '2:00 PM' },
    );
    const { result } = await computeTimeDifference('9am', '2pm', NOW, API_KEY);
    expect(result).toMatch(/5 hours/);
    expect(result).toMatch(/after/);
  });

  it('computes minutes between two close times', async () => {
    setupNormalizeMocks(
      { best_estimate: '2023-11-09T14:00', confidence: 'exact', resolution: 'minute', description: '2:00 PM' },
      { best_estimate: '2023-11-09T14:30', confidence: 'exact', resolution: 'minute', description: '2:30 PM' },
    );
    const { result } = await computeTimeDifference('2pm', '2:30pm', NOW, API_KEY);
    expect(result).toMatch(/30 minutes/);
  });

  it('computes seconds between two precise timestamps', async () => {
    setupNormalizeMocks(
      { best_estimate: '2000-01-01T00:00:00', confidence: 'exact', resolution: 'second', description: 'midnight' },
      { best_estimate: '2000-01-01T00:00:45', confidence: 'exact', resolution: 'second', description: '45 seconds after midnight' },
    );
    const { result } = await computeTimeDifference('midnight', '45 seconds after midnight', NOW, API_KEY);
    expect(result).toMatch(/45 seconds/);
  });

  it('computes hours that span midnight', async () => {
    setupNormalizeMocks(
      { best_estimate: '2023-11-09T22:00', confidence: 'exact', resolution: 'hour', description: '10 PM' },
      { best_estimate: '2023-11-10T02:00', confidence: 'exact', resolution: 'hour', description: '2 AM the next day' },
    );
    const { result } = await computeTimeDifference('10pm', '2am the next day', NOW, API_KEY);
    expect(result).toMatch(/4 hours/);
  });

  it('uses "about" qualifier for approximate sub-day intervals', async () => {
    setupNormalizeMocks(
      { best_estimate: '2023-11-09T14', confidence: 'approximate', resolution: 'hour', description: 'around 2pm' },
      { best_estimate: '2023-11-09T17', confidence: 'approximate', resolution: 'hour', description: 'around 5pm' },
    );
    const { result } = await computeTimeDifference('around 2pm', 'around 5pm', NOW, API_KEY);
    expect(result).toMatch(/about/);
    expect(result).toMatch(/hour/);
  });
});

// ---------------------------------------------------------------------------
// computeTimeOffset (end-to-end with mocked Gemini)
// ---------------------------------------------------------------------------

describe('computeTimeOffset', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function setupOffsetMocks(baseNorm: NormalizedDate, offsetSeconds: number, offsetDesc: string) {
    let callCount = 0;
    const instance = new (GoogleGenAI as any)();
    instance.models.generateContent.mockImplementation(() => {
      callCount++;
      const responseJson = callCount === 1
        ? baseNorm
        : { offset_seconds: offsetSeconds, description: offsetDesc };
      return Promise.resolve({
        candidates: [{ content: { parts: [{ text: JSON.stringify(responseJson) }] } }],
      });
    });
    (GoogleGenAI as any).mockImplementation(function() { return instance; });
  }

  it('adds 6 months to July 4th 1976 → around January 1977', async () => {
    setupOffsetMocks(
      { best_estimate: '1976-07-04', confidence: 'exact', resolution: 'day', description: 'July 4th, 1976' },
      183 * 86400,
      'about 6 months later',
    );
    const { result } = await computeTimeOffset('July 4th 1976', '6 months later', NOW, API_KEY);
    expect(result).toMatch(/January/);
    expect(result).toMatch(/1977/);
  });

  it('subtracts 2 years from 1990 → around 1988', async () => {
    setupOffsetMocks(
      { best_estimate: '1990', confidence: 'approximate', resolution: 'year', description: '1990' },
      -730 * 86400,
      'about 2 years earlier',
    );
    const { result } = await computeTimeOffset('1990', '2 years earlier', NOW, API_KEY);
    expect(result).toMatch(/1988/);
  });

  it('includes the base description in the result', async () => {
    setupOffsetMocks(
      { best_estimate: '1969-07-20', confidence: 'exact', resolution: 'day', description: 'July 20, 1969 (moon landing)' },
      365 * 86400,
      'one year later',
    );
    const { result } = await computeTimeOffset('moon landing', 'one year later', NOW, API_KEY);
    expect(result).toMatch(/July 20, 1969/);
  });

  it('returns parsedBase', async () => {
    const base: NormalizedDate = { best_estimate: '1969-07-20', confidence: 'exact', resolution: 'day', description: 'July 20, 1969' };
    setupOffsetMocks(base, 365 * 86400, 'one year later');
    const { parsedBase } = await computeTimeOffset('moon landing', 'one year later', NOW, API_KEY);
    expect(parsedBase).toEqual(base);
  });

  it('handles zero offset', async () => {
    setupOffsetMocks(
      { best_estimate: '2000-06-15', confidence: 'exact', resolution: 'day', description: 'June 15, 2000' },
      0,
      'the same day',
    );
    const { result } = await computeTimeOffset('June 15 2000', 'same day', NOW, API_KEY);
    expect(result).toMatch(/June 15, 2000/);
  });

  it('throws on malformed offset response', async () => {
    let callCount = 0;
    const instance = new (GoogleGenAI as any)();
    instance.models.generateContent.mockImplementation(() => {
      callCount++;
      const text = callCount === 1
        ? JSON.stringify({ best_estimate: '1990', confidence: 'exact', resolution: 'year', description: '1990' })
        : 'not json';
      return Promise.resolve({ candidates: [{ content: { parts: [{ text }] } }] });
    });
    (GoogleGenAI as any).mockImplementation(function() { return instance; });
    await expect(computeTimeOffset('1990', 'bad offset', NOW, API_KEY)).rejects.toThrow('Failed to parse offset');
  });

  // --- sub-day offsets ---

  it('adds 30 minutes to a specific time', async () => {
    setupOffsetMocks(
      { best_estimate: '2023-11-09T14:00', confidence: 'exact', resolution: 'minute', description: '2:00 PM on November 9, 2023' },
      1800,
      '30 minutes later',
    );
    const { result } = await computeTimeOffset('2pm Nov 9 2023', '30 minutes later', NOW, API_KEY);
    expect(result).toMatch(/2:30 PM/);
  });

  it('subtracts 2 hours from a specific time', async () => {
    setupOffsetMocks(
      { best_estimate: '2023-11-09T16:00', confidence: 'exact', resolution: 'hour', description: '4:00 PM on November 9, 2023' },
      -7200,
      '2 hours earlier',
    );
    const { result } = await computeTimeOffset('4pm Nov 9 2023', '2 hours earlier', NOW, API_KEY);
    expect(result).toMatch(/2:00 PM/);
  });

  it('adds 45 seconds to a precise timestamp', async () => {
    setupOffsetMocks(
      { best_estimate: '2000-01-01T00:00:00', confidence: 'exact', resolution: 'second', description: 'midnight, January 1st, 2000' },
      45,
      '45 seconds later',
    );
    const { result } = await computeTimeOffset('midnight New Year 2000', '45 seconds later', NOW, API_KEY);
    expect(result).toMatch(/12:00:45 AM/);
  });

  it('adds hours that cross midnight', async () => {
    setupOffsetMocks(
      { best_estimate: '2023-11-09T22:00', confidence: 'exact', resolution: 'hour', description: '10:00 PM on November 9, 2023' },
      10800,  // 3 hours
      '3 hours later',
    );
    const { result } = await computeTimeOffset('10pm Nov 9 2023', '3 hours later', NOW, API_KEY);
    // 10pm + 3h = 1am Nov 10
    expect(result).toMatch(/1:00 AM/);
    expect(result).toMatch(/November 10/);
  });
});
