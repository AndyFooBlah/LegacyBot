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
 * "Signed in" is not enough to spend the project's money.
 *
 * BiographyBot is invitation-only, but Firebase Auth will mint an account for
 * anyone, and a signed-in account that belongs to no family used to be able
 * to call the model brokers, the live-token mint and the maps proxy. Every
 * callable that costs money or reaches a third-party API now requires the
 * caller to belong to at least one family.
 *
 * Membership is read from the `familyIds` custom claim that `onMemberWritten`
 * maintains. A token minted just before a person joined their first family
 * does not carry the claim yet, so a missing claim falls back to one read of
 * the caller's own `users/{uid}` document rather than refusing a real member.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

export const INVITATION_ONLY_MESSAGE =
  "BiographyBot is invitation-only. Ask your family's admin to invite this email address.";

type AuthLike = Pick<CallableRequest, 'auth'>;

export async function requireFamilyMember(request: AuthLike): Promise<string> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign-in required.');
  }
  const uid = request.auth.uid;
  const claim = (request.auth.token as Record<string, unknown> | undefined)?.familyIds;
  if (Array.isArray(claim) && claim.length > 0) return uid;

  const profile = await getFirestore().doc(`users/${uid}`).get();
  const familyIds = profile.exists ? (profile.data()?.familyIds as unknown) : undefined;
  if (Array.isArray(familyIds) && familyIds.length > 0) return uid;

  throw new HttpsError('permission-denied', INVITATION_ONLY_MESSAGE);
}
