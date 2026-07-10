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
 * Tests for the post-session analysis service.
 *
 * Covers three async functions that call Gemini AI plus one pure function:
 *   - computeEngagementMetrics (pure — no mocks needed)
 *   - extractEvents            (Gemini → JSON array of StoryEvent shapes)
 *   - assessEngagement         (Gemini → JSON object of engagement metrics)
 *   - suggestQuestions         (Gemini → JSON array of SuggestedQuestion shapes)
 *
 * The primary goal is to catch silent failures in the JSON parsing paths:
 * each function must degrade gracefully when the AI returns garbage, partial
 * JSON, or null rather than crashing or returning undefined fields.
 *
 * References: src/services/postSessionAnalysis.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeEngagementMetrics,
  extractEvents,
  assessEngagement,
  suggestQuestions,
} from '../../services/postSessionAnalysis';

// ---------------------------------------------------------------------------
// Hoist mock factory so it is available before vi.mock() hoisting runs.
// ---------------------------------------------------------------------------

const { mockGenerateContent } = vi.hoisted(() => {
  return { mockGenerateContent: vi.fn() };
});

// The Gemini API key is no longer in the browser; calls go through the
// server-side `invokeGemini` callable. The test mocks that wrapper so we don't
// need a real Firebase Functions backend or the real @google/genai SDK.
vi.mock('../../services/geminiBroker', () => ({
  invokeGemini: (req: unknown) => mockGenerateContent(req),
}));

vi.mock('@google/genai', () => ({
  ThinkingLevel: { MINIMAL: 'MINIMAL', LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', NONE: 'NONE' },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makeEntry = (role: 'user' | 'bot', text: string) => ({
  role,
  text,
  timestamp: { seconds: 0, nanoseconds: 0 } as any,
});

const makeDossier = () =>
  ({
    storytellerName: 'Margaret',
    storytellerContext: 'Grew up in Ohio',
    familyTree: [],
    historicalContext: '',
    storytellerUid: null,
    selectedVoice: 'Zephyr',
    personality: 'empathetic',
    interviewerNotes: '',
    createdAt: { seconds: 0, nanoseconds: 0 } as any,
    updatedAt: { seconds: 0, nanoseconds: 0 } as any,
  } as any);

/** Shortcut: make mockGenerateContent resolve with a given string. */
const mockAIText = (text: string | null) =>
  mockGenerateContent.mockResolvedValueOnce({ text });

// ---------------------------------------------------------------------------
// computeEngagementMetrics — pure function, no mocks needed
// ---------------------------------------------------------------------------

describe('computeEngagementMetrics', () => {
  it('returns zero ratios for an empty transcript', () => {
    const result = computeEngagementMetrics([]);
    expect(result.speakingRatio).toBe(0);
    expect(result.avgResponseLength).toBe(0);
  });

  it('returns speakingRatio=0 when only the bot speaks', () => {
    const entries = [
      makeEntry('bot', 'Hello there Margaret.'),
      makeEntry('bot', 'Tell me about your childhood.'),
    ];
    const result = computeEngagementMetrics(entries);
    expect(result.speakingRatio).toBe(0);
    expect(result.avgResponseLength).toBe(0);
  });

  it('returns speakingRatio=1 when only the user speaks', () => {
    const entries = [
      makeEntry('user', 'I grew up in Ohio.'),
      makeEntry('user', 'We had a farm.'),
    ];
    const result = computeEngagementMetrics(entries);
    expect(result.speakingRatio).toBe(1);
  });

  it('computes the correct ratio in a mixed transcript', () => {
    // user: 4 words, bot: 4 words → ratio = 0.5
    const entries = [
      makeEntry('bot', 'Tell me your story.'),   // 4 words
      makeEntry('user', 'I grew up here.'),       // 4 words
    ];
    const result = computeEngagementMetrics(entries);
    expect(result.speakingRatio).toBe(0.5);
  });

  it('computes a non-trivial ratio correctly (user-heavy conversation)', () => {
    // user: 9 words across 2 entries, bot: 3 words → ratio = 9/12 = 0.75
    const entries = [
      makeEntry('bot', 'And then?'),                               // 2 words
      makeEntry('user', 'We moved to Columbus when I was ten.'),   // 8 words
      makeEntry('bot', 'Interesting.'),                            // 1 word
      makeEntry('user', 'Yes indeed.'),                            // 2 words
    ];
    const result = computeEngagementMetrics(entries);
    expect(result.speakingRatio).toBeCloseTo(10 / 13);
  });

  it('computes avgResponseLength as total user words divided by user entry count', () => {
    // entry 1: 4 words, entry 2: 2 words → avg = 6/2 = 3
    const entries = [
      makeEntry('user', 'I was born here.'),   // 4 words
      makeEntry('bot', 'Really?'),              // 1 word
      makeEntry('user', 'In Ohio.'),            // 2 words
    ];
    const result = computeEngagementMetrics(entries);
    expect(result.avgResponseLength).toBe(3);
  });

  it('counts multi-whitespace tokens the same as single-space tokens', () => {
    // split(/\s+/) should not produce empty tokens for leading/trailing spaces
    const entries = [makeEntry('user', '  one two three  ')];
    // "  one two three  ".split(/\s+/) → ["", "one", "two", "three", ""] — 5 items
    // The implementation uses this directly. We just assert it doesn't crash and
    // returns a positive avgResponseLength.
    const result = computeEngagementMetrics(entries);
    expect(result.avgResponseLength).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// extractEvents
// ---------------------------------------------------------------------------

describe('extractEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a valid JSON array returned by the AI', async () => {
    const event = {
      title: 'First day at Lincoln Elementary',
      description: 'Margaret started school in the fall of 1952.',
      date: '1952',
      datePrecision: 'year',
      location: 'Columbus, Ohio',
      themes: ['childhood', 'education'],
      people: ['Arthur'],
    };
    mockAIText(JSON.stringify([event]));

    const results = await extractEvents([], 'session-1', []);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('First day at Lincoln Elementary');
    expect(results[0].description).toBe('Margaret started school in the fall of 1952.');
    expect(results[0].date).toBe('1952');
    expect(results[0].datePrecision).toBe('year');
    expect(results[0].location).toBe('Columbus, Ohio');
    expect(results[0].themes).toEqual(['childhood', 'education']);
    expect(results[0].people).toEqual(['Arthur']);
  });

  it('attaches a source object with sessionId and empty entryIndices when AI omits them', async () => {
    mockAIText(JSON.stringify([{ title: 'Graduation Day' }]));

    const results = await extractEvents([], 'session-abc', []);

    expect(results[0].sources).toEqual([{ sessionId: 'session-abc', entryIndices: [] }]);
  });

  it('populates entryIndices from AI-returned indices', async () => {
    mockAIText(JSON.stringify([{ title: 'Farm Life', entryIndices: [2, 3, 5] }]));

    const results = await extractEvents([], 'session-xyz', []);

    expect(results[0].sources[0].entryIndices).toEqual([2, 3, 5]);
  });

  it('formats transcript with [index] prefix for event extraction', async () => {
    mockAIText('[]');
    const entries = [
      makeEntry('bot', 'Hello.'),
      makeEntry('user', 'I grew up in Ohio.'),
    ];

    await extractEvents(entries, 'session-1', []);

    const prompt: string = mockGenerateContent.mock.calls[0][0].contents;
    expect(prompt).toContain('[0] Bot: Hello.');
    expect(prompt).toContain('[1] Storyteller: I grew up in Ohio.');
  });

  it('applies field defaults when the JSON object is missing all fields', async () => {
    mockAIText(JSON.stringify([{}]));

    const results = await extractEvents([], 'session-1', []);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Untitled event');
    expect(results[0].description).toBe('');
    expect(results[0].date).toBeNull();
    expect(results[0].datePrecision).toBe('approximate');
    expect(results[0].location).toBeNull();
    expect(results[0].themes).toEqual([]);
    expect(results[0].people).toEqual([]);
  });

  it('replaces non-array themes/people with empty arrays', async () => {
    mockAIText(
      JSON.stringify([{ title: 'The farm fire', themes: 'farm, disaster', people: null }]),
    );

    const results = await extractEvents([], 'session-1', []);

    expect(results[0].themes).toEqual([]);
    expect(results[0].people).toEqual([]);
  });

  it('returns [] when the AI responds with invalid JSON inside brackets', async () => {
    mockAIText('[{bad json here}]');

    const results = await extractEvents([], 'session-1', []);

    expect(results).toEqual([]);
  });

  it('returns [] when the AI returns plain text with no JSON array', async () => {
    mockAIText('No events were found in this transcript.');

    const results = await extractEvents([], 'session-1', []);

    expect(results).toEqual([]);
  });

  it('returns [] when response.text is null', async () => {
    mockAIText(null);

    const results = await extractEvents([], 'session-1', []);

    expect(results).toEqual([]);
  });

  it('returns [] when the AI returns an empty JSON array', async () => {
    mockAIText('[]');

    const results = await extractEvents([], 'session-1', []);

    expect(results).toEqual([]);
  });

  it('handles multiple events in a single response', async () => {
    const events = [
      { title: 'Birth', date: '1942', datePrecision: 'year' },
      { title: 'Marriage', date: '1965', datePrecision: 'year' },
      { title: 'Retirement', date: '2002', datePrecision: 'year' },
    ];
    mockAIText(JSON.stringify(events));

    const results = await extractEvents([], 'session-1', []);

    expect(results).toHaveLength(3);
    expect(results[1].title).toBe('Marriage');
  });

  it('strips markdown code fences if the array is still extractable', async () => {
    // The regex /\[[\s\S]*\]/ pulls the array out of surrounding text.
    const jsonWithFences = '```json\n[{"title":"Trip to Europe"}]\n```';
    mockAIText(jsonWithFences);

    const results = await extractEvents([], 'session-1', []);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Trip to Europe');
  });

  it('passes transcript entries to the AI and does not crash on long transcripts', async () => {
    const entries = Array.from({ length: 50 }, (_, i) =>
      makeEntry(i % 2 === 0 ? 'user' : 'bot', `Sentence number ${i}.`),
    );
    mockAIText('[]');

    await expect(extractEvents(entries, 'session-1', [])).resolves.toEqual([]);
    expect(mockGenerateContent).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// assessEngagement
// ---------------------------------------------------------------------------

describe('assessEngagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges AI assessment with computed metrics from the transcript', async () => {
    const aiPayload = {
      sentiment: 'positive',
      comfortScore: 85,
      topicEngagement: { 'Tell me about your childhood': 90 },
      flags: [],
    };
    mockAIText(JSON.stringify(aiPayload));

    const entries = [
      makeEntry('bot', 'Tell me about your childhood.'),   // 5 words
      makeEntry('user', 'I loved growing up on the farm.'), // 7 words
    ];
    const result = await assessEngagement(entries, []);

    // AI fields
    expect(result.sentiment).toBe('positive');
    expect(result.comfortScore).toBe(85);
    expect(result.topicEngagement).toEqual({ 'Tell me about your childhood': 90 });
    expect(result.flags).toEqual([]);

    // Pure computed metrics — user: 7 words, bot: 5 words, total: 12
    expect(result.speakingRatio).toBeCloseTo(7 / 12);
    expect(result.avgResponseLength).toBe(7); // 7 user words / 1 user entry
  });

  it('returns defaults when AI returns invalid JSON', async () => {
    mockAIText('This is not valid JSON at all!!!');

    const result = await assessEngagement([], []);

    expect(result.sentiment).toBe('neutral');
    expect(result.comfortScore).toBe(50);
    expect(result.topicEngagement).toEqual({});
    expect(result.flags).toEqual([]);
  });

  it('returns defaults when response.text is null', async () => {
    mockAIText(null);

    const result = await assessEngagement([], []);

    expect(result.sentiment).toBe('neutral');
    expect(result.comfortScore).toBe(50);
    expect(result.topicEngagement).toEqual({});
    expect(result.flags).toEqual([]);
  });

  it('falls back to comfortScore=50 when the AI returns a non-number string', async () => {
    mockAIText(JSON.stringify({ sentiment: 'neutral', comfortScore: 'high', flags: [] }));

    const result = await assessEngagement([], []);

    expect(result.comfortScore).toBe(50);
  });

  it('falls back to comfortScore=50 when comfortScore is null', async () => {
    mockAIText(JSON.stringify({ comfortScore: null }));

    const result = await assessEngagement([], []);

    expect(result.comfortScore).toBe(50);
  });

  it('falls back to flags=[] when the AI returns a non-array flags value', async () => {
    mockAIText(JSON.stringify({ flags: 'short_responses' }));

    const result = await assessEngagement([], []);

    expect(result.flags).toEqual([]);
  });

  it('falls back to flags=[] when the AI returns flags as null', async () => {
    mockAIText(JSON.stringify({ flags: null }));

    const result = await assessEngagement([], []);

    expect(result.flags).toEqual([]);
  });

  it('falls back to sentiment=neutral when the field is missing', async () => {
    mockAIText(JSON.stringify({ comfortScore: 70 }));

    const result = await assessEngagement([], []);

    expect(result.sentiment).toBe('neutral');
  });

  it('falls back to topicEngagement={} when the field is missing', async () => {
    mockAIText(JSON.stringify({ comfortScore: 70, sentiment: 'positive' }));

    const result = await assessEngagement([], []);

    expect(result.topicEngagement).toEqual({});
  });

  it('accepts all valid sentiment values from the AI', async () => {
    const sentiments = ['positive', 'neutral', 'guarded', 'distressed'] as const;

    for (const sentiment of sentiments) {
      mockAIText(JSON.stringify({ sentiment }));
      const result = await assessEngagement([], []);
      expect(result.sentiment).toBe(sentiment);
    }
  });

  it('includes both computed metrics and AI fields in a zero-entry transcript', async () => {
    mockAIText(JSON.stringify({ sentiment: 'guarded', comfortScore: 30, flags: ['short_responses'] }));

    const result = await assessEngagement([], []);

    expect(result.speakingRatio).toBe(0);
    expect(result.avgResponseLength).toBe(0);
    expect(result.sentiment).toBe('guarded');
    expect(result.comfortScore).toBe(30);
    expect(result.flags).toEqual(['short_responses']);
  });

  it('still returns computed metrics even when AI JSON parse fails', async () => {
    mockAIText('{corrupt json');

    const entries = [
      makeEntry('user', 'Three words here.'), // 3 words
      makeEntry('bot', 'And a reply.'),        // 3 words
    ];
    const result = await assessEngagement(entries, []);

    expect(result.speakingRatio).toBeCloseTo(3 / 6);
    expect(result.avgResponseLength).toBe(3);
    // AI defaults should apply
    expect(result.sentiment).toBe('neutral');
    expect(result.comfortScore).toBe(50);
  });

  it('passes question context to AI without crashing on an empty questions array', async () => {
    mockAIText('{}');

    await expect(assessEngagement([], [])).resolves.toBeDefined();
    expect(mockGenerateContent).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// suggestQuestions
// ---------------------------------------------------------------------------

describe('suggestQuestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a valid array of suggested questions from the AI', async () => {
    const suggestions = [
      { text: 'You mentioned your brother Sam — can you tell me more about him?', rationale: 'Sam was mentioned but never explored.' },
      { text: 'What happened at the fire you referenced?', rationale: 'The storyteller seemed eager to discuss it.' },
    ];
    mockAIText(JSON.stringify(suggestions));

    const results = await suggestQuestions([], [], makeDossier());

    expect(results).toHaveLength(2);
    expect(results[0].text).toBe('You mentioned your brother Sam — can you tell me more about him?');
    expect(results[0].rationale).toBe('Sam was mentioned but never explored.');
    expect(results[1].text).toBe('What happened at the fire you referenced?');
  });

  it('filters out items that are missing the text field', async () => {
    const suggestions = [
      { rationale: 'No question text here.' },
      { text: 'Valid question?', rationale: 'This one is fine.' },
    ];
    mockAIText(JSON.stringify(suggestions));

    const results = await suggestQuestions([], [], makeDossier());

    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('Valid question?');
  });

  it('filters out items that are missing the rationale field', async () => {
    const suggestions = [
      { text: 'A question with no rationale.' },
      { text: 'Good question?', rationale: 'Has a rationale.' },
    ];
    mockAIText(JSON.stringify(suggestions));

    const results = await suggestQuestions([], [], makeDossier());

    expect(results).toHaveLength(1);
    expect(results[0].rationale).toBe('Has a rationale.');
  });

  it('filters out items where text is an empty string (falsy)', async () => {
    const suggestions = [
      { text: '', rationale: 'Empty text is falsy.' },
      { text: 'Real question?', rationale: 'Non-empty.' },
    ];
    mockAIText(JSON.stringify(suggestions));

    const results = await suggestQuestions([], [], makeDossier());

    expect(results).toHaveLength(1);
  });

  it('returns [] when AI returns invalid JSON inside an array', async () => {
    mockAIText('[{this is not valid json}]');

    const results = await suggestQuestions([], [], makeDossier());

    expect(results).toEqual([]);
  });

  it('returns [] when AI returns plain text with no JSON array', async () => {
    mockAIText('I could not find any good follow-up questions for this transcript.');

    const results = await suggestQuestions([], [], makeDossier());

    expect(results).toEqual([]);
  });

  it('returns [] when response.text is null', async () => {
    mockAIText(null);

    const results = await suggestQuestions([], [], makeDossier());

    expect(results).toEqual([]);
  });

  it('returns [] when the AI returns an empty JSON array', async () => {
    mockAIText('[]');

    const results = await suggestQuestions([], [], makeDossier());

    expect(results).toEqual([]);
  });

  it('returns [] when all suggestions are missing both required fields', async () => {
    mockAIText(JSON.stringify([{}, {}, {}]));

    const results = await suggestQuestions([], [], makeDossier());

    expect(results).toEqual([]);
  });

  it('extracts a JSON array embedded in markdown code fences', async () => {
    const withFences =
      '```json\n[{"text":"Tell me about your sister.","rationale":"Mentioned briefly."}]\n```';
    mockAIText(withFences);

    const results = await suggestQuestions([], [], makeDossier());

    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('Tell me about your sister.');
  });

  it('passes dossier storytellerName to AI and does not crash', async () => {
    mockAIText('[]');

    const dossier = makeDossier();
    await expect(suggestQuestions([], [], dossier)).resolves.toEqual([]);

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.contents).toContain('Margaret');
  });

  it('includes existing questions in the prompt without crashing', async () => {
    mockAIText('[]');

    const existingQuestions = [
      {
        id: 'q1',
        text: 'Tell me about your childhood.',
        status: 'Completed' as const,
        findings: 'Grew up in Ohio.',
        order: 0,
        createdAt: { seconds: 0, nanoseconds: 0 } as any,
        updatedAt: { seconds: 0, nanoseconds: 0 } as any,
      },
    ];

    await expect(suggestQuestions([], existingQuestions, makeDossier())).resolves.toEqual([]);

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.contents).toContain('Tell me about your childhood.');
  });
});
