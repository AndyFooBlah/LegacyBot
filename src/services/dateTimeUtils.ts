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
 * LLM-assisted date/time utilities for the AI interviewer agent (#112, #114).
 *
 * Handles vague, partial, or natural-language date/time expressions that
 * ordinary date-parsing libraries cannot resolve — seasons ("summer 1997"),
 * decades ("the 60s"), relative references ("now", "recently"), circa years,
 * specific times ("around 3pm", "just after midnight"), etc.
 *
 * Architecture:
 *   1. Normalize each expression to a structured estimate via Gemini
 *      (gemini-3.1-flash-lite-preview — fast, cheap, structured output).
 *   2. Do arithmetic on the normalized ISO strings in TypeScript.
 *   3. Qualify the human-readable output with the inferred confidence level.
 *
 * Public API:
 *   computeTimeDifference(dateA, dateB, currentDateTime, apiKey)
 *     → "about 27 years" / "roughly 3 months before" / "about 2 hours after"
 *
 *   computeTimeOffset(date, offset, currentDateTime, apiKey)
 *     → "around January 1977" / "30 minutes later — around 2:30 PM"
 *
 * Resolution support (coarsest → finest):
 *   decade | year | month | day | hour | minute | second
 */

import { GoogleGenAI } from '@google/genai';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fast, cheap model used only for structured date normalization. */
export const DATETIME_MODEL = 'gemini-3.1-flash-lite-preview';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DateConfidence = 'exact' | 'approximate' | 'vague';
export type DateResolution = 'second' | 'minute' | 'hour' | 'day' | 'month' | 'year' | 'decade';

/**
 * A vague natural-language date expression normalized to a structured form.
 * `best_estimate` is an ISO 8601 string at the resolution indicated:
 *   - decade:  "1960" (use midpoint of decade)
 *   - year:    "1969"
 *   - month:   "1997-07"
 *   - day:     "1776-07-04"
 *   - hour:    "2023-11-09T14"
 *   - minute:  "2023-11-09T14:30"
 *   - second:  "2023-11-09T14:30:45"
 */
export interface NormalizedDate {
  best_estimate: string;
  confidence: DateConfidence;
  resolution: DateResolution;
  description: string;
}

/**
 * A fully resolved point in time with year through second components.
 * Sub-day fields default to midpoints (hour=12, minute=0, second=0) when
 * parsing coarse-resolution expressions.
 */
export interface DateTimePoint {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Result returned to the agent for a time-difference query. */
export interface TimeDiffResult {
  /** Human-readable difference, e.g. "about 27 years" or "about 2 hours" */
  result: string;
  /** Parsed representation of dateA */
  parsedA: NormalizedDate;
  /** Parsed representation of dateB */
  parsedB: NormalizedDate;
}

/** Result returned to the agent for a time-offset query. */
export interface TimeOffsetResult {
  /** Human-readable description of the resulting date, e.g. "around January 1977" */
  result: string;
  /** Parsed representation of the base date */
  parsedBase: NormalizedDate;
}

// ---------------------------------------------------------------------------
// LLM normalization
// ---------------------------------------------------------------------------

const NORMALIZE_SYSTEM = `You are a date/time normalizer. Given a natural language date expression and the current date/time, return ONLY a JSON object — no markdown, no explanation.

The JSON must have exactly these fields:
{
  "best_estimate": string,  // ISO 8601 at the appropriate resolution:
                            //   decade → "YYYY" (midpoint, e.g. "1965" for "the 60s")
                            //   year   → "YYYY" (e.g. "1969")
                            //   month  → "YYYY-MM" (e.g. "1997-07" for "summer 1997")
                            //   day    → "YYYY-MM-DD" (e.g. "1776-07-04")
                            //   hour   → "YYYY-MM-DDTHH" (e.g. "2023-11-09T14" for "around 2pm on Nov 9")
                            //   minute → "YYYY-MM-DDTHH:MM" (e.g. "2023-11-09T14:30")
                            //   second → "YYYY-MM-DDTHH:MM:SS" (e.g. "2023-11-09T14:30:45")
  "confidence": "exact" | "approximate" | "vague",
  "resolution": "decade" | "year" | "month" | "day" | "hour" | "minute" | "second",
  "description": string     // brief human-readable interpretation, e.g. "mid-summer 1997"
}

Confidence guide:
  exact       — specific time is precisely known ("July 4th, 1776", "2:30 PM on March 15, 2023")
  approximate — time is roughly known ("summer 1997", "early 90s", "around 3pm", "mid-morning")
  vague       — very uncertain ("a long time ago", "when I was young", "recently")

Resolution guide:
  Use the finest resolution the expression supports.
  "around 3pm on Tuesday" → hour resolution
  "just before noon" → hour or minute depending on precision implied
  "2:34 PM" → minute resolution
  "exactly 14:30:00" → second resolution

For "now" or "today" use the current date and confidence "exact".
For relative expressions ("last year", "a few months ago", "2 hours ago") compute from the current date.
For vague expressions like "a long time ago", pick a reasonable best_estimate and use "vague".`;

/**
 * Normalize a natural-language date expression using Gemini.
 * Exported for testing/mocking.
 */
export async function normalizeDate(
  expression: string,
  currentDateTime: string,
  apiKey: string,
): Promise<NormalizedDate> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: DATETIME_MODEL,
    contents: `Current date/time: ${currentDateTime}\nExpression: "${expression}"`,
    config: {
      systemInstruction: NORMALIZE_SYSTEM,
      responseMimeType: 'application/json',
      temperature: 0,
    },
  });

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let parsed: NormalizedDate;
  try {
    parsed = JSON.parse(text) as NormalizedDate;
  } catch {
    throw new Error(`Failed to parse date normalization response: ${text.slice(0, 200)}`);
  }
  if (!parsed.best_estimate || !parsed.confidence || !parsed.resolution) {
    throw new Error('Missing required fields');
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Date arithmetic helpers
// ---------------------------------------------------------------------------

/**
 * Parse a NormalizedDate's best_estimate into a full DateTimePoint.
 * Sub-day components default to midpoints for coarse-resolution expressions:
 *   - day/month/year resolution: hour=12, minute=0, second=0
 *   - hour resolution: minute=30, second=0
 *   - minute resolution: second=30
 */
export function parseBestEstimate(nd: NormalizedDate): DateTimePoint {
  const s = nd.best_estimate.trim();

  // YYYY-MM-DDTHH:MM:SS
  const dtSecondMatch = s.match(/^(-?\d+)-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (dtSecondMatch) {
    return {
      year: parseInt(dtSecondMatch[1], 10),
      month: parseInt(dtSecondMatch[2], 10),
      day: parseInt(dtSecondMatch[3], 10),
      hour: parseInt(dtSecondMatch[4], 10),
      minute: parseInt(dtSecondMatch[5], 10),
      second: parseInt(dtSecondMatch[6], 10),
    };
  }

  // YYYY-MM-DDTHH:MM
  const dtMinuteMatch = s.match(/^(-?\d+)-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (dtMinuteMatch) {
    return {
      year: parseInt(dtMinuteMatch[1], 10),
      month: parseInt(dtMinuteMatch[2], 10),
      day: parseInt(dtMinuteMatch[3], 10),
      hour: parseInt(dtMinuteMatch[4], 10),
      minute: parseInt(dtMinuteMatch[5], 10),
      second: 30,
    };
  }

  // YYYY-MM-DDTHH
  const dtHourMatch = s.match(/^(-?\d+)-(\d{2})-(\d{2})T(\d{2})$/);
  if (dtHourMatch) {
    return {
      year: parseInt(dtHourMatch[1], 10),
      month: parseInt(dtHourMatch[2], 10),
      day: parseInt(dtHourMatch[3], 10),
      hour: parseInt(dtHourMatch[4], 10),
      minute: 30,
      second: 0,
    };
  }

  // YYYY-MM-DD
  const fullMatch = s.match(/^(-?\d+)-(\d{2})-(\d{2})$/);
  if (fullMatch) {
    return {
      year: parseInt(fullMatch[1], 10),
      month: parseInt(fullMatch[2], 10),
      day: parseInt(fullMatch[3], 10),
      hour: 12,
      minute: 0,
      second: 0,
    };
  }

  // YYYY-MM
  const monthMatch = s.match(/^(-?\d+)-(\d{2})$/);
  if (monthMatch) {
    return {
      year: parseInt(monthMatch[1], 10),
      month: parseInt(monthMatch[2], 10),
      day: 15,
      hour: 12,
      minute: 0,
      second: 0,
    };
  }

  // YYYY (year or decade midpoint)
  const yearMatch = s.match(/^(-?\d+)$/);
  if (yearMatch) {
    return {
      year: parseInt(yearMatch[1], 10),
      month: 7,
      day: 1,
      hour: 12,
      minute: 0,
      second: 0,
    };
  }

  throw new Error(`Unrecognised best_estimate format: "${s}"`);
}

/**
 * Compute the signed difference in whole seconds between two DateTimePoints.
 * Positive = b is after a.
 */
export function diffInSeconds(a: DateTimePoint, b: DateTimePoint): number {
  const msA = Date.UTC(a.year, a.month - 1, a.day, a.hour, a.minute, a.second);
  const msB = Date.UTC(b.year, b.month - 1, b.day, b.hour, b.minute, b.second);
  return Math.round((msB - msA) / 1000);
}

/**
 * Compute the difference in whole days between two date points (ignores time-of-day).
 * Positive = b is after a.
 */
export function diffInDays(
  a: { year: number; month: number; day: number },
  b: { year: number; month: number; day: number },
): number {
  const dateA = Date.UTC(a.year, a.month - 1, a.day);
  const dateB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((dateB - dateA) / (1000 * 60 * 60 * 24));
}

/** Worst-case confidence between two NormalizedDates. */
function worstConfidence(a: DateConfidence, b: DateConfidence): DateConfidence {
  if (a === 'vague' || b === 'vague') return 'vague';
  if (a === 'approximate' || b === 'approximate') return 'approximate';
  return 'exact';
}

/** Worst-case resolution between two NormalizedDates (coarsest wins). */
function worstResolution(a: DateResolution, b: DateResolution): DateResolution {
  const order: DateResolution[] = ['second', 'minute', 'hour', 'day', 'month', 'year', 'decade'];
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  return order[Math.max(ia, ib)];
}

// ---------------------------------------------------------------------------
// Human-readable formatting
// ---------------------------------------------------------------------------

function padTime(n: number): string {
  return String(n).padStart(2, '0');
}

function formatHour12(h: number, m: number, s: number, includeMinutes: boolean, includeSeconds: boolean): string {
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  if (includeSeconds) {
    return `${h12}:${padTime(m)}:${padTime(s)} ${suffix}`;
  }
  if (includeMinutes) {
    return `${h12}:${padTime(m)} ${suffix}`;
  }
  return `${h12}:00 ${suffix}`;
}

/**
 * Format a number of seconds as a human-readable duration.
 * resolution: the coarsest resolution of the two dates (caps the precision).
 * confidence: qualifies the output with "about", "roughly", etc.
 */
export function formatDuration(
  absSeconds: number,
  resolution: DateResolution,
  confidence: DateConfidence,
): string {
  const qualifier = confidence === 'exact' ? '' : confidence === 'approximate' ? 'about ' : 'roughly ';

  if (absSeconds === 0) return 'the same time';

  // Seconds (second resolution only, under a minute)
  if (absSeconds < 60 && resolution === 'second') {
    const s = absSeconds;
    return `${qualifier}${s} ${s === 1 ? 'second' : 'seconds'}`;
  }

  // Minutes (minute or second resolution, under an hour)
  if (absSeconds < 3600 && (resolution === 'minute' || resolution === 'second')) {
    const m = Math.max(1, Math.round(absSeconds / 60));
    return `${qualifier}${m} ${m === 1 ? 'minute' : 'minutes'}`;
  }

  // Hours (any sub-day resolution, under a day)
  if (absSeconds < 86400 && (resolution === 'second' || resolution === 'minute' || resolution === 'hour')) {
    const h = Math.max(1, Math.round(absSeconds / 3600));
    return `${qualifier}${h} ${h === 1 ? 'hour' : 'hours'}`;
  }

  // From here work in days
  const absDays = absSeconds / 86400;
  const isSubMonthRes = resolution !== 'month' && resolution !== 'year' && resolution !== 'decade';

  // Days (sub-month resolutions, under 2 weeks)
  if (absDays < 14 && isSubMonthRes) {
    const d = Math.round(absDays);
    return `${qualifier}${d} ${d === 1 ? 'day' : 'days'}`;
  }

  // Weeks (sub-month resolutions, under ~2 months)
  if (absDays < 60 && isSubMonthRes) {
    const w = Math.round(absDays / 7);
    return `${qualifier}${w} ${w === 1 ? 'week' : 'weeks'}`;
  }

  // Months
  const months = absDays / 30.44;
  if (months < 18 && resolution !== 'year' && resolution !== 'decade') {
    const m = Math.round(months);
    return `${qualifier}${m} ${m === 1 ? 'month' : 'months'}`;
  }

  // Years — show months instead for exact, near-2-year, day-or-finer inputs
  const years = absDays / 365.25;
  const isSubYearRes = resolution !== 'year' && resolution !== 'decade';
  if (years < 2 && confidence === 'exact' && isSubYearRes) {
    const m = Math.round(months);
    return `${qualifier}${m} months`;
  }

  const roundedYears = resolution === 'decade'
    ? Math.round(years / 5) * 5       // round to nearest 5 for decade-resolution
    : Math.round(years);
  return `${qualifier}${roundedYears} ${roundedYears === 1 ? 'year' : 'years'}`;
}

/**
 * Format a DateTimePoint as a human-readable date/time string,
 * respecting resolution (don't show minutes if resolution is hour, etc.).
 */
export function formatDate(
  point: DateTimePoint,
  resolution: DateResolution,
  confidence: DateConfidence,
): string {
  const qualifier = confidence === 'vague' || confidence === 'approximate' ? 'around ' : '';
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  if (resolution === 'decade') {
    const decade = Math.floor(point.year / 10) * 10;
    return `${qualifier}the ${decade}s`;
  }
  if (resolution === 'year') {
    return `${qualifier}${point.year}`;
  }
  if (resolution === 'month') {
    return `${qualifier}${monthNames[point.month - 1]} ${point.year}`;
  }
  if (resolution === 'day') {
    return `${qualifier}${monthNames[point.month - 1]} ${point.day}, ${point.year}`;
  }

  const dateStr = `${monthNames[point.month - 1]} ${point.day}, ${point.year}`;

  if (resolution === 'hour') {
    return `${qualifier}${dateStr} at ${formatHour12(point.hour, point.minute, point.second, false, false)}`;
  }
  if (resolution === 'minute') {
    return `${qualifier}${dateStr} at ${formatHour12(point.hour, point.minute, point.second, true, false)}`;
  }
  // second
  return `${qualifier}${dateStr} at ${formatHour12(point.hour, point.minute, point.second, true, true)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a human-readable difference between two natural-language date/time
 * expressions. Supports resolution from decades down to individual seconds.
 *
 * @param dateA  First date expression (e.g. "summer 1997", "around 3pm yesterday")
 * @param dateB  Second date expression (e.g. "now", "when I graduated in 2001")
 * @param currentDateTime  Current date/time string (from the session, user's locale)
 * @param apiKey  Gemini API key
 * @returns Human-readable result, e.g. "about 4 years" / "roughly 27 years before" / "about 2 hours after"
 */
export async function computeTimeDifference(
  dateA: string,
  dateB: string,
  currentDateTime: string,
  apiKey: string,
): Promise<TimeDiffResult> {
  const [normA, normB] = await Promise.all([
    normalizeDate(dateA, currentDateTime, apiKey),
    normalizeDate(dateB, currentDateTime, apiKey),
  ]);

  const ptA = parseBestEstimate(normA);
  const ptB = parseBestEstimate(normB);
  const diffSecs = diffInSeconds(ptA, ptB);
  const absSecs = Math.abs(diffSecs);

  const conf = worstConfidence(normA.confidence, normB.confidence);
  const res = worstResolution(normA.resolution, normB.resolution);
  const duration = formatDuration(absSecs, res, conf);

  let result: string;
  if (absSecs === 0) {
    result = `${normA.description} and ${normB.description} are around the same time`;
  } else if (diffSecs > 0) {
    // B is after A
    result = `${duration} after ${normA.description} (${normB.description})`;
  } else {
    // A is after B
    result = `${duration} before ${normB.description} (${normA.description})`;
  }

  return { result, parsedA: normA, parsedB: normB };
}

/**
 * Compute a new point in time by adding or subtracting an offset from a base date.
 * Supports sub-day offsets such as "30 minutes later", "2 hours earlier",
 * "45 seconds after".
 *
 * @param date    Base date expression (e.g. "July 4th, 1976", "noon on New Year's Day")
 * @param offset  Offset expression (e.g. "6 months later", "2 hours earlier", "30 minutes after")
 * @param currentDateTime  Current date/time string
 * @param apiKey  Gemini API key
 * @returns Human-readable result, e.g. "around January 1977" or "30 minutes later — around 2:30 PM"
 */
export async function computeTimeOffset(
  date: string,
  offset: string,
  currentDateTime: string,
  apiKey: string,
): Promise<TimeOffsetResult> {
  // Normalize the base date
  const normBase = await normalizeDate(date, currentDateTime, apiKey);
  const ptBase = parseBestEstimate(normBase);

  // Ask Gemini to resolve the offset into a signed number of seconds
  const ai = new GoogleGenAI({ apiKey });
  const offsetResponse = await ai.models.generateContent({
    model: DATETIME_MODEL,
    contents: `Base date: "${date}" (interpreted as: ${normBase.description})\nOffset expression: "${offset}"`,
    config: {
      systemInstruction: `You are a date/time offset parser. Given a base date and an offset expression, return ONLY a JSON object — no markdown, no explanation.

{ "offset_seconds": number, "description": string }

offset_seconds: signed integer number of seconds to add to the base date (negative = earlier, positive = later).
description: brief human-readable interpretation of the offset applied.

Examples:
  "6 months later"       → { "offset_seconds": 15768000, "description": "about 6 months later" }
  "2 years earlier"      → { "offset_seconds": -63072000, "description": "about 2 years earlier" }
  "the following spring" → { "offset_seconds": 15552000, "description": "the following spring" }
  "30 minutes later"     → { "offset_seconds": 1800, "description": "30 minutes later" }
  "2 hours earlier"      → { "offset_seconds": -7200, "description": "2 hours earlier" }
  "45 seconds after"     → { "offset_seconds": 45, "description": "45 seconds later" }`,
      responseMimeType: 'application/json',
      temperature: 0,
    },
  });

  const offsetText = offsetResponse.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let offsetSeconds: number;
  let offsetDesc: string;
  try {
    const parsed = JSON.parse(offsetText) as { offset_seconds: number; description: string };
    offsetSeconds = parsed.offset_seconds;
    offsetDesc = parsed.description;
  } catch {
    throw new Error(`Failed to parse offset response: ${offsetText.slice(0, 200)}`);
  }

  // Apply the offset
  const baseMs = Date.UTC(ptBase.year, ptBase.month - 1, ptBase.day, ptBase.hour, ptBase.minute, ptBase.second);
  const resultMs = baseMs + offsetSeconds * 1000;
  const resultDate = new Date(resultMs);

  const resultPoint: DateTimePoint = {
    year: resultDate.getUTCFullYear(),
    month: resultDate.getUTCMonth() + 1,
    day: resultDate.getUTCDate(),
    hour: resultDate.getUTCHours(),
    minute: resultDate.getUTCMinutes(),
    second: resultDate.getUTCSeconds(),
  };

  // Use the base resolution for the result (don't inflate precision)
  const conf = normBase.confidence === 'exact' ? 'approximate' : normBase.confidence;
  const resultStr = formatDate(resultPoint, normBase.resolution, conf);
  const result = `${offsetDesc} from ${normBase.description} — ${resultStr}`;

  return { result, parsedBase: normBase };
}
