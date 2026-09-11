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
 * dossierLifecycle — soft-delete, restore, purge and export of a dossier (#171).
 *
 * Data policy ("never lose data by accident"):
 *   1. An admin asks to delete a dossier → `requestDossierDeletion` stamps
 *      `deletedAt`, `purgeAfter` (= deletedAt + RETENTION_DAYS) and
 *      `deletedBy` on the dossier document. Nothing else is touched. The
 *      client hides soft-deleted dossiers everywhere, blocks new sessions,
 *      digests skip them and searchContext filters their chunks out.
 *   2. Within the window an admin can `restoreDossier`, which clears the
 *      three fields.
 *   3. `purgeExpiredDossiers` (daily, from scheduledCleanup) hard-deletes
 *      every dossier whose `purgeAfter` has passed: the whole Firestore
 *      subtree (sessions, transcripts, questions, events, memoirs, …), the
 *      Storage prefix `{familyId}/{dossierId}/` (recordings, media, clips,
 *      prompt photos, exports) and the family's contextChunks for that
 *      dossier. Every purge writes an audit row to `purgeLog`.
 *
 * The three lifecycle fields are server-only: firestore.rules rejects any
 * client write that touches them, so a client cannot shorten (or skip) the
 * retention window by writing `purgeAfter` directly.
 *
 * Pure helpers (no Firebase) live at the top so they can be unit-tested;
 * the Firestore/Storage-touching functions take the admin handles as
 * arguments.
 */

import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Days a soft-deleted dossier remains restorable before the purge runs. */
export const RETENTION_DAYS = 30;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Signed export/audio URLs are valid this long (V4 signed URLs cap at 7 days). */
export const EXPORT_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Fields on the dossier document that only Cloud Functions may write. */
export const LIFECYCLE_FIELDS = ['deletedAt', 'purgeAfter', 'deletedBy'] as const;

/** Storage prefix holding everything that belongs to one dossier. */
export function dossierStoragePrefix(familyId: string, dossierId: string): string {
  return `${familyId}/${dossierId}/`;
}

/** True if `objectPath` lives under the dossier's Storage prefix. */
export function isUnderDossierPrefix(objectPath: unknown, familyId: string, dossierId: string): boolean {
  if (typeof objectPath !== 'string' || !objectPath) return false;
  if (objectPath.startsWith('/') || objectPath.includes('..') || objectPath.includes('//')) return false;
  return objectPath.startsWith(dossierStoragePrefix(familyId, dossierId));
}

/** `purgeAfter` for a deletion requested at `deletedAtMs`. */
export function computePurgeAfterMs(deletedAtMs: number): number {
  return deletedAtMs + RETENTION_MS;
}

/** A dossier is soft-deleted iff it carries a `deletedAt` timestamp. */
export function isDossierSoftDeleted(data: Record<string, unknown> | undefined | null): boolean {
  return !!data && data.deletedAt != null;
}

export interface PurgeCandidate {
  id: string;
  deletedAtMs: number | null;
  purgeAfterMs: number | null;
}

/**
 * Select which candidates may be hard-deleted at `nowMs`.
 *
 * Belt and braces on top of the Firestore query: a dossier is purged only if
 * it is (still) soft-deleted, its `purgeAfter` has passed, and the window is
 * internally consistent (`purgeAfter` at least RETENTION_MS after
 * `deletedAt`). Anything else is skipped and logged by the caller — the
 * failure mode we care about is deleting too much, never too little.
 */
export function selectDossiersToPurge(candidates: PurgeCandidate[], nowMs: number): PurgeCandidate[] {
  return candidates.filter((c) => {
    if (c.deletedAtMs == null || c.purgeAfterMs == null) return false;
    if (c.purgeAfterMs > nowMs) return false;
    if (c.purgeAfterMs - c.deletedAtMs < RETENTION_MS) return false;
    return true;
  });
}

/**
 * JSON replacer that turns Firestore Timestamps (anything with a `toDate()`)
 * into ISO-8601 strings and drops vector values, so an export is plain,
 * portable JSON.
 */
export function exportJsonReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object') {
    const v = value as { toDate?: unknown; toArray?: unknown };
    if (typeof v.toDate === 'function') return (v.toDate as () => Date)().toISOString();
    if (typeof v.toArray === 'function') return undefined; // VectorValue
  }
  return value;
}

// ---------------------------------------------------------------------------
// Soft delete / restore
// ---------------------------------------------------------------------------

type Firestore = admin.firestore.Firestore;

function dossierRef(db: Firestore, familyId: string, dossierId: string) {
  return db.collection('families').doc(familyId).collection('dossiers').doc(dossierId);
}

export interface SoftDeleteResult {
  alreadyDeleted: boolean;
  deletedAt: string;
  purgeAfter: string;
}

/** Stamp the lifecycle fields. Idempotent: a second call returns the existing window. */
export async function softDeleteDossier(
  db: Firestore,
  familyId: string,
  dossierId: string,
  byUid: string,
  nowMs = Date.now(),
): Promise<SoftDeleteResult | null> {
  const ref = dossierRef(db, familyId, dossierId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};

  if (isDossierSoftDeleted(data)) {
    return {
      alreadyDeleted: true,
      deletedAt: data.deletedAt.toDate().toISOString(),
      purgeAfter: data.purgeAfter?.toDate?.().toISOString() ?? '',
    };
  }

  const deletedAt = admin.firestore.Timestamp.fromMillis(nowMs);
  const purgeAfter = admin.firestore.Timestamp.fromMillis(computePurgeAfterMs(nowMs));
  await ref.update({ deletedAt, purgeAfter, deletedBy: byUid, updatedAt: deletedAt });
  logger.info(`[Lifecycle] Dossier ${familyId}/${dossierId} soft-deleted; purge after ${purgeAfter.toDate().toISOString()}`);
  return {
    alreadyDeleted: false,
    deletedAt: deletedAt.toDate().toISOString(),
    purgeAfter: purgeAfter.toDate().toISOString(),
  };
}

/** Clear the lifecycle fields. Returns false if the dossier no longer exists. */
export async function restoreDossierDoc(
  db: Firestore,
  familyId: string,
  dossierId: string,
  byUid: string,
): Promise<boolean> {
  const ref = dossierRef(db, familyId, dossierId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  if (!isDossierSoftDeleted(snap.data())) return true;

  const del = admin.firestore.FieldValue.delete();
  await ref.update({
    deletedAt: del,
    purgeAfter: del,
    deletedBy: del,
    restoredAt: admin.firestore.Timestamp.now(),
    restoredBy: byUid,
    updatedAt: admin.firestore.Timestamp.now(),
  });
  logger.info(`[Lifecycle] Dossier ${familyId}/${dossierId} restored by ${byUid}`);
  return true;
}

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

export interface PurgeSummary {
  familyId: string;
  dossierId: string;
  storytellerName: string;
  chunksDeleted: number;
  objectsDeleted: number;
  firestoreDeleted: boolean;
}

/**
 * Hard-delete one dossier: contextChunks → Storage prefix → Firestore
 * subtree, recording an audit row in `purgeLog/{familyId}_{dossierId}`
 * before and after so a crash mid-way is visible.
 */
export async function purgeDossier(
  db: Firestore,
  bucket: ReturnType<admin.storage.Storage['bucket']>,
  familyId: string,
  dossierId: string,
): Promise<PurgeSummary> {
  const ref = dossierRef(db, familyId, dossierId);
  const snap = await ref.get();
  const data = snap.data() ?? {};
  const summary: PurgeSummary = {
    familyId,
    dossierId,
    storytellerName: data.storytellerName ?? '',
    chunksDeleted: 0,
    objectsDeleted: 0,
    firestoreDeleted: false,
  };

  const auditRef = db.collection('purgeLog').doc(`${familyId}_${dossierId}`);
  await auditRef.set({
    familyId,
    dossierId,
    deletedAt: data.deletedAt ?? null,
    deletedBy: data.deletedBy ?? null,
    purgeAfter: data.purgeAfter ?? null,
    startedAt: admin.firestore.Timestamp.now(),
    status: 'started',
  }, { merge: true });

  // 1. Semantic-search chunks for this dossier (family-level collection).
  const chunksRef = db.collection('families').doc(familyId).collection('contextChunks');
  for (;;) {
    const chunkSnap = await chunksRef.where('dossierId', '==', dossierId).limit(400).get();
    if (chunkSnap.empty) break;
    const batch = db.batch();
    chunkSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    summary.chunksDeleted += chunkSnap.size;
  }

  // 2. Every Storage object under the dossier prefix (recordings, media,
  //    clips, prompt photos, exports).
  const prefix = dossierStoragePrefix(familyId, dossierId);
  const [files] = await bucket.getFiles({ prefix });
  summary.objectsDeleted = files.length;
  if (files.length > 0) {
    await bucket.deleteFiles({ prefix, force: true });
  }

  // 3. The Firestore subtree (dossier doc + all subcollections).
  if (snap.exists) {
    await db.recursiveDelete(ref);
  }
  summary.firestoreDeleted = true;

  await auditRef.set({
    ...summary,
    finishedAt: admin.firestore.Timestamp.now(),
    status: 'done',
  }, { merge: true });

  logger.info(
    `[Lifecycle] Purged dossier ${familyId}/${dossierId}: ` +
    `${summary.chunksDeleted} chunks, ${summary.objectsDeleted} objects, Firestore subtree removed`,
  );
  return summary;
}

/**
 * Find and purge every dossier whose retention window has closed. Walks
 * families → dossiers with a collection-scope query (no collection-group
 * index needed) and caps work per run so it stays inside the scheduler
 * timeout; anything left over is picked up tomorrow.
 */
export async function purgeExpiredDossiers(
  db: Firestore,
  bucket: ReturnType<admin.storage.Storage['bucket']>,
  nowMs = Date.now(),
  maxPerRun = 20,
): Promise<PurgeSummary[]> {
  const now = admin.firestore.Timestamp.fromMillis(nowMs);
  const purged: PurgeSummary[] = [];

  const familiesSnap = await db.collection('families').select().get();
  for (const familyDoc of familiesSnap.docs) {
    if (purged.length >= maxPerRun) break;
    const dueSnap = await familyDoc.ref
      .collection('dossiers')
      .where('purgeAfter', '<=', now)
      .limit(maxPerRun - purged.length)
      .get();
    if (dueSnap.empty) continue;

    const candidates: PurgeCandidate[] = dueSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        deletedAtMs: data.deletedAt?.toMillis?.() ?? null,
        purgeAfterMs: data.purgeAfter?.toMillis?.() ?? null,
      };
    });
    const selected = selectDossiersToPurge(candidates, nowMs);
    const skipped = candidates.length - selected.length;
    if (skipped > 0) {
      logger.warn(`[Lifecycle] ${skipped} dossier(s) in family ${familyDoc.id} had inconsistent lifecycle fields — not purged`);
    }

    for (const c of selected) {
      try {
        purged.push(await purgeDossier(db, bucket, familyDoc.id, c.id));
      } catch (err) {
        logger.error(`[Lifecycle] Purge failed for ${familyDoc.id}/${c.id}:`, err);
      }
    }
  }

  return purged;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportResult {
  /** Signed URL (EXPORT_URL_TTL_MS) for the JSON export object. */
  url: string;
  /** Storage object path of the export, under the dossier prefix. */
  path: string;
  expiresAt: string;
  sessionCount: number;
  audioCount: number;
  bytes: number;
}

async function readCollection(
  ref: admin.firestore.CollectionReference,
): Promise<Array<Record<string, unknown>>> {
  const snap = await ref.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Build a portable JSON export of one dossier — the dossier document, its
 * questions, events, facts, memoirs, analysis, media/photo/clip metadata and
 * every session with its transcript — plus a manifest of signed URLs for
 * the session recordings and uploaded media so the family can download the
 * originals. The JSON is written to `{familyId}/{dossierId}/exports/` (read
 * only for family members via storage.rules) and returned as a signed URL.
 *
 * Audio is NOT bundled into the export object: a multi-hour archive can run
 * to gigabytes, far beyond what a callable should stream. A zip job is a
 * follow-up; the manifest URLs give the same bytes today.
 */
export async function exportDossierToStorage(
  db: Firestore,
  bucket: ReturnType<admin.storage.Storage['bucket']>,
  familyId: string,
  dossierId: string,
  requestedBy: string,
  nowMs = Date.now(),
): Promise<ExportResult | null> {
  const ref = dossierRef(db, familyId, dossierId);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const expires = nowMs + EXPORT_URL_TTL_MS;
  const sign = async (objectPath: string): Promise<string | null> => {
    if (!isUnderDossierPrefix(objectPath, familyId, dossierId)) return null;
    try {
      const [url] = await bucket.file(objectPath).getSignedUrl({ version: 'v4', action: 'read', expires });
      return url;
    } catch (err) {
      logger.warn(`[Export] Could not sign ${objectPath}:`, err);
      return null;
    }
  };

  const [questions, events, miscFacts, memoirs, analysis, media, promptPhotos, clips] = await Promise.all([
    readCollection(ref.collection('questions')),
    readCollection(ref.collection('events')),
    readCollection(ref.collection('miscFacts')),
    readCollection(ref.collection('memoirs')),
    readCollection(ref.collection('analysis')),
    readCollection(ref.collection('media')),
    readCollection(ref.collection('promptPhotos')),
    readCollection(ref.collection('clips')),
  ]);

  const sessionsSnap = await ref.collection('sessions').orderBy('startTime', 'asc').get();
  const audioManifest: Array<{ sessionId: string; path: string; url: string | null }> = [];
  const sessions: Array<Record<string, unknown>> = [];
  for (const s of sessionsSnap.docs) {
    const sData = s.data();
    const [transcriptDoc, sAnalysis] = await Promise.all([
      s.ref.collection('transcript').doc('entries').get(),
      readCollection(s.ref.collection('analysis')),
    ]);
    const audioPath: string | undefined = sData.audioUrl;
    let audioUrl: string | null = null;
    if (audioPath) {
      audioUrl = await sign(audioPath);
      audioManifest.push({ sessionId: s.id, path: audioPath, url: audioUrl });
    }
    sessions.push({
      id: s.id,
      ...sData,
      audio: audioPath ? { path: audioPath, url: audioUrl, urlExpiresAt: new Date(expires).toISOString() } : null,
      transcript: transcriptDoc.exists ? (transcriptDoc.data() ?? {}) : null,
      analysis: sAnalysis,
    });
  }

  const mediaManifest: Array<{ kind: string; id: string; path: string; url: string | null }> = [];
  for (const [kind, items] of [['media', media], ['promptPhotos', promptPhotos], ['clips', clips]] as const) {
    for (const item of items) {
      const p = (item as { storagePath?: unknown; storageUrl?: unknown }).storagePath
        ?? (item as { storageUrl?: unknown }).storageUrl;
      if (typeof p === 'string' && isUnderDossierPrefix(p, familyId, dossierId)) {
        mediaManifest.push({ kind, id: String(item.id), path: p, url: await sign(p) });
      }
    }
  }

  const exportDoc = {
    format: 'biographybot-dossier-export',
    version: 1,
    exportedAt: new Date(nowMs).toISOString(),
    exportedBy: requestedBy,
    familyId,
    dossierId,
    notes: [
      'Timestamps are ISO-8601 UTC.',
      `Signed URLs in audioManifest/mediaManifest expire at ${new Date(expires).toISOString()}; re-run the export for fresh links.`,
      'Audio is not embedded; download it from the manifest URLs.',
    ],
    dossier: { id: snap.id, ...snap.data() },
    questions,
    events,
    miscFacts,
    memoirs,
    analysis,
    media,
    promptPhotos,
    clips,
    sessions,
    audioManifest,
    mediaManifest,
  };

  const body = JSON.stringify(exportDoc, exportJsonReplacer, 2);
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
  const path = `${dossierStoragePrefix(familyId, dossierId)}exports/export-${stamp}.json`;
  const file = bucket.file(path);
  await file.save(body, {
    contentType: 'application/json',
    resumable: false,
    metadata: { metadata: { requestedBy, dossierId, familyId } },
  });
  const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires });

  logger.info(
    `[Export] Dossier ${familyId}/${dossierId}: ${sessions.length} sessions, ` +
    `${audioManifest.length} recordings, ${body.length} bytes → ${path}`,
  );

  return {
    url,
    path,
    expiresAt: new Date(expires).toISOString(),
    sessionCount: sessions.length,
    audioCount: audioManifest.length,
    bytes: body.length,
  };
}
