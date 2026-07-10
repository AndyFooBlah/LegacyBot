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
 * Tests for the useInvitations hooks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { mockFirestore } from '../../__mocks__/firebase';
import { useFamilyInvitations, useAcceptInvitation, usePendingInvitations } from '../../hooks/useInvitations';

beforeEach(() => {
  Object.values(mockFirestore).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) (fn as any).mockClear();
  });

  mockFirestore.onSnapshot.mockImplementation((_query: any, cb: any) => {
    cb({ docs: [] });
    return vi.fn();
  });
});

describe('useFamilyInvitations', () => {
  it('returns empty when familyId is undefined', () => {
    const { result } = renderHook(() => useFamilyInvitations(undefined));
    expect(result.current.invitations).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('returns invitations from snapshot', () => {
    mockFirestore.onSnapshot.mockImplementation((_q: any, cb: any) => {
      cb({
        docs: [
          { id: 'inv-1', data: () => ({ email: 'test@test.com', roles: ['storyteller'], status: 'pending' }) },
        ],
      });
      return vi.fn();
    });

    const { result } = renderHook(() => useFamilyInvitations('family-1'));

    expect(result.current.invitations).toHaveLength(1);
    expect(result.current.invitations[0].email).toBe('test@test.com');
  });

  it('provides createInvite function', async () => {
    // Mock the invitations service — addDoc is used by createInvitation
    mockFirestore.addDoc.mockResolvedValueOnce({ id: 'new-invite-id' });

    const { result } = renderHook(() => useFamilyInvitations('family-1'));

    let id: string = '';
    await act(async () => {
      id = await result.current.createInvite('test@test.com', ['storyteller'], ['d1'], 'uid-1');
    });

    expect(id).toBe('new-invite-id');
  });

  it('createInvite throws without familyId', async () => {
    const { result } = renderHook(() => useFamilyInvitations(undefined));

    await expect(
      act(async () => {
        await result.current.createInvite('test@test.com', ['storyteller'], [], 'uid-1');
      }),
    ).rejects.toThrow('No family selected');
  });
});

describe('useAcceptInvitation', () => {
  it('starts with null invitation and no error', () => {
    const { result } = renderHook(() => useAcceptInvitation());

    expect(result.current.invitation).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('loads invitation via loadInvitation', async () => {
    mockFirestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      id: 'inv-1',
      data: () => ({
        familyId: 'family-1',
        email: 'test@test.com',
        roles: ['storyteller'],
        status: 'pending',
      }),
    });

    const { result } = renderHook(() => useAcceptInvitation());

    await act(async () => {
      await result.current.loadInvitation('inv-1');
    });

    expect(result.current.invitation).not.toBeNull();
    expect(result.current.invitation?.email).toBe('test@test.com');
  });

  it('sets error when invitation not found', async () => {
    mockFirestore.getDoc.mockResolvedValueOnce({
      exists: () => false,
    });

    const { result } = renderHook(() => useAcceptInvitation());

    await act(async () => {
      await result.current.loadInvitation('nonexistent');
    });

    expect(result.current.invitation).toBeNull();
    expect(result.current.error).toBe('Invitation not found');
  });
});

describe('usePendingInvitations', () => {
  it('returns empty when email is undefined', () => {
    const { result } = renderHook(() => usePendingInvitations(undefined));
    expect(result.current.invitations).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('subscribes to pending invitations by email', () => {
    mockFirestore.onSnapshot.mockImplementation((_q: any, cb: any) => {
      cb({
        docs: [
          { id: 'inv-1', data: () => ({ email: 'test@test.com', status: 'pending', familyId: 'f1' }) },
        ],
      });
      return vi.fn();
    });

    const { result } = renderHook(() => usePendingInvitations('test@test.com'));

    expect(result.current.invitations).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });
});
