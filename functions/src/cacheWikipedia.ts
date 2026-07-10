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
 * Server-side Wikipedia article cache filler.
 *
 * Client calls this callable when a cache entry is missing or stale.
 * The function fetches the article directly from Wikipedia, chunks it,
 * computes embeddings, and writes to `wikipedia_cache/{articleId}` using
 * the admin SDK. Firestore rules deny client writes to that collection —
 * this callable is the only write path, so a malicious client can never
 * poison the shared cache with fabricated article content that would be
 * injected into other users' Gemini tool calls.
 */

import { HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenAI } from '@google/genai';
import { fetchWithTimeout, TIMEOUTS } from './httpTimeouts';

const CHUNK_CHARS = 1500;
const OVERLAP_CHARS = 200;
const EMBEDDING_MODEL = 'gemini-embedding-001';
const MAX_ARTICLE_CHARS = 500_000;

interface CacheWikipediaArticleInput {
  title: string;
}

interface CacheWikipediaArticleResult {
  chunkCount: number;
  cached: boolean;
}

/**
 * Convert a Wikipedia title to a Firestore-safe document ID.
 *
 * MUST stay in sync with `titleToId` in @andyfooblah/knowledge-common
 * (src/services/tools/wikipedia.ts) — clients read the cache at
 * `wikipedia_cache/{titleToId(title)}`, so the server must derive the same
 * id from the same title. Deriving it server-side (rather than trusting a
 * client-supplied id) guarantees an article's content can only ever be
 * cached under its own id — a client can't store article X's text under
 * article Y's cache entry.
 */
function titleToId(title: string): string {
  return title.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '-');
}

async function fetchArticleText(title: string): Promise<string | null> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exlimit=1` +
    `&titles=${encodeURIComponent(title)}&format=json&origin=*`;
  const res = await fetchWithTimeout(url, TIMEOUTS.wikipediaExtract);
  const data = await res.json() as {
    query?: { pages?: Record<string, { extract?: string }> };
  };
  const pages = data?.query?.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  if (!page?.extract) return null;

  return page.extract
    .replace(/<\/?(h[1-6]|p|ul|ol|li|b|i|a|span|div|br)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 1 > CHUNK_CHARS && current.length > 0) {
      chunks.push(current.trim());
      const overlapStart = Math.max(0, current.length - OVERLAP_CHARS);
      current = current.slice(overlapStart) + '\n' + para;
    } else {
      current = current ? current + '\n' + para : para;
    }
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks;
}

async function embedChunks(texts: string[], apiKey: string): Promise<number[][]> {
  const ai = new GoogleGenAI({ apiKey });
  const results = await Promise.all(
    texts.map((text) =>
      ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
        config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 },
      }),
    ),
  );
  return results.map((r) => {
    const values = r.embeddings?.[0]?.values;
    if (!values) throw new Error('Embedding response missing values');
    return values;
  });
}

/**
 * Build the cacheWikipediaArticle callable handler.
 *
 * Factored as a builder so the enforceRateLimit dependency is injected —
 * keeps rateLimit.ts out of this file's import graph (it pulls in
 * firebase-admin at module load).
 */
export function buildCacheWikipediaArticleHandler(opts: {
  apiKey: () => string;
  enforceRateLimit: (uid: string) => Promise<void>;
}) {
  return async (request: CallableRequest): Promise<CacheWikipediaArticleResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    const { title } = (request.data ?? {}) as CacheWikipediaArticleInput;
    if (typeof title !== 'string' || title.length === 0 || title.length > 300) {
      throw new HttpsError('invalid-argument', 'Invalid title.');
    }

    // Derive the cache document id from the title server-side. Any
    // client-supplied articleId is ignored — trusting it would let a caller
    // cache article X's content under article Y's id.
    const articleId = titleToId(title);
    if (articleId.length === 0) {
      throw new HttpsError('invalid-argument', 'Invalid title.');
    }

    await opts.enforceRateLimit(request.auth.uid);

    const apiKey = opts.apiKey();
    if (!apiKey) throw new HttpsError('internal', 'GEMINI_API_KEY not configured.');

    const db = admin.firestore();
    const articleRef = db.collection('wikipedia_cache').doc(articleId);

    let text: string | null;
    try {
      text = await fetchArticleText(title);
    } catch (err) {
      logger.warn('[cacheWikipediaArticle] Fetch failed:', err);
      throw new HttpsError('unavailable', 'Wikipedia fetch failed.');
    }
    if (!text) return { chunkCount: 0, cached: false };
    if (text.length > MAX_ARTICLE_CHARS) text = text.slice(0, MAX_ARTICLE_CHARS);

    const rawChunks = chunkText(text);
    if (rawChunks.length === 0) return { chunkCount: 0, cached: false };

    let embeddings: number[][];
    try {
      embeddings = await embedChunks(rawChunks, apiKey);
    } catch (err) {
      logger.error('[cacheWikipediaArticle] Embedding failed:', err);
      throw new HttpsError('internal', 'Embedding failed.');
    }

    const batch = db.batch();
    batch.set(articleRef, {
      title,
      fetchedAt: admin.firestore.Timestamp.now(),
      chunkCount: rawChunks.length,
    });
    for (let i = 0; i < rawChunks.length; i++) {
      const chunkRef = articleRef.collection('chunks').doc(String(i));
      batch.set(chunkRef, {
        text: rawChunks[i],
        chunkIndex: i,
        embedding: embeddings[i] ?? [],
      });
    }
    await batch.commit();

    return { chunkCount: rawChunks.length, cached: true };
  };
}
