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
 * Tests for the useFamily, useFamilyMembers, useCurrentRoles hooks and createFamily function.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { mockFirestore } from '../../__mocks__/firebase';
import { useFamily, useFamilyMembers, useCurrentRoles, createFamily, getUserFamilyIds, updateMemberRoles } from '../../hooks/useFamily';

beforeEach(() => {
  Object.values(mockFirestore).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) (fn as any).mockClear();
  });

  mockFirestore.onSnapshot.mockImplementation((_query: any, cb: any) => {
    cb({ docs: [] });
    return vi.fn();
  });
});

describe('useFamily', () => {
  it('returns null when familyId is undefined', () => {
    const { result } = renderHook(() => useFamily(undefined));
    expect(result.current.family).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('sets family data from snapshot', () => {
    let snapshotCb: any;
    mockFirestore.onSnapshot.mockImplementation((_q: any, cb: any) => {
      snapshotCb = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useFamily('family-1'));

    act(() => {
      snapshotCb({
        exists: () => true,
        id: 'family-1',
        data: () => ({ name: 'The Brooks Family', createdBy: 'uid-1' }),
      });
    });

    expect(result.current.family).not.toBeNull();
    expect(result.current.family?.name).toBe('The Brooks Family');
    expect(result.current.loading).toBe(false);
  });

  it('sets family to null when document does not exist', () => {
    let snapshotCb: any;
    mockFirestore.onSnapshot.mockImplementation((_q: any, cb: any) => {
      snapshotCb = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useFamily('family-1'));

    act(() => {
      snapshotCb({ exists: () => false, id: 'family-1', data: () => null });
    });

    expect(result.current.family).toBeNull();
  });
});

describe('useFamilyMembers', () => {
  it('returns empty array when familyId is undefined', () => {
    const { result } = renderHook(() => useFamilyMembers(undefined));
    expect(result.current.members).toEqual([]);
  });

  it('returns members from snapshot', () => {
    mockFirestore.onSnapshot.mockImplementation((_q: any, cb: any) => {
      cb({
        docs: [
          { id: 'uid-1', data: () => ({ roles: ['admin'], email: 'admin@test.com', displayName: 'Admin' }) },
          { id: 'uid-2', data: () => ({ roles: ['storyteller'], email: 'teller@test.com', displayName: 'Teller' }) },
        ],
      });
      return vi.fn();
    });

    const { result } = renderHook(() => useFamilyMembers('family-1'));

    expect(result.current.members).toHaveLength(2);
    expect(result.current.members[0].uid).toBe('uid-1');
    expect(result.current.members[0].roles).toContain('admin');
  });
});

describe('useCurrentRoles', () => {
  it('returns empty roles when familyId or uid is undefined', () => {
    const { result } = renderHook(() => useCurrentRoles(undefined, 'uid-1'));
    expect(result.current.roles).toEqual([]);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isStoryteller).toBe(false);
  });

  it('returns correct roles from member snapshot', () => {
    let snapshotCb: any;
    mockFirestore.onSnapshot.mockImplementation((_q: any, cb: any) => {
      snapshotCb = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useCurrentRoles('family-1', 'uid-1'));

    act(() => {
      snapshotCb({
        exists: () => true,
        data: () => ({ roles: ['admin', 'storyteller'] }),
      });
    });

    expect(result.current.roles).toEqual(['admin', 'storyteller']);
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isStoryteller).toBe(true);
  });
});

describe('createFamily', () => {
  it('creates a family document and returns the ID', async () => {
    mockFirestore.addDoc.mockResolvedValueOnce({ id: 'new-family-id' });
    const mockBatch = { set: vi.fn(), update: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
    mockFirestore.writeBatch.mockReturnValueOnce(mockBatch);

    const id = await createFamily('The Brooks Family', 'uid-1', 'test@test.com', 'Test User');

    expect(id).toBe('new-family-id');
    expect(mockFirestore.addDoc).toHaveBeenCalledTimes(1);
    const familyData = mockFirestore.addDoc.mock.calls[0][1];
    expect(familyData.name).toBe('The Brooks Family');
    expect(familyData.createdBy).toBe('uid-1');
  });

  it('creates the admin member via batch', async () => {
    mockFirestore.addDoc.mockResolvedValueOnce({ id: 'new-family-id' });
    const mockBatch = { set: vi.fn(), update: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
    mockFirestore.writeBatch.mockReturnValueOnce(mockBatch);

    await createFamily('Test Family', 'uid-1', 'test@test.com', 'Test User');

    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    expect(mockBatch.update).toHaveBeenCalledTimes(1);
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });
});

describe('updateMemberRoles', () => {
  it('calls updateDoc with the new roles array', async () => {
    await updateMemberRoles('family-1', 'uid-1', ['admin', 'storyteller']);

    expect(mockFirestore.updateDoc).toHaveBeenCalledTimes(1);
    expect(mockFirestore.updateDoc).toHaveBeenCalledWith(
      expect.anything(),
      { roles: ['admin', 'storyteller'] },
    );
  });

  it('can remove a role by passing the reduced array', async () => {
    await updateMemberRoles('family-1', 'uid-1', ['admin']);

    const payload = mockFirestore.updateDoc.mock.calls[0][1];
    expect(payload.roles).toEqual(['admin']);
    expect(payload.roles).not.toContain('storyteller');
  });
});

describe('getUserFamilyIds', () => {
  it('returns familyIds from user profile', async () => {
    mockFirestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ familyIds: ['f1', 'f2'] }),
    });

    const ids = await getUserFamilyIds('uid-1');
    expect(ids).toEqual(['f1', 'f2']);
  });

  it('returns empty array when user does not exist', async () => {
    mockFirestore.getDoc.mockResolvedValueOnce({ exists: () => false });

    const ids = await getUserFamilyIds('uid-1');
    expect(ids).toEqual([]);
  });

  it('returns empty array when familyIds field is missing', async () => {
    mockFirestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({}),
    });

    const ids = await getUserFamilyIds('uid-1');
    expect(ids).toEqual([]);
  });
});
