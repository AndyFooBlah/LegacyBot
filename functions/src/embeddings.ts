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
 * Embedding helpers for LegacyBot semantic search (#108).
 *
 * Uses Google's text-embedding-004 model (768 dimensions) via the Gemini API.
 * Supports separate task types for indexing vs querying, which improves
 * retrieval quality.
 *
 * Also exports chunking utilities used by Cloud Function triggers to split
 * source documents into indexable segments.
 */

import { GoogleGenAI } from '@google/genai';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextChunkSource =
  | 'biography'
  | 'historicalContext'
  | 'adminNotes'
  | 'transcript'
  | 'event'
  | 'miscFact'
  | 'question';

export interface ContextChunk {
  familyId: string;
  dossierId: string | null;
  sessionId: string | null;
  sourceDocId: string;
  source: ContextChunkSource;
  text: string;
  // VectorValue is from the underlying @google-cloud/firestore package
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  embedding: any;
  embeddedAt: admin.firestore.Timestamp;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

// gemini-embedding-001 is the stable embedding model available via this API key.
// It natively produces 3072 dims; we truncate to 768 via outputDimensionality
// to stay within Firestore's 2048-dim limit and keep the vector index unchanged.
const EMBEDDING_MODEL = 'gemini-embedding-001';
const MIN_CHUNK_LENGTH = 20;

/**
 * Embed an array of text strings using text-embedding-004.
 * Returns one 768-dimensional vector per input text.
 */
export async function embedTexts(
  texts: string[],
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
  apiKey: string,
): Promise<number[][]> {
  const ai = new GoogleGenAI({ apiKey });
  const results = await Promise.all(
    texts.map((text) =>
      ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
        config: { taskType, outputDimensionality: 768 },
      }),
    ),
  );
  return results.map((r) => {
    const values = r.embeddings?.[0]?.values;
    if (!values) throw new Error('Embedding response missing values');
    return values;
  });
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Split a prose text (biography, historicalContext, adminNotes) into
 * paragraph-level chunks. Paragraphs longer than maxChars are split at
 * sentence boundaries with a small overlap.
 */
export function chunkProse(text: string, maxChars = 600, overlap = 80): string[] {
  if (!text?.trim()) return [];

  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      if (para.length >= MIN_CHUNK_LENGTH) chunks.push(para);
      continue;
    }

    // Split long paragraph at sentence boundaries
    const sentences = para.match(/[^.!?]+[.!?]+/g) ?? [para];
    let current = '';

    for (const sentence of sentences) {
      if ((current + sentence).length > maxChars && current.length > 0) {
        if (current.length >= MIN_CHUNK_LENGTH) chunks.push(current.trim());
        // Start next chunk with overlap from end of current
        const overlapText = current.slice(-overlap).trim();
        current = overlapText ? overlapText + ' ' + sentence : sentence;
      } else {
        current += (current ? ' ' : '') + sentence;
      }
    }
    if (current.trim().length >= MIN_CHUNK_LENGTH) chunks.push(current.trim());
  }

  return chunks;
}

/**
 * Split a session transcript (array of {role, text} turns) into chunks of
 * approximately maxChars. Consecutive same-speaker turns are merged if short.
 */
export function chunkTranscript(
  turns: Array<{ role: string; text: string }>,
  maxChars = 500,
): string[] {
  if (!turns?.length) return [];

  const chunks: string[] = [];
  let current = '';

  for (const turn of turns) {
    const prefix = turn.role === 'user' ? 'Storyteller: ' : 'Bot: ';
    const line = prefix + turn.text.trim();

    if (current && (current + '\n' + line).length > maxChars) {
      if (current.length >= MIN_CHUNK_LENGTH) chunks.push(current.trim());
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current.trim().length >= MIN_CHUNK_LENGTH) chunks.push(current.trim());

  return chunks;
}

// ---------------------------------------------------------------------------
// Chunk management helpers
// ---------------------------------------------------------------------------

const db = () => admin.firestore();

/**
 * Delete all existing contextChunks for a given source document.
 * Called before re-embedding to keep the index clean.
 */
export async function deleteChunksForSource(
  familyId: string,
  dossierId: string | null,
  source: ContextChunkSource,
  sourceDocId: string,
): Promise<void> {
  let query = db()
    .collection('families').doc(familyId)
    .collection('contextChunks')
    .where('source', '==', source)
    .where('sourceDocId', '==', sourceDocId) as admin.firestore.Query;

  if (dossierId) {
    query = query.where('dossierId', '==', dossierId);
  }

  const snap = await query.get();
  if (snap.empty) return;

  const batch = db().batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

/**
 * Write a set of contextChunk documents for a source.
 * Each text string becomes one Firestore document with its embedding vector.
 */
export async function writeChunks(
  familyId: string,
  dossierId: string | null,
  sessionId: string | null,
  source: ContextChunkSource,
  sourceDocId: string,
  texts: string[],
  apiKey: string,
): Promise<void> {
  if (!texts.length) return;

  const vectors = await embedTexts(texts, 'RETRIEVAL_DOCUMENT', apiKey);
  const now = admin.firestore.Timestamp.now();
  const collRef = db()
    .collection('families').doc(familyId)
    .collection('contextChunks');

  const batch = db().batch();
  for (let i = 0; i < texts.length; i++) {
    const chunk: ContextChunk = {
      familyId,
      dossierId,
      sessionId,
      sourceDocId,
      source,
      text: texts[i],
      embedding: admin.firestore.FieldValue.vector(vectors[i]),
      embeddedAt: now,
    };
    batch.set(collRef.doc(), chunk);
  }
  await batch.commit();
}
