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
 * Tests for the superadmin-side invitation-code service wrappers.
 *
 * Writes go through callables; reads go through Firestore. The tests mock
 * both layers so we can verify the wrappers shape payloads and unwrap
 * responses correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  mockGenerateCallable: vi.fn(),
  mockDeactivateCallable: vi.fn(),
  mockReactivateCallable: vi.fn(),
  mockGetDocs: vi.fn(),
  mockGetDoc: vi.fn(),
}));
const {
  mockGenerateCallable,
  mockDeactivateCallable,
  mockReactivateCallable,
  mockGetDocs,
  mockGetDoc,
} = hoisted;

vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => {
    if (name === 'generateInvitationCode') return hoisted.mockGenerateCallable;
    if (name === 'deactivateInvitationCode') return hoisted.mockDeactivateCallable;
    if (name === 'reactivateInvitationCode') return hoisted.mockReactivateCallable;
    throw new Error(`Unmocked callable: ${name}`);
  },
}));

vi.mock('firebase/firestore', () => ({
  collection: (...parts: unknown[]) => ({ type: 'collection', parts }),
  doc: (...parts: unknown[]) => ({ type: 'doc', parts }),
  getDoc: (...args: unknown[]) => hoisted.mockGetDoc(...args),
  getDocs: (...args: unknown[]) => hoisted.mockGetDocs(...args),
  orderBy: (field: string, dir: string) => ({ type: 'orderBy', field, dir }),
  query: (...args: unknown[]) => ({ type: 'query', args }),
}));

vi.mock('../../services/firebase', () => ({
  db: { __mock: 'db' },
  functions: { __mock: 'functions' },
}));

import {
  generateInvitationCode,
  deactivateInvitationCode,
  reactivateInvitationCode,
  listInvitationCodes,
  getInvitationCode,
  listRedemptions,
} from '../../services/invitationCodes';

beforeEach(() => {
  mockGenerateCallable.mockReset();
  mockDeactivateCallable.mockReset();
  mockReactivateCallable.mockReset();
  mockGetDocs.mockReset();
  mockGetDoc.mockReset();
});

describe('generateInvitationCode', () => {
  it('passes the description through to the callable', async () => {
    mockGenerateCallable.mockResolvedValue({ data: { code: 'ABC123' } });
    const code = await generateInvitationCode('launch friends');
    expect(mockGenerateCallable).toHaveBeenCalledWith({ description: 'launch friends' });
    expect(code).toBe('ABC123');
  });

  it('omits description when not provided', async () => {
    mockGenerateCallable.mockResolvedValue({ data: { code: 'XYZ789' } });
    await generateInvitationCode();
    expect(mockGenerateCallable).toHaveBeenCalledWith({});
  });

  it('surfaces callable errors', async () => {
    mockGenerateCallable.mockRejectedValue(new Error('permission-denied'));
    await expect(generateInvitationCode()).rejects.toThrow('permission-denied');
  });
});

describe('deactivateInvitationCode / reactivateInvitationCode', () => {
  it('deactivates by code', async () => {
    mockDeactivateCallable.mockResolvedValue({ data: { code: 'ABC123', active: false } });
    await deactivateInvitationCode('ABC123');
    expect(mockDeactivateCallable).toHaveBeenCalledWith({ code: 'ABC123' });
  });

  it('reactivates by code', async () => {
    mockReactivateCallable.mockResolvedValue({ data: { code: 'ABC123', active: true } });
    await reactivateInvitationCode('ABC123');
    expect(mockReactivateCallable).toHaveBeenCalledWith({ code: 'ABC123' });
  });
});

describe('listInvitationCodes', () => {
  it('maps Firestore docs into plain objects with id', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        { id: 'ABC123', data: () => ({ active: true, redemptionCount: 0 }) },
        { id: 'XYZ789', data: () => ({ active: false, redemptionCount: 2 }) },
      ],
    });
    const codes = await listInvitationCodes();
    expect(codes).toEqual([
      { id: 'ABC123', active: true, redemptionCount: 0 },
      { id: 'XYZ789', active: false, redemptionCount: 2 },
    ]);
  });

  it('returns empty array when no codes exist', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    expect(await listInvitationCodes()).toEqual([]);
  });
});

describe('getInvitationCode', () => {
  it('returns the code when it exists', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      id: 'ABC123',
      data: () => ({ active: true }),
    });
    expect(await getInvitationCode('ABC123')).toEqual({ id: 'ABC123', active: true });
  });

  it('returns null when missing', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    expect(await getInvitationCode('MISSING')).toBeNull();
  });
});

describe('listRedemptions', () => {
  it('maps redemption docs under the code into plain objects', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        { id: 'uid-1', data: () => ({ userEmail: 'a@x.com', userDisplayName: 'A' }) },
        { id: 'uid-2', data: () => ({ userEmail: 'b@x.com', userDisplayName: 'B' }) },
      ],
    });
    const redemptions = await listRedemptions('ABC123');
    expect(redemptions).toEqual([
      { id: 'uid-1', userEmail: 'a@x.com', userDisplayName: 'A' },
      { id: 'uid-2', userEmail: 'b@x.com', userDisplayName: 'B' },
    ]);
  });
});
