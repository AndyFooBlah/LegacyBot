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
 * Client-side wrappers and helpers for the dossier data lifecycle (#171):
 * soft-delete with a 30-day restore window, audited purge, and export.
 *
 * The lifecycle fields (`deletedAt`, `purgeAfter`, `deletedBy`) are
 * server-only — firestore.rules rejects client writes — so every mutation
 * here goes through a callable. See functions/src/dossierLifecycle.ts.
 */

import { getFunctions, httpsCallable, Functions } from 'firebase/functions';
import type { Dossier } from '../types';

/** Days a deleted dossier remains restorable. Mirrors the server constant. */
export const RETENTION_DAYS = 30;

let _functions: Functions | null = null;
function functions(): Functions {
  if (!_functions) _functions = getFunctions();
  return _functions;
}

/** True if the dossier has been soft-deleted (hidden, awaiting purge). */
export function isDossierDeleted(dossier: Pick<Dossier, 'deletedAt'> | null | undefined): boolean {
  return !!dossier && dossier.deletedAt != null;
}

/** Split a dossier list into live and soft-deleted dossiers. */
export function partitionDeleted<T extends Pick<Dossier, 'deletedAt'>>(
  dossiers: T[],
): { live: T[]; deleted: T[] } {
  const live: T[] = [];
  const deleted: T[] = [];
  for (const d of dossiers) (isDossierDeleted(d) ? deleted : live).push(d);
  return { live, deleted };
}

/** Human-readable purge date, e.g. "10 Oct 2026". Empty if unknown. */
export function formatPurgeDate(dossier: Pick<Dossier, 'purgeAfter'> | null | undefined): string {
  const d = dossier?.purgeAfter?.toDate?.();
  if (!d) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Whole days until purge (never negative). */
export function daysUntilPurge(
  dossier: Pick<Dossier, 'purgeAfter'> | null | undefined,
  nowMs = Date.now(),
): number {
  const d = dossier?.purgeAfter?.toDate?.();
  if (!d) return 0;
  return Math.max(0, Math.ceil((d.getTime() - nowMs) / (24 * 60 * 60 * 1000)));
}

export interface DeletionResult {
  alreadyDeleted: boolean;
  deletedAt: string;
  purgeAfter: string;
  retentionDays: number;
}

/** Soft-delete a dossier (admin only). Restorable for RETENTION_DAYS. */
export async function requestDossierDeletion(familyId: string, dossierId: string): Promise<DeletionResult> {
  const fn = httpsCallable<{ familyId: string; dossierId: string }, DeletionResult>(
    functions(), 'requestDossierDeletion',
  );
  const res = await fn({ familyId, dossierId });
  return res.data;
}

/** Undo a soft-delete within the retention window (admin only). */
export async function restoreDossier(familyId: string, dossierId: string): Promise<void> {
  const fn = httpsCallable<{ familyId: string; dossierId: string }, { restored: boolean }>(
    functions(), 'restoreDossier',
  );
  await fn({ familyId, dossierId });
}

export interface ExportResult {
  url: string;
  path: string;
  expiresAt: string;
  sessionCount: number;
  audioCount: number;
  bytes: number;
}

/**
 * Produce a JSON export of the dossier (all sessions + transcripts, events,
 * memoirs, questions, facts, media metadata) with a manifest of signed audio
 * URLs, and return a signed URL to download it (valid 7 days).
 */
export async function exportDossier(familyId: string, dossierId: string): Promise<ExportResult> {
  const fn = httpsCallable<{ familyId: string; dossierId: string }, ExportResult>(
    functions(), 'exportDossier',
  );
  const res = await fn({ familyId, dossierId });
  return res.data;
}
