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

import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(),
}));

import {
  RETENTION_DAYS,
  isDossierDeleted,
  partitionDeleted,
  daysUntilPurge,
  formatPurgeDate,
} from '../../services/dossierLifecycle';

const ts = (d: Date) => ({ toDate: () => d }) as any;
const DAY = 24 * 60 * 60 * 1000;

describe('dossierLifecycle client helpers (#171)', () => {
  it('mirrors the server retention window', () => {
    expect(RETENTION_DAYS).toBe(30);
  });

  it('isDossierDeleted keys off deletedAt', () => {
    expect(isDossierDeleted(null)).toBe(false);
    expect(isDossierDeleted({})).toBe(false);
    expect(isDossierDeleted({ deletedAt: undefined })).toBe(false);
    expect(isDossierDeleted({ deletedAt: ts(new Date()) })).toBe(true);
  });

  it('partitionDeleted splits live and deleted preserving order', () => {
    const a = { id: 'a' } as any;
    const b = { id: 'b', deletedAt: ts(new Date()) } as any;
    const c = { id: 'c' } as any;
    const { live, deleted } = partitionDeleted([a, b, c]);
    expect(live.map((d) => d.id)).toEqual(['a', 'c']);
    expect(deleted.map((d) => d.id)).toEqual(['b']);
  });

  it('daysUntilPurge rounds up and never goes negative', () => {
    const now = Date.parse('2026-09-10T12:00:00Z');
    expect(daysUntilPurge({ purgeAfter: ts(new Date(now + 30 * DAY)) }, now)).toBe(30);
    expect(daysUntilPurge({ purgeAfter: ts(new Date(now + 0.5 * DAY)) }, now)).toBe(1);
    expect(daysUntilPurge({ purgeAfter: ts(new Date(now - DAY)) }, now)).toBe(0);
    expect(daysUntilPurge({}, now)).toBe(0);
    expect(daysUntilPurge(null, now)).toBe(0);
  });

  it('formatPurgeDate is empty without a purgeAfter and non-empty with one', () => {
    expect(formatPurgeDate({})).toBe('');
    expect(formatPurgeDate(null)).toBe('');
    expect(formatPurgeDate({ purgeAfter: ts(new Date('2026-10-10T00:00:00Z')) })).toMatch(/2026/);
  });
});
