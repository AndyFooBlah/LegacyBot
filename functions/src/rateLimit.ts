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
 * Per-user daily rate limiting for cost-generating callables.
 *
 * A single Firestore transaction reserves a slot atomically:
 *   - read current count at _usage/{uid}/daily/{YYYY-MM-DD}
 *   - if below the per-bucket cap, increment and allow
 *   - otherwise throw resource-exhausted
 *
 * Buckets are named (geoProxy, memoir, searchContext, ...) and each has its
 * own daily cap. All counters reset at UTC midnight.
 *
 * Documents live under a `_usage` root collection (leading underscore keeps
 * them out of normal user-facing queries). Firestore rules deny all client
 * reads/writes to `_usage` — only the admin SDK (these functions) can touch
 * the counters.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

/**
 * Daily caps by bucket. Keep generous for interactive buckets (geoProxy is
 * hit by Gemini tool calls during live sessions) and tight for heavy ones
 * (memoir, backfill).
 */
export const RATE_LIMITS = {
  geoProxy: 500,
  searchContext: 200,
  generateMemoir: 10,
  backfillContextChunks: 2,
  triggerDigestForDossier: 20,
  cacheWikipediaArticle: 100,
  mintGeminiLiveToken: 200,
  // invokeGemini is a general text-generation proxy on the paid key. A heavy
  // interview day fires a few dozen of these (event extraction, engagement,
  // date normalization, transcript cleanup); 300 leaves generous headroom
  // while bounding a runaway loop or a compromised account.
  invokeGemini: 300,
  embedGemini: 500,
  // Browsing a media gallery or reviewing sessions can request many signed
  // URLs; keep this generous (it only mints read URLs for the caller's own
  // family) while still bounding automated enumeration.
  getMediaUrl: 2000,
  // Dossier lifecycle (#171). Export walks every session/transcript and signs
  // a URL per recording, so keep it tight; delete/restore are cheap but there
  // is no legitimate reason to flip a dossier dozens of times a day.
  requestDossierDeletion: 20,
  restoreDossier: 20,
  exportDossier: 5,
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Atomically reserve one slot in the user's daily allotment for `bucket`.
 * Throws HttpsError('resource-exhausted') when the cap is exceeded.
 */
export async function enforceRateLimit(uid: string, bucket: RateLimitBucket): Promise<void> {
  const cap = RATE_LIMITS[bucket];
  const dayKey = utcDayKey();
  const db = getFirestore();
  const docRef = db.collection('_usage').doc(uid).collection('daily').doc(dayKey);
  const field = `${bucket}Count`;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const current = (snap.exists ? (snap.data()?.[field] ?? 0) : 0) as number;

    if (current >= cap) {
      throw new HttpsError(
        'resource-exhausted',
        `Daily limit reached for ${bucket} (${cap}/day). Try again tomorrow.`,
      );
    }

    if (snap.exists) {
      tx.update(docRef, {
        [field]: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.set(docRef, {
        [field]: 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
}

/**
 * Per-dossier monthly ceiling for offline transcript refinement (#123).
 *
 * Refinement runs automatically on every completed session and costs one
 * Gemini 3.1 Pro audio call, so we bound spend per dossier per calendar month.
 * A dossier realistically records a few dozen sessions a month at most; this
 * cap is a generous backstop against a retrigger loop or runaway, not a normal
 * limit anyone should hit.
 */
export const REFINEMENT_MONTHLY_CAP_PER_DOSSIER = 100;

function utcMonthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7); // YYYY-MM
}

/**
 * Atomically reserve one refinement slot for `dossierId` in the current UTC
 * month. Returns true if reserved (proceed), false if the monthly cap is
 * already reached. Unlike {@link enforceRateLimit} this never throws on the
 * cap — refinement is a silent best-effort upgrade, so the caller logs & skips.
 *
 * Counter lives at `_usage/refinement/monthly/{dossierId}_{YYYY-MM}` (the
 * `_usage` root is denied to all clients by Firestore rules).
 */
export async function reserveMonthlyRefinement(
  dossierId: string,
  cap: number = REFINEMENT_MONTHLY_CAP_PER_DOSSIER,
): Promise<boolean> {
  const monthKey = utcMonthKey();
  const db = getFirestore();
  const docRef = db
    .collection('_usage').doc('refinement')
    .collection('monthly').doc(`${dossierId}_${monthKey}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const current = (snap.exists ? (snap.data()?.count ?? 0) : 0) as number;
    if (current >= cap) return false;

    if (snap.exists) {
      tx.update(docRef, {
        count: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.set(docRef, {
        dossierId,
        monthKey,
        count: 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return true;
  });
}
