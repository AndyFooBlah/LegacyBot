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
 * Tests for the useEvents hooks and CRUD functions.
 * Covers useFamilyEvents subscription and createEvent/updateEvent/deleteEvent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { mockFirestore } from '../../__mocks__/firebase';
import {
  useFamilyEvents,
  createEvent,
  updateEvent,
  deleteEvent,
} from '../../hooks/useEvents';

beforeEach(() => {
  Object.values(mockFirestore).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) (fn as any).mockClear();
  });

  mockFirestore.onSnapshot.mockImplementation((_query: any, cb: any) => {
    cb({ docs: [] });
    return vi.fn();
  });
});

describe('useFamilyEvents', () => {
  it('returns empty array and loading=false when familyId is undefined', () => {
    const { result } = renderHook(() => useFamilyEvents(undefined));
    expect(result.current.events).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('subscribes when familyId is provided', () => {
    renderHook(() => useFamilyEvents('family-1'));
    expect(mockFirestore.collection).toHaveBeenCalled();
    expect(mockFirestore.onSnapshot).toHaveBeenCalledTimes(1);
  });

  it('maps snapshot docs to events with id', () => {
    let snapshotCb: any;
    mockFirestore.onSnapshot.mockImplementation((_q: any, cb: any) => {
      snapshotCb = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useFamilyEvents('family-1'));

    act(() => {
      snapshotCb({
        docs: [
          {
            id: 'evt-1',
            data: () => ({
              familyId: 'family-1',
              title: 'Birth of Margaret',
              date: '1932',
              description: 'She was born in Ohio.',
              storytellerUids: [],
              sessionIds: [],
              createdBy: 'admin-uid',
              createdAt: mockFirestore.Timestamp.now(),
              updatedAt: mockFirestore.Timestamp.now(),
            }),
          },
        ],
      });
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].id).toBe('evt-1');
    expect(result.current.events[0].title).toBe('Birth of Margaret');
    expect(result.current.loading).toBe(false);
  });

  it('calls the unsubscribe function on unmount', () => {
    const unsubscribe = vi.fn();
    mockFirestore.onSnapshot.mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useFamilyEvents('family-1'));
    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('createEvent', () => {
  it('calls addDoc and returns the new document id', async () => {
    mockFirestore.addDoc.mockResolvedValueOnce({ id: 'new-evt-id' });

    const id = await createEvent('family-1', 'Marriage of Ralph', 'They married in 1952.', '1952', 'admin-uid');

    expect(id).toBe('new-evt-id');
    expect(mockFirestore.addDoc).toHaveBeenCalledTimes(1);
  });

  it('saves required fields and timestamps', async () => {
    mockFirestore.addDoc.mockResolvedValueOnce({ id: 'evt-id' });

    await createEvent('family-1', 'Test Event', 'A description.', undefined, 'admin-uid');

    const data = mockFirestore.addDoc.mock.calls[0][1];
    expect(data.title).toBe('Test Event');
    expect(data.description).toBe('A description.');
    expect(data.familyId).toBe('family-1');
    expect(data.createdBy).toBe('admin-uid');
    expect(data.storytellerUids).toEqual([]);
    expect(data.sessionIds).toEqual([]);
    expect(data.createdAt).toBeDefined();
    expect(data.updatedAt).toBeDefined();
  });

  it('omits date field when not provided', async () => {
    mockFirestore.addDoc.mockResolvedValueOnce({ id: 'evt-id' });

    await createEvent('family-1', 'Event', 'Desc', undefined, 'admin-uid');

    const data = mockFirestore.addDoc.mock.calls[0][1];
    expect(data.date).toBeUndefined();
  });

  it('includes date when provided', async () => {
    mockFirestore.addDoc.mockResolvedValueOnce({ id: 'evt-id' });

    await createEvent('family-1', 'Event', 'Desc', 'Summer 1952', 'admin-uid');

    const data = mockFirestore.addDoc.mock.calls[0][1];
    expect(data.date).toBe('Summer 1952');
  });
});

describe('updateEvent', () => {
  it('calls updateDoc with title, description, and updatedAt', async () => {
    await updateEvent('family-1', 'evt-1', { title: 'New Title', description: 'New desc' });

    expect(mockFirestore.updateDoc).toHaveBeenCalledTimes(1);
    const updateData = mockFirestore.updateDoc.mock.calls[0][1];
    expect(updateData.title).toBe('New Title');
    expect(updateData.description).toBe('New desc');
    expect(updateData.updatedAt).toBeDefined();
  });

  it('only updates provided fields', async () => {
    await updateEvent('family-1', 'evt-1', { title: 'Just Title' });

    const updateData = mockFirestore.updateDoc.mock.calls[0][1];
    expect(updateData.title).toBe('Just Title');
    expect(updateData.description).toBeUndefined();
  });
});

describe('deleteEvent', () => {
  it('calls deleteDoc once', async () => {
    await deleteEvent('family-1', 'evt-1');

    expect(mockFirestore.deleteDoc).toHaveBeenCalledTimes(1);
  });
});
