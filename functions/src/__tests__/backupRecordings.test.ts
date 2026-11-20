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

vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_o: unknown, fn: unknown) => fn }));
vi.mock('firebase-admin/storage', () => ({ getStorage: vi.fn() }));

import { backupBucket, backupObjectName, BACKUP_PREFIX } from '../backupRecordings';

function file(name: string, generation: string | undefined, behaviour: 'ok' | 'exists' | 'boom' = 'ok') {
  return {
    name,
    metadata: { generation, size: '1000' },
    copy: vi.fn(async () => {
      if (behaviour === 'exists') throw Object.assign(new Error('conditionNotMet'), { code: 412 });
      if (behaviour === 'boom') throw Object.assign(new Error('backend error'), { code: 503 });
    }),
  };
}
const dest = { file: vi.fn((name: string) => ({ destName: name })) };

describe('backupBucket', () => {
  it('names each copy after the source path and its generation, so an overwrite makes a new backup', () => {
    expect(backupObjectName('fam/dos/s1.webm', '1700000000000001')).toBe(`${BACKUP_PREFIX}fam/dos/s1.webm.g1700000000000001`);
    expect(backupObjectName('fam/dos/s1.webm', '1700000000000002')).not.toBe(backupObjectName('fam/dos/s1.webm', '1700000000000001'));
  });

  it('copies with a create-only precondition and never overwrites', async () => {
    const f = file('fam/dos/s1.webm', '11');
    const summary = await backupBucket({ getFiles: async () => [[f]] }, dest);
    expect(f.copy).toHaveBeenCalledWith({ destName: 'recordings/fam/dos/s1.webm.g11' }, { preconditionOpts: { ifGenerationMatch: 0 } });
    expect(summary).toEqual({ seen: 1, copied: 1, alreadyBackedUp: 0, failed: 0, bytesCopied: 1000 });
  });

  it('counts an existing backup as already done, not as a failure', async () => {
    const summary = await backupBucket({ getFiles: async () => [[file('a', '1', 'exists'), file('b', '2')]] }, dest);
    expect(summary.alreadyBackedUp).toBe(1);
    expect(summary.copied).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('reports failures and keeps going', async () => {
    const good = file('b', '2');
    const summary = await backupBucket({ getFiles: async () => [[file('a', '1', 'boom'), good, file('c', undefined)]] }, dest);
    expect(summary.failed).toBe(2);
    expect(summary.copied).toBe(1);
    expect(good.copy).toHaveBeenCalled();
  });

  it('skips folder placeholder objects', async () => {
    const summary = await backupBucket({ getFiles: async () => [[file('fam/dos/', '1')]] }, dest);
    expect(summary.seen).toBe(0);
  });
});
