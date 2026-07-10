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
 * Post-session analysis service for LegacyBot.
 *
 * After a session completes, runs three analyses using Gemini text API:
 *   1. Event extraction — structured life events from the transcript (#35)
 *   2. Engagement assessment — comfort/engagement metrics (#45)
 *   3. Question suggestions — new Story Queue topics (#41)
 *
 * All analyses are stored to Firestore and displayed in the admin UI.
 *
 * Uses Gemini 2.5 Flash (text) for cost-efficient analysis.
 */

import { ThinkingLevel } from '@google/genai';
import {
  TranscriptEntry,
  InterviewQuestion,
  StoryEvent,
  EventSource,
  SessionEngagement,
  SuggestedQuestion,
  Dossier,
} from '../types';
import { invokeGemini } from './geminiBroker';

/** Format transcript entries into readable text for the LLM (no indices). */
function formatTranscript(entries: TranscriptEntry[]): string {
  return entries
    .map((e) => `${e.role === 'user' ? 'Storyteller' : 'Bot'}: ${e.text}`)
    .join('\n');
}

/** Format transcript entries with [index] prefix for event extraction. */
function formatTranscriptIndexed(entries: TranscriptEntry[]): string {
  return entries
    .map((e, idx) => `[${idx}] ${e.role === 'user' ? 'Storyteller' : 'Bot'}: ${e.text}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Event Extraction (#35)
// ---------------------------------------------------------------------------

export async function extractEvents(
  entries: TranscriptEntry[],
  sessionId: string,
  existingEvents: StoryEvent[],
): Promise<Omit<StoryEvent, 'id' | 'createdAt' | 'updatedAt'>[]> {
  const transcript = formatTranscriptIndexed(entries);

  const existingEventsContext = existingEvents.length > 0
    ? `\nExisting events already extracted from previous sessions:\n${JSON.stringify(existingEvents.map(e => ({ title: e.title, date: e.date, description: e.description })), null, 2)}\n\nDo NOT duplicate these. Only extract NEW events or provide additional details for existing events.`
    : '';

  const response = await invokeGemini({
    model: 'gemini-3.1-pro-preview',
    config: { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } },
    contents: `You are an expert oral historian analyzing an interview transcript.
Extract discrete life events mentioned in this conversation. Each event should be a specific moment, period, or experience — not a vague topic.

Each line of the transcript is prefixed with [index]. Use these indices to record which lines mention each event.

For each event provide:
- title: Short descriptive title (e.g. "First day at Lincoln Elementary")
- description: 2-3 sentence narrative summary
- date: ISO date, partial date, or fuzzy description (e.g. "1962", "summer 1962", "early 1970s"). null if unknown.
- datePrecision: "exact" | "month" | "year" | "decade" | "approximate"
- location: Place name or null if not mentioned
- themes: Array of themes (e.g. ["childhood", "education"])
- people: Names of people mentioned in connection with this event
- entryIndices: Array of transcript line indices (numbers) that mention or describe this event

${existingEventsContext}

Respond with a JSON array of events. If no new events are found, respond with [].

TRANSCRIPT:
${transcript}`,
  });

  const text = response.text ?? '[]';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const rawEvents = JSON.parse(jsonMatch[0]);
    return rawEvents.map((e: any) => ({
      title: e.title ?? 'Untitled event',
      description: e.description ?? '',
      date: e.date ?? null,
      datePrecision: e.datePrecision ?? 'approximate',
      location: e.location ?? null,
      themes: Array.isArray(e.themes) ? e.themes : [],
      people: Array.isArray(e.people) ? e.people : [],
      sources: [{
        sessionId,
        entryIndices: Array.isArray(e.entryIndices) ? (e.entryIndices as number[]) : [],
      }] as EventSource[],
    }));
  } catch {
    console.error('[PostSession] Failed to parse events JSON');
    return [];
  }
}

// ---------------------------------------------------------------------------
// Engagement Assessment (#45)
// ---------------------------------------------------------------------------

/** Compute text-based engagement metrics from a transcript. */
export function computeEngagementMetrics(
  entries: TranscriptEntry[],
): Pick<SessionEngagement, 'speakingRatio' | 'avgResponseLength'> {
  const userEntries = entries.filter((e) => e.role === 'user');
  const botEntries = entries.filter((e) => e.role === 'bot');

  const userWords = userEntries.reduce((sum, e) => sum + e.text.split(/\s+/).length, 0);
  const botWords = botEntries.reduce((sum, e) => sum + e.text.split(/\s+/).length, 0);
  const totalWords = userWords + botWords;

  return {
    speakingRatio: totalWords > 0 ? userWords / totalWords : 0,
    avgResponseLength: userEntries.length > 0 ? userWords / userEntries.length : 0,
  };
}

/** Use Gemini to assess sentiment and comfort from the transcript. */
export async function assessEngagement(
  entries: TranscriptEntry[],
  questions: InterviewQuestion[],
): Promise<Omit<SessionEngagement, 'analyzedAt'>> {
  const basicMetrics = computeEngagementMetrics(entries);
  const transcript = formatTranscript(entries);

  const questionContext = questions.length > 0
    ? `\nStory Queue topics discussed:\n${questions.map(q => `- "${q.text}" (${q.status})`).join('\n')}`
    : '';

  const response = await invokeGemini({
    model: 'gemini-3.1-pro-preview',
    config: { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } },
    contents: `You are an expert at analyzing interview dynamics. Assess the storyteller's engagement and emotional comfort in this interview transcript.

Provide your assessment as JSON with these fields:
- sentiment: "positive" | "neutral" | "guarded" | "distressed"
- comfortScore: 0-100 (100 = very comfortable and engaged)
- topicEngagement: object mapping topic/question text to a 0-100 engagement score
- flags: array of concern flags (e.g. "topic_avoidance:military", "short_responses", "declining_engagement", "emotional_distress:war_stories")

Consider:
- Response length and detail (longer, more detailed = more engaged)
- Emotional language and enthusiasm
- Topic avoidance or deflection
- Storytelling flow vs terse Q&A responses
- Signs of fatigue or discomfort
${questionContext}

TRANSCRIPT:
${transcript}`,
  });

  const text = response.text ?? '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  let aiAssessment = {
    sentiment: 'neutral' as const,
    comfortScore: 50,
    topicEngagement: {} as Record<string, number>,
    flags: [] as string[],
  };

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      aiAssessment = {
        sentiment: parsed.sentiment ?? 'neutral',
        comfortScore: typeof parsed.comfortScore === 'number' ? parsed.comfortScore : 50,
        topicEngagement: parsed.topicEngagement ?? {},
        flags: Array.isArray(parsed.flags) ? parsed.flags : [],
      };
    } catch {
      console.error('[PostSession] Failed to parse engagement JSON');
    }
  }

  return {
    ...basicMetrics,
    ...aiAssessment,
  };
}

// ---------------------------------------------------------------------------
// Question Suggestions (#41)
// ---------------------------------------------------------------------------

/** Suggest new Story Queue questions based on transcript analysis. */
export async function suggestQuestions(
  entries: TranscriptEntry[],
  existingQuestions: InterviewQuestion[],
  dossier: Dossier,
): Promise<SuggestedQuestion[]> {
  const transcript = formatTranscript(entries);

  const response = await invokeGemini({
    model: 'gemini-3.1-pro-preview',
    config: { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } },
    contents: `You are an expert oral historian helping plan the next interview session. Based on this transcript, suggest 3-5 new questions for the Story Queue.

Look for:
- People mentioned but never explored ("You mentioned your brother Sam...")
- Events referenced but not elaborated on ("You said there was a fire...")
- Time periods with no coverage (gaps in the life story)
- Interesting threads the storyteller seemed eager to discuss
- Topics the storyteller deflected that might be worth revisiting gently

Do NOT suggest questions that overlap with existing ones.

Existing Story Queue:
${existingQuestions.map(q => `- "${q.text}" (${q.status}: ${q.findings || 'no findings yet'})`).join('\n')}

Storyteller: ${dossier.storytellerName}
Background: ${dossier.storytellerContext || 'Not provided'}
Family: ${JSON.stringify(dossier.familyTree)}

Respond with a JSON array of objects: [{ "text": "the question", "rationale": "why this is a good follow-up" }]

TRANSCRIPT:
${transcript}`,
  });

  const text = response.text ?? '[]';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed
      .filter((q: any) => q.text && q.rationale)
      .map((q: any) => ({ text: q.text, rationale: q.rationale }));
  } catch {
    console.error('[PostSession] Failed to parse suggestions JSON');
    return [];
  }
}

// ---------------------------------------------------------------------------
// Rolling profile summary (#147)
// ---------------------------------------------------------------------------

/**
 * Regenerate a SHORT "who is this storyteller" profile after each session.
 *
 * This compact summary is injected into the interview system instruction in
 * place of the full biography, keeping the prompt small while still giving the
 * interviewer enough to start strong. Full detail (original biography, prior
 * sessions) stays retrievable on demand via getBiography / searchContext.
 *
 * Combines the original biography, the previous profile, the Story Queue
 * findings, and the latest transcript. On any failure it returns the previous
 * profile (or a trimmed biography) so the field is never blanked.
 */
export async function generateProfileSummary(
  entries: TranscriptEntry[],
  questions: InterviewQuestion[],
  dossier: Dossier,
): Promise<string> {
  const transcript = formatTranscript(entries);
  const findings = questions
    .filter((q) => q.findings?.trim())
    .map((q) => `- ${q.text}: ${q.findings}`)
    .join('\n');
  const fallback = dossier.profileSummary || (dossier.storytellerContext || '').slice(0, 600);

  try {
    const response = await invokeGemini({
      model: 'gemini-3-flash-preview',
      contents: `You maintain a SHORT running profile of a storyteller being interviewed for a biography. It is the interviewer's at-a-glance memory — full detail lives elsewhere and is looked up on demand.

Write an updated profile in 4-6 sentences (max ~700 characters), prose only, no headings. Include: who they are, the key people/places/eras in their life, the main threads explored so far, and where the conversation is currently heading. Be factual and specific; no fluff.

Storyteller: ${dossier.storytellerName}
Original background: ${dossier.storytellerContext || 'Not provided'}
Previous profile: ${dossier.profileSummary || '(none yet)'}
What's been learned so far (Story Queue findings):
${findings || '(none yet)'}

Latest session transcript:
${transcript}`,
    });
    const summary = response.text?.trim();
    return summary && summary.length > 0 ? summary : fallback;
  } catch (err) {
    console.error('[PostSession] Profile summary generation failed:', err);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Transcript cleanup (#99)
// ---------------------------------------------------------------------------

/**
 * Produce a clean, readable version of a raw speech-to-text transcript turn.
 *
 * Uses Gemini Flash to correct transcription errors, fix punctuation/
 * capitalisation, and remove filler words ("um", "uh", "you know").
 * Content is never summarised or omitted.
 *
 * Called asynchronously after each turn is committed to Firestore so it
 * does not block the live session.
 */
export async function cleanTranscriptText(rawText: string): Promise<string> {
  if (!rawText.trim()) return rawText;
  const response = await invokeGemini({
    model: 'gemini-3.1-flash-lite-preview',
    contents: `Clean this speech transcript for readability. Fix transcription errors, correct punctuation and capitalisation, and remove filler words like "um", "uh", "you know", "like" when used as fillers. Do NOT summarise, shorten, or omit any content. Return ONLY the cleaned text — no explanation, no quotes, no prefix.\n\n${rawText}`,
  });
  return response.text?.trim() ?? rawText;
}
