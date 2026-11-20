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

vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v1', () => ({ region: () => ({ auth: { user: () => ({ onCreate: (fn: unknown) => fn }) } }) }));
vi.mock('firebase-admin/auth', () => ({ getAuth: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  FieldValue: { serverTimestamp: () => 'SERVER_TIME' },
}));

import { allowanceId, decideSignup, enforceSignupDecision } from '../signupGate';

/** A fake Firestore holding pending-invitation addresses and sign-up allowances. */
function fakeDb(opts: { invited?: string[]; allowances?: Record<string, number> } = {}) {
  const writes: Record<string, unknown> = {};
  const queried: string[] = [];
  const db = {
    collection: (name: string) => {
      const filters: Record<string, unknown> = {};
      const q = {
        where: (field: string, _op: string, value: unknown) => { filters[field] = value; return q; },
        limit: () => q,
        get: async () => {
          queried.push(`${name}:${String(filters.email)}:${String(filters.status)}`);
          const hit = name === 'invitations' && filters.status === 'pending' && (opts.invited ?? []).includes(String(filters.email));
          return { empty: !hit };
        },
      };
      return q;
    },
    doc: (path: string) => ({
      get: async () => {
        const id = path.replace('signupAllowances/', '');
        const expires = opts.allowances?.[id];
        return { exists: expires !== undefined, data: () => ({ expiresAt: { toMillis: () => expires } }) };
      },
      set: async (data: unknown) => { writes[path] = data; },
    }),
  };
  return { db: db as never, writes, queried };
}
const fakeAuth = () => ({ updateUser: vi.fn().mockResolvedValue(undefined), revokeRefreshTokens: vi.fn().mockResolvedValue(undefined) });

describe('decideSignup', () => {
  it('allows an address with a pending invitation, whatever its capitalisation', async () => {
    const { db, queried } = fakeDb({ invited: ['graciete@furtado.example'] });
    expect(await decideSignup(db, '  Graciete@Furtado.Example ')).toEqual({ allowed: true, reason: 'invited' });
    expect(queried[0]).toBe('invitations:graciete@furtado.example:pending');
  });

  it('refuses an address nobody invited', async () => {
    const { db } = fakeDb({ invited: ['graciete@furtado.example'] });
    expect(await decideSignup(db, 'outsider@elsewhere.example')).toEqual({ allowed: false, reason: 'not-invited' });
  });

  it('refuses an account with no email address', async () => {
    const { db } = fakeDb();
    expect(await decideSignup(db, undefined)).toEqual({ allowed: false, reason: 'no-email' });
    expect(await decideSignup(db, '   ')).toEqual({ allowed: false, reason: 'no-email' });
  });

  it('allows an address holding an unexpired sign-up allowance, and not an expired one', async () => {
    const now = 1_000_000;
    const email = 'newfamily@elsewhere.example';
    expect(await decideSignup(fakeDb({ allowances: { [allowanceId(email)]: now + 60_000 } }).db, email, now)).toEqual({ allowed: true, reason: 'allowance' });
    expect(await decideSignup(fakeDb({ allowances: { [allowanceId(email)]: now - 1 } }).db, email, now)).toEqual({ allowed: false, reason: 'not-invited' });
  });
});

describe('enforceSignupDecision', () => {
  it('leaves an invited account alone', async () => {
    const { db, writes } = fakeDb({ invited: ['teo@furtado.example'] });
    const auth = fakeAuth();
    await enforceSignupDecision({ db, auth }, { uid: 'fx-teo', email: 'teo@furtado.example' });
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(writes).toEqual({});
  });

  it('disables a stranger, revokes their sessions, and records it without copying their address', async () => {
    const { db, writes } = fakeDb();
    const auth = fakeAuth();
    const decision = await enforceSignupDecision({ db, auth }, { uid: 'fx-outsider', email: 'outsider@elsewhere.example', providerData: [{ providerId: 'google.com' }] });
    expect(decision.allowed).toBe(false);
    expect(auth.updateUser).toHaveBeenCalledWith('fx-outsider', { disabled: true });
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('fx-outsider');
    expect(writes['signupRefusals/fx-outsider']).toEqual({ at: 'SERVER_TIME', reason: 'not-invited', providers: ['google.com'] });
    expect(JSON.stringify(writes)).not.toContain('elsewhere.example');
  });

  it('disables rather than deletes, so a mistake can be undone', async () => {
    const auth = { ...fakeAuth(), deleteUser: vi.fn() };
    await enforceSignupDecision({ db: fakeDb().db, auth }, { uid: 'u', email: 'x@elsewhere.example' });
    expect(auth.deleteUser).not.toHaveBeenCalled();
  });
});
