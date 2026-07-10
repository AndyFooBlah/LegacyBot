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
 * Server-side memoir generation for LegacyBot.
 *
 * Synthesizes a storyteller's interview transcripts, extracted life events,
 * and Story Queue findings into a cohesive multi-chapter memoir stored in
 * Firestore at families/{familyId}/dossiers/{dossierId}/memoirs/{memoirId}.
 *
 * Two-pass Gemini pipeline:
 *   Pass 1 — Generate chapter outline from all available material.
 *   Pass 2 — Generate full prose for each chapter with inline citations.
 *
 * Model: gemini-3.1-pro-preview with ThinkingLevel.HIGH (same as gap analysis).
 */

import * as admin from 'firebase-admin';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const db = () => admin.firestore();

// ---------------------------------------------------------------------------
// Data reading (Admin SDK)
// ---------------------------------------------------------------------------

interface TranscriptEntry {
  role: 'user' | 'bot';
  text: string;
}

interface StoryEvent {
  id?: string;
  title: string;
  date: string | null;
  description: string;
}

interface Question {
  id: string;
  text: string;
  status: 'Unasked' | 'InProgress' | 'Completed';
  findings: string;
}

interface DossierData {
  storytellerName: string;
  preferredName?: string;
  storytellerContext?: string;
  historicalContext?: string;
}

async function getAllTranscripts(
  familyId: string,
  dossierId: string,
): Promise<{ sessionId: string; entries: TranscriptEntry[] }[]> {
  const sessionsSnap = await db()
    .collection('families').doc(familyId)
    .collection('dossiers').doc(dossierId)
    .collection('sessions')
    .where('status', '==', 'completed')
    .orderBy('startTime', 'asc')
    .get();

  const results: { sessionId: string; entries: TranscriptEntry[] }[] = [];
  for (const sessionDoc of sessionsSnap.docs) {
    const transcriptDoc = await db()
      .collection('families').doc(familyId)
      .collection('dossiers').doc(dossierId)
      .collection('sessions').doc(sessionDoc.id)
      .collection('transcript').doc('entries')
      .get();
    const entries: TranscriptEntry[] = transcriptDoc.exists
      ? (transcriptDoc.data()?.entries ?? [])
      : [];
    if (entries.length > 0) {
      results.push({ sessionId: sessionDoc.id, entries });
    }
  }
  return results;
}

async function getEvents(familyId: string, dossierId: string): Promise<StoryEvent[]> {
  const snap = await db()
    .collection('families').doc(familyId)
    .collection('dossiers').doc(dossierId)
    .collection('events')
    .orderBy('createdAt', 'asc')
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StoryEvent);
}

async function getQuestions(familyId: string, dossierId: string): Promise<Question[]> {
  const snap = await db()
    .collection('families').doc(familyId)
    .collection('dossiers').doc(dossierId)
    .collection('questions')
    .orderBy('order', 'asc')
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Question);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChapterCitation {
  sessionId: string;
  entryIndex: number;
  quote: string;
}

export interface MemoirChapter {
  title: string;
  content: string;
  eventIds: string[];
  citations: ChapterCitation[];
  order: number;
}

// ---------------------------------------------------------------------------
// Gemini generation helpers
// ---------------------------------------------------------------------------

/**
 * Pass 1: Generate a chapter outline from all available material.
 */
async function generateOutline(
  dossier: DossierData,
  events: StoryEvent[],
  questions: Question[],
  sessions: { sessionId: string; entries: TranscriptEntry[] }[],
  ai: GoogleGenAI,
): Promise<{ title: string; summary: string; relevantEventIds: string[] }[]> {
  const transcriptSummaries = sessions.map((s, i) => {
    const words = s.entries
      .map((e) => `${e.role === 'user' ? 'Storyteller' : 'Bot'}: ${e.text}`)
      .join('\n');
    return `SESSION ${i + 1} (${s.sessionId}):\n${words.slice(0, 3000)}${words.length > 3000 ? '\n...[truncated]' : ''}`;
  }).join('\n\n');

  const eventSummary = events
    .map((e) => `- ${e.title} (${e.date ?? 'undated'}): ${e.description}`)
    .join('\n');

  const questionFindings = questions
    .filter((q) => q.findings)
    .map((q) => `- ${q.text}: ${q.findings}`)
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    config: { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } },
    contents: `You are an expert biographer creating a memoir outline for ${dossier.storytellerName}.

Based on the interview transcripts, extracted events, and topic findings below, create a chapter outline for a third-person biography.

GUIDELINES:
- Organize chronologically where possible
- 3-8 chapters depending on material available
- Each chapter should cover a distinct period or theme of their life
- Include a brief summary (2-3 sentences) of what each chapter will cover
- Note which event IDs are relevant to each chapter

STORYTELLER: ${dossier.storytellerName}
BACKGROUND: ${dossier.storytellerContext || 'Not provided'}
HISTORICAL CONTEXT: ${dossier.historicalContext || 'Not provided'}

EXTRACTED EVENTS:
${eventSummary || 'No events extracted yet.'}

TOPIC FINDINGS:
${questionFindings || 'No findings yet.'}

TRANSCRIPTS:
${transcriptSummaries || 'No transcripts available.'}

Respond with a JSON array:
[{ "title": "Chapter Title", "summary": "Brief description of chapter content", "relevantEventIds": ["id1", "id2"] }]`,
  });

  const text = response.text ?? '[]';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
}

/**
 * Pass 2: Generate full chapter prose with inline citations.
 */
async function generateChapter(
  chapterTitle: string,
  chapterSummary: string,
  dossier: DossierData,
  events: StoryEvent[],
  sessions: { sessionId: string; entries: TranscriptEntry[] }[],
  ai: GoogleGenAI,
): Promise<{ content: string; citations: ChapterCitation[] }> {
  const allTranscriptText = sessions.map((s, i) =>
    s.entries.map((e, idx) =>
      `[S${i}:E${idx}] ${e.role === 'user' ? 'Storyteller' : 'Bot'}: ${e.text}`
    ).join('\n')
  ).join('\n\n');

  const eventContext = events
    .map((e) => `- ${e.title} (${e.date ?? 'undated'}): ${e.description}`)
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    config: { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } },
    contents: `You are writing a chapter of a third-person biography about ${dossier.storytellerName}.

CHAPTER: "${chapterTitle}"
CHAPTER FOCUS: ${chapterSummary}

Write 500-1500 words for this chapter. Guidelines:
- Write in third person ("${dossier.storytellerName} remembered...")
- Use a warm, literary but accessible tone
- Weave in direct quotes from the storyteller where impactful (cite using [S#:E#] format)
- Include specific details from the interviews: names, places, dates
- Create smooth narrative transitions between topics
- End the chapter with a thematic closing that connects to the storyteller's character

When quoting the storyteller directly, use the [S#:E#] citation format. Example:
"${dossier.storytellerName} smiled as she recalled, 'We used to play by the creek every summer' [S0:E5]."

RELEVANT EVENTS:
${eventContext || 'None'}

TRANSCRIPTS (with citation markers):
${allTranscriptText.slice(0, 8000)}

Respond with just the chapter text in markdown format.`,
  });

  const content = response.text ?? '';

  // Extract citations from [S#:E#] markers
  const citations: ChapterCitation[] = [];
  const citationRegex = /\[S(\d+):E(\d+)\]/g;
  let match;
  while ((match = citationRegex.exec(content)) !== null) {
    const sessionIdx = parseInt(match[1], 10);
    const entryIdx = parseInt(match[2], 10);
    if (sessionIdx < sessions.length) {
      const session = sessions[sessionIdx];
      const entry = session.entries[entryIdx];
      citations.push({
        sessionId: session.sessionId,
        entryIndex: entryIdx,
        quote: entry?.text?.slice(0, 200) ?? '',
      });
    }
  }

  return { content, citations };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate a complete memoir for a dossier and write it to Firestore.
 *
 * The caller must have already created a placeholder memoir doc with
 * status 'generating'. This function fills in the chapters and sets
 * status to 'draft' on completion.
 *
 * @param familyId   Firestore family doc ID
 * @param dossierId  Firestore dossier doc ID
 * @param memoirId   Pre-created memoir doc to update
 * @param apiKey     Gemini API key (from Firebase secret)
 */
export async function generateMemoirContent(
  familyId: string,
  dossierId: string,
  memoirId: string,
  apiKey: string,
): Promise<void> {
  const ai = new GoogleGenAI({ apiKey });

  const [dossierDoc, sessions, events, questions] = await Promise.all([
    db().collection('families').doc(familyId).collection('dossiers').doc(dossierId).get(),
    getAllTranscripts(familyId, dossierId),
    getEvents(familyId, dossierId),
    getQuestions(familyId, dossierId),
  ]);

  const dossierData = dossierDoc.data() ?? {};
  const dossier: DossierData = {
    storytellerName: dossierData.storytellerName ?? 'the storyteller',
    preferredName: dossierData.preferredName,
    storytellerContext: dossierData.storytellerContext,
    historicalContext: dossierData.historicalContext,
  };

  const memoirRef = db()
    .collection('families').doc(familyId)
    .collection('dossiers').doc(dossierId)
    .collection('memoirs').doc(memoirId);

  // Pass 1 — outline
  const outline = await generateOutline(dossier, events, questions, sessions, ai);

  const title = `The Story of ${dossier.storytellerName}`;

  if (outline.length === 0) {
    await memoirRef.update({
      title,
      status: 'draft',
      chapters: [{
        title: 'Introduction',
        content: `Not enough material has been collected to generate a full memoir for ${dossier.storytellerName}. Continue conducting interview sessions to build the story.`,
        eventIds: [],
        citations: [],
        order: 0,
      }],
      updatedAt: admin.firestore.Timestamp.now(),
    });
    return;
  }

  // Pass 2 — chapter prose
  const chapters: MemoirChapter[] = [];
  for (let i = 0; i < outline.length; i++) {
    const chapter = outline[i];
    const relevantEvents = events.filter((e) =>
      chapter.relevantEventIds?.includes(e.id ?? '')
    );
    const { content, citations } = await generateChapter(
      chapter.title,
      chapter.summary,
      dossier,
      relevantEvents.length > 0 ? relevantEvents : events,
      sessions,
      ai,
    );
    chapters.push({
      title: chapter.title,
      content,
      eventIds: chapter.relevantEventIds ?? [],
      citations,
      order: i,
    });
  }

  await memoirRef.update({
    title,
    status: 'draft',
    chapters,
    updatedAt: admin.firestore.Timestamp.now(),
  });
}
