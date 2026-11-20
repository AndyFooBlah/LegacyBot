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
 * Daily copy of every recording and media file to a bucket in a different
 * project and region, so that nothing done inside this project — a bug, a
 * bad deploy, a compromised account, an honest mistake — can destroy a
 * storyteller's voice. Raw audio is the one thing here that cannot be
 * regenerated.
 *
 * How it stays a backup rather than a second copy to lose:
 *
 *   - Each object is copied to `recordings/<path>.g<generation>`. The
 *     generation is the source object's version number, so an overwritten
 *     recording gets a NEW backup object and the old one stays.
 *   - The copy carries the precondition "only if the destination does not
 *     exist". Already backed up means a 412, which is counted and skipped.
 *     No listing of the backup bucket is needed.
 *   - This function's identity holds object-CREATE on the backup bucket and
 *     nothing else. It cannot overwrite, delete or even list what is there,
 *     so whatever goes wrong here cannot reach back into the backups.
 *   - Nothing is ever deleted from the backup by this code. A lifecycle rule
 *     on the backup bucket removes copies after 90 days, and the next run
 *     re-copies anything that still exists at the source. A recording purged
 *     under the 30-day deletion policy therefore leaves the backup within 90
 *     days of its last copy.
 *
 * Recovery steps are in DEPLOYMENT.md, "Recovering recordings".
 */

import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getStorage } from 'firebase-admin/storage';

/** Bucket in the separate backups project (multi-region US). Also holds the daily Firestore exports. */
export const BACKUP_BUCKET = 'legacybot-backup-us';
export const BACKUP_PREFIX = 'recordings/';
const CONCURRENCY = 8;

/** The slice of the Storage client this needs; lets tests pass a fake. */
export interface SourceFile {
  name: string;
  metadata: { generation?: string | number; size?: string | number };
  copy(destination: unknown, options?: unknown): Promise<unknown>;
}
export interface SourceBucket { getFiles(query?: unknown): Promise<[SourceFile[], ...unknown[]]> }
export interface DestBucket { file(name: string): unknown }

export interface BackupSummary { seen: number; copied: number; alreadyBackedUp: number; failed: number; bytesCopied: number }

export function backupObjectName(sourceName: string, generation: string | number): string {
  return `${BACKUP_PREFIX}${sourceName}.g${generation}`;
}

const isPreconditionFailed = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 412;

export async function backupBucket(source: SourceBucket, dest: DestBucket): Promise<BackupSummary> {
  const summary: BackupSummary = { seen: 0, copied: 0, alreadyBackedUp: 0, failed: 0, bytesCopied: 0 };
  const [files] = await source.getFiles({ autoPaginate: true });
  const queue = files.filter((f) => !f.name.endsWith('/'));
  summary.seen = queue.length;

  async function worker(): Promise<void> {
    for (let f = queue.pop(); f; f = queue.pop()) {
      const generation = f.metadata.generation;
      if (generation === undefined) { summary.failed++; logger.error('[backupRecordings] object has no generation', { size: f.metadata.size }); continue; }
      try {
        await f.copy(dest.file(backupObjectName(f.name, generation)), { preconditionOpts: { ifGenerationMatch: 0 } });
        summary.copied++;
        summary.bytesCopied += Number(f.metadata.size ?? 0);
      } catch (err) {
        if (isPreconditionFailed(err)) { summary.alreadyBackedUp++; continue; }
        summary.failed++;
        // Object names contain family and dossier ids, not personal content, but
        // keep logs to the error itself.
        logger.error('[backupRecordings] copy failed', { err: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return summary;
}

export const dailyRecordingsBackup = onSchedule(
  { schedule: '30 11 * * *', timeZone: 'UTC', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const storage = getStorage();
    const summary = await backupBucket(
      storage.bucket() as unknown as SourceBucket,
      storage.bucket(BACKUP_BUCKET) as unknown as DestBucket,
    );
    logger.info('[backupRecordings] done', summary);
    // Throwing marks the run failed, which is what an alert will key on.
    if (summary.failed > 0) throw new Error(`backupRecordings: ${summary.failed} object(s) failed to copy`);
  },
);
