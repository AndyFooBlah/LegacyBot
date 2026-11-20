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

import { describe, it, expect, vi, beforeEach } from 'vitest';

const profileGet = vi.fn();
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ doc: (path: string) => ({ get: () => profileGet(path) }) }),
}));

import { requireFamilyMember } from '../membership';

const req = (auth: unknown) => ({ auth }) as never;

describe('requireFamilyMember', () => {
  beforeEach(() => profileGet.mockReset());

  it('refuses a signed-out caller', async () => {
    await expect(requireFamilyMember(req(undefined))).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(profileGet).not.toHaveBeenCalled();
  });

  it('accepts a caller whose token carries a family, without a database read', async () => {
    await expect(requireFamilyMember(req({ uid: 'u1', token: { familyIds: ['fam1'] } }))).resolves.toBe('u1');
    expect(profileGet).not.toHaveBeenCalled();
  });

  it('accepts a real member whose token predates the claim, by reading their own profile', async () => {
    profileGet.mockResolvedValue({ exists: true, data: () => ({ familyIds: ['fam1'] }) });
    await expect(requireFamilyMember(req({ uid: 'u2', token: {} }))).resolves.toBe('u2');
    expect(profileGet).toHaveBeenCalledWith('users/u2');
  });

  it('refuses a signed-in account that belongs to no family', async () => {
    profileGet.mockResolvedValue({ exists: true, data: () => ({ familyIds: [] }) });
    await expect(requireFamilyMember(req({ uid: 'stranger', token: { familyIds: [] } })))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('refuses a signed-in account with no profile at all', async () => {
    profileGet.mockResolvedValue({ exists: false });
    await expect(requireFamilyMember(req({ uid: 'stranger', token: {} }))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('is not fooled by a claim of the wrong shape', async () => {
    profileGet.mockResolvedValue({ exists: false });
    await expect(requireFamilyMember(req({ uid: 'x', token: { familyIds: 'fam1' } }))).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
