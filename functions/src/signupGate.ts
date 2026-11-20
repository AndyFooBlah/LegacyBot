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
 * Strangers do not get accounts.
 *
 * Owner decision, 2026-11-19: a new member of an existing family must be
 * invited by that family's admin; a new family needs a sign-up code, and no
 * codes are being issued for now.
 *
 * The project is on standard Firebase Auth, which cannot refuse an account
 * before it exists (that needs the Identity Platform upgrade and a blocking
 * function). So this runs the moment an account is created: if the address
 * has no pending invitation and no sign-up allowance, the account is
 * disabled and its sessions revoked. It is disabled rather than deleted so
 * that a mistake (an invitation sent to one address, a sign-up with another)
 * is something a person can see and undo, not a silent disappearance.
 *
 * In the second or two before that, and for up to an hour on the ID token
 * already issued, the account can still call the API. That window is closed
 * separately: every callable that costs money requires family membership
 * (membership.ts), and the security rules give a family-less account nothing
 * to read.
 *
 * `signupAllowances/{sha256(email)}` is the hook for sign-up codes. Nothing
 * writes it today. When codes are issued, the code-redemption step writes a
 * short-lived allowance for the address BEFORE the person creates an account,
 * and this gate lets them through.
 */

import { createHash } from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import * as functionsV1 from 'firebase-functions/v1';

export type SignupDecision =
  | { allowed: true; reason: 'invited' | 'allowance' }
  | { allowed: false; reason: 'no-email' | 'not-invited' };

export const allowanceId = (email: string): string =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

export async function decideSignup(db: Firestore, email: string | undefined | null, now = Date.now()): Promise<SignupDecision> {
  const address = (email ?? '').trim().toLowerCase();
  if (!address) return { allowed: false, reason: 'no-email' };

  const pending = await db.collection('invitations')
    .where('email', '==', address).where('status', '==', 'pending').limit(1).get();
  if (!pending.empty) return { allowed: true, reason: 'invited' };

  const allowance = await db.doc(`signupAllowances/${allowanceId(address)}`).get();
  const expires = allowance.exists ? allowance.data()?.expiresAt?.toMillis?.() : undefined;
  if (typeof expires === 'number' && expires > now) return { allowed: true, reason: 'allowance' };

  return { allowed: false, reason: 'not-invited' };
}

/** What the trigger does with a decision. Split out so it can be tested without the trigger wrapper. */
export async function enforceSignupDecision(
  deps: { db: Firestore; auth: { updateUser(uid: string, p: { disabled: boolean }): Promise<unknown>; revokeRefreshTokens(uid: string): Promise<unknown> } },
  user: { uid: string; email?: string | null; providerData?: { providerId: string }[] },
): Promise<SignupDecision> {
  const decision = await decideSignup(deps.db, user.email);
  if (decision.allowed) {
    logger.info('[signupGate] account allowed', { uid: user.uid, reason: decision.reason });
    return decision;
  }
  await deps.auth.updateUser(user.uid, { disabled: true });
  await deps.auth.revokeRefreshTokens(user.uid);
  // A record an admin can read. The address itself is a stranger's personal
  // data and is deliberately not copied here or into the log; the uid finds it
  // in the Auth console.
  await deps.db.doc(`signupRefusals/${user.uid}`).set({
    at: FieldValue.serverTimestamp(),
    reason: decision.reason,
    providers: (user.providerData ?? []).map((p) => p.providerId),
  });
  logger.warn('[signupGate] account refused and disabled', { uid: user.uid, reason: decision.reason });
  return decision;
}

// Region is pinned: left to default, this first-generation trigger deployed to
// us-east1, away from every other function, where no artifact cleanup policy
// exists and each deploy then exits with an error.
export const onAuthUserCreated = functionsV1.region('us-central1').auth.user().onCreate(async (user) => {
  await enforceSignupDecision({ db: getFirestore(), auth: getAuth() }, user);
});
