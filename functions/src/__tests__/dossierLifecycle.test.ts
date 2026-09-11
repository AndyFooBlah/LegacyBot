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

import { describe, it, expect } from 'vitest';
import {
  RETENTION_DAYS,
  RETENTION_MS,
  computePurgeAfterMs,
  dossierStoragePrefix,
  isUnderDossierPrefix,
  isDossierSoftDeleted,
  selectDossiersToPurge,
  exportJsonReplacer,
  PurgeCandidate,
} from '../dossierLifecycle';

const DAY = 24 * 60 * 60 * 1000;

describe('dossier lifecycle helpers (#171)', () => {
  it('retention window is 30 days', () => {
    expect(RETENTION_DAYS).toBe(30);
    expect(RETENTION_MS).toBe(30 * DAY);
    expect(computePurgeAfterMs(1_000)).toBe(1_000 + 30 * DAY);
  });

  it('dossierStoragePrefix has a trailing slash so it cannot match sibling dossiers', () => {
    expect(dossierStoragePrefix('fam1', 'dosA')).toBe('fam1/dosA/');
    // "fam1/dosAB/..." must NOT be under "fam1/dosA"
    expect(isUnderDossierPrefix('fam1/dosAB/session.webm', 'fam1', 'dosA')).toBe(false);
  });

  it('isUnderDossierPrefix accepts objects under the prefix and rejects everything else', () => {
    expect(isUnderDossierPrefix('fam1/dosA/s1.webm', 'fam1', 'dosA')).toBe(true);
    expect(isUnderDossierPrefix('fam1/dosA/media/photo', 'fam1', 'dosA')).toBe(true);
    expect(isUnderDossierPrefix('fam2/dosA/s1.webm', 'fam1', 'dosA')).toBe(false);
    expect(isUnderDossierPrefix('fam1/dosB/s1.webm', 'fam1', 'dosA')).toBe(false);
    expect(isUnderDossierPrefix('/fam1/dosA/s1.webm', 'fam1', 'dosA')).toBe(false);
    expect(isUnderDossierPrefix('fam1/dosA/../dosB/s1.webm', 'fam1', 'dosA')).toBe(false);
    expect(isUnderDossierPrefix('fam1/dosA//x', 'fam1', 'dosA')).toBe(false);
    expect(isUnderDossierPrefix('https://example.com/fam1/dosA/x', 'fam1', 'dosA')).toBe(false);
    expect(isUnderDossierPrefix(undefined, 'fam1', 'dosA')).toBe(false);
    expect(isUnderDossierPrefix('', 'fam1', 'dosA')).toBe(false);
  });

  it('isDossierSoftDeleted keys off deletedAt only', () => {
    expect(isDossierSoftDeleted(undefined)).toBe(false);
    expect(isDossierSoftDeleted(null)).toBe(false);
    expect(isDossierSoftDeleted({})).toBe(false);
    expect(isDossierSoftDeleted({ deletedAt: null })).toBe(false);
    expect(isDossierSoftDeleted({ purgeAfter: {} })).toBe(false);
    expect(isDossierSoftDeleted({ deletedAt: { seconds: 1 } })).toBe(true);
  });

  describe('selectDossiersToPurge', () => {
    const now = 100 * DAY;
    const ok: PurgeCandidate = { id: 'due', deletedAtMs: now - 31 * DAY, purgeAfterMs: now - DAY };

    it('selects dossiers whose full window has elapsed', () => {
      expect(selectDossiersToPurge([ok], now).map((c) => c.id)).toEqual(['due']);
      const exactly = { id: 'edge', deletedAtMs: now - 30 * DAY, purgeAfterMs: now };
      expect(selectDossiersToPurge([exactly], now).map((c) => c.id)).toEqual(['edge']);
    });

    it('skips dossiers still inside the window', () => {
      const future = { id: 'soon', deletedAtMs: now - 29 * DAY, purgeAfterMs: now + DAY };
      expect(selectDossiersToPurge([future], now)).toEqual([]);
    });

    it('skips dossiers that are not actually soft-deleted (no deletedAt)', () => {
      const noDeletedAt = { id: 'odd', deletedAtMs: null, purgeAfterMs: now - DAY };
      expect(selectDossiersToPurge([noDeletedAt], now)).toEqual([]);
    });

    it('skips dossiers with no purgeAfter', () => {
      expect(selectDossiersToPurge([{ id: 'x', deletedAtMs: now - 40 * DAY, purgeAfterMs: null }], now)).toEqual([]);
    });

    it('skips dossiers whose window was shortened below the retention period', () => {
      // e.g. a purgeAfter written 1 day after deletedAt — never honour that.
      const shortened = { id: 'short', deletedAtMs: now - 2 * DAY, purgeAfterMs: now - DAY };
      expect(selectDossiersToPurge([shortened], now)).toEqual([]);
    });

    it('is a pure filter over a mixed list', () => {
      const list: PurgeCandidate[] = [
        ok,
        { id: 'soon', deletedAtMs: now - DAY, purgeAfterMs: now + 29 * DAY },
        { id: 'odd', deletedAtMs: null, purgeAfterMs: now - DAY },
      ];
      expect(selectDossiersToPurge(list, now).map((c) => c.id)).toEqual(['due']);
      expect(list).toHaveLength(3);
    });
  });

  it('exportJsonReplacer serialises Timestamp-likes to ISO strings and drops vectors', () => {
    const ts = { toDate: () => new Date('2026-01-02T03:04:05.000Z') };
    const vec = { toArray: () => [0.1, 0.2] };
    const out = JSON.parse(JSON.stringify({ at: ts, embedding: vec, n: 1, s: 'x', nested: { at: ts } }, exportJsonReplacer));
    expect(out).toEqual({ at: '2026-01-02T03:04:05.000Z', n: 1, s: 'x', nested: { at: '2026-01-02T03:04:05.000Z' } });
  });
});
