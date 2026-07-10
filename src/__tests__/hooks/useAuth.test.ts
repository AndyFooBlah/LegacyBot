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
 * Tests for the useAuth hook.
 *
 * Verifies sign-in flows (Google, email), separate sign-up flow,
 * user profile creation, sign-out, and auth state management.
 *
 * Profile creation is handled fire-and-forget in onAuthStateChanged,
 * not inside the sign-in methods, so it is tested via the auth state section.
 *
 * References: design.md §5.3 (Priority 1) | src/hooks/useAuth.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { mockAuth, mockFirestore } from '../../__mocks__/firebase';

// Must import useAuth after mocks are in place (setup.ts handles that)
import { useAuth } from '../../hooks/useAuth';

beforeEach(() => {
  // Reset all mock call history
  Object.values(mockAuth).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) (fn as any).mockClear();
  });
  Object.values(mockFirestore).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) (fn as any).mockClear();
  });

  // Default: no user signed in
  mockAuth.onAuthStateChanged.mockImplementation((_auth: any, cb: any) => {
    cb(null);
    return vi.fn();
  });
});

describe('useAuth — auth state', () => {
  it('starts in loading state', () => {
    // Delay the callback so loading is still true on first render
    mockAuth.onAuthStateChanged.mockImplementation(() => vi.fn());

    const { result } = renderHook(() => useAuth());

    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();
  });

  it('sets user to null when no one is signed in', async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
  });

  it('sets user when Firebase reports a signed-in user', async () => {
    const fakeUser = {
      uid: 'u1',
      email: 'a@b.com',
      displayName: 'Alice',
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    };
    mockAuth.onAuthStateChanged.mockImplementation((_auth: any, cb: any) => {
      cb(fakeUser);
      return vi.fn();
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toEqual(fakeUser);
  });

  it('unsubscribes from onAuthStateChanged on unmount', () => {
    const unsub = vi.fn();
    mockAuth.onAuthStateChanged.mockImplementation(() => unsub);

    const { unmount } = renderHook(() => useAuth());
    unmount();

    expect(unsub).toHaveBeenCalled();
  });

  it('reads the isSuperadmin custom claim from the ID token', async () => {
    const fakeUser = {
      uid: 'u1',
      email: 'a@b.com',
      displayName: 'Alice',
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: { isSuperadmin: true } }),
    };
    mockFirestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    mockAuth.onAuthStateChanged.mockImplementation((_auth: any, cb: any) => {
      cb(fakeUser);
      return vi.fn();
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.isSuperadmin).toBe(true));
    expect(fakeUser.getIdTokenResult).toHaveBeenCalled();
  });

  it('defaults isSuperadmin to false when the claim is missing', async () => {
    const fakeUser = {
      uid: 'u2',
      email: 'b@b.com',
      displayName: 'Bob',
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    };
    mockFirestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    mockAuth.onAuthStateChanged.mockImplementation((_auth: any, cb: any) => {
      cb(fakeUser);
      return vi.fn();
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isSuperadmin).toBe(false);
  });

  it('resets isSuperadmin to false on sign-out', async () => {
    const fakeUser = {
      uid: 'u1',
      email: 'a@b.com',
      displayName: 'Alice',
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: { isSuperadmin: true } }),
    };
    mockFirestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    let cbRef: ((u: unknown) => void) | null = null;
    mockAuth.onAuthStateChanged.mockImplementation((_auth: any, cb: any) => {
      cbRef = cb;
      cb(fakeUser);
      return vi.fn();
    });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isSuperadmin).toBe(true));

    act(() => {
      cbRef?.(null);
    });
    await waitFor(() => expect(result.current.isSuperadmin).toBe(false));
  });

  it('creates user profile with familyIds when auth state changes to signed-in', async () => {
    const fakeUser = {
      uid: 'u1',
      email: 'a@b.com',
      displayName: 'Alice',
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    };
    mockFirestore.getDoc.mockResolvedValueOnce({ exists: () => false });
    mockAuth.onAuthStateChanged.mockImplementation((_auth: any, cb: any) => {
      cb(fakeUser);
      return vi.fn();
    });

    renderHook(() => useAuth());

    await waitFor(() => expect(mockFirestore.setDoc).toHaveBeenCalledTimes(1));
    const profileData = mockFirestore.setDoc.mock.calls[0][1];
    expect(profileData.familyIds).toEqual([]);
  });

  it('does not overwrite existing user profile when timezone matches', async () => {
    const fakeUser = {
      uid: 'u1',
      email: 'a@b.com',
      displayName: 'Alice',
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    };
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    mockFirestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ timezone: browserTimezone }),
    });
    mockAuth.onAuthStateChanged.mockImplementation((_auth: any, cb: any) => {
      cb(fakeUser);
      return vi.fn();
    });

    renderHook(() => useAuth());

    // Give fire-and-forget time to run, then verify no write happened
    await waitFor(() => expect(mockFirestore.getDoc).toHaveBeenCalledTimes(1));
    expect(mockFirestore.setDoc).not.toHaveBeenCalled();
  });
});

describe('useAuth — signInWithGoogle', () => {
  it('calls signInWithPopup', async () => {
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signInWithGoogle();
    });

    expect(mockAuth.signInWithPopup).toHaveBeenCalledTimes(1);
  });
});

describe('useAuth — signInWithEmail', () => {
  it('signs in an existing user', async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signInWithEmail('test@example.com', 'password123');
    });

    expect(mockAuth.signInWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      'test@example.com',
      'password123',
    );
  });

  it('propagates errors directly (no auto-registration)', async () => {
    mockAuth.signInWithEmailAndPassword.mockRejectedValueOnce({
      code: 'auth/invalid-credential',
    });

    const { result } = renderHook(() => useAuth());

    await expect(
      act(async () => {
        await result.current.signInWithEmail('test@example.com', 'wrongpass');
      }),
    ).rejects.toEqual({ code: 'auth/invalid-credential' });

    // Sign-in errors should never trigger account creation
    expect(mockAuth.createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });
});

describe('useAuth — signUpWithEmail', () => {
  it('creates a new account', async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signUpWithEmail('new@example.com', 'pass123');
    });

    expect(mockAuth.createUserWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      'new@example.com',
      'pass123',
    );
  });

  it('does not call signInWithEmailAndPassword', async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signUpWithEmail('new@example.com', 'pass123');
    });

    expect(mockAuth.signInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('propagates errors (e.g. email-already-in-use)', async () => {
    mockAuth.createUserWithEmailAndPassword.mockRejectedValueOnce({
      code: 'auth/email-already-in-use',
    });

    const { result } = renderHook(() => useAuth());

    await expect(
      act(async () => {
        await result.current.signUpWithEmail('existing@example.com', 'pass123');
      }),
    ).rejects.toEqual({ code: 'auth/email-already-in-use' });
  });
});

describe('useAuth — signOut', () => {
  it('calls Firebase signOut', async () => {
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
  });
});
