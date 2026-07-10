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
 * scheduledCleanup — daily background tasks that bound the growth of
 * shared-cache + error-row collections.
 *
 * M6: `wikipedia_cache/{articleId}` stores an article doc + `chunks/*`
 *     subcollection. A daily sweep deletes entries older than 30 days so
 *     the cache can't grow unboundedly across years of usage.
 *
 * M10: `generateMemoir` writes a placeholder doc before running the
 *      two-pass Gemini pipeline; if that throws, the row gets
 *      `status: 'error'`. The client normally hides/reclaims these, but
 *      orphans can accumulate on retries — sweep error rows older than 7
 *      days to keep the collection tidy.
 */

import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

const WIKI_CACHE_TTL_DAYS = 30;
const MEMOIR_ERROR_TTL_DAYS = 7;

export const dailyStorageCleanup = onSchedule(
  {
    schedule: '0 10 * * *', // 10:00 UTC (≈ 2–3 AM Pacific)
    timeZone: 'UTC',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    logger.info('[storageCleanup] Starting daily cleanup');

    const results = await Promise.allSettled([
      cleanWikipediaCache(),
      cleanErrorMemoirs(),
    ]);

    const names = ['cleanWikipediaCache', 'cleanErrorMemoirs'];
    for (const [i, r] of results.entries()) {
      if (r.status === 'rejected') {
        logger.error(`[storageCleanup] ${names[i]} failed:`, r.reason);
      }
    }

    logger.info('[storageCleanup] Done');
  },
);

/**
 * Delete `wikipedia_cache/{articleId}` docs with `fetchedAt` older than 30
 * days, including their `chunks` subcollection. Runs in small batches so a
 * single invocation stays well under the function timeout even after a
 * long backlog has built up.
 */
async function cleanWikipediaCache(): Promise<void> {
  const db = admin.firestore();
  const cutoff = admin.firestore.Timestamp.fromMillis(
    Date.now() - WIKI_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const snap = await db
    .collection('wikipedia_cache')
    .where('fetchedAt', '<', cutoff)
    .limit(200)
    .get();

  if (snap.empty) {
    logger.info('[cleanWikipediaCache] Nothing to clean');
    return;
  }

  let deleted = 0;
  for (const articleDoc of snap.docs) {
    const chunks = await articleDoc.ref.collection('chunks').get();
    const batch = db.batch();
    chunks.docs.forEach((c) => batch.delete(c.ref));
    batch.delete(articleDoc.ref);
    await batch.commit();
    deleted++;
  }

  logger.info(`[cleanWikipediaCache] Deleted ${deleted} stale article(s)`);
}

/**
 * Delete memoir docs with `status == 'error'` older than 7 days, across all
 * families/dossiers. Uses a collectionGroup query so we don't have to walk
 * the family/dossier tree.
 */
async function cleanErrorMemoirs(): Promise<void> {
  const db = admin.firestore();
  const cutoff = admin.firestore.Timestamp.fromMillis(
    Date.now() - MEMOIR_ERROR_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const snap = await db
    .collectionGroup('memoirs')
    .where('status', '==', 'error')
    .where('updatedAt', '<', cutoff)
    .limit(200)
    .get();

  if (snap.empty) {
    logger.info('[cleanErrorMemoirs] Nothing to clean');
    return;
  }

  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();

  logger.info(`[cleanErrorMemoirs] Deleted ${snap.size} error memoir(s)`);
}
