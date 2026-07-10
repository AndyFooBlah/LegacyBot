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
 * Superadmin-side invitation-code management service.
 *
 * Writes (generate / deactivate / reactivate) all go through Cloud Function
 * callables so the backend can enforce the superadmin claim. Reads (listing
 * codes and their redemptions) happen directly against Firestore — the
 * `invitationCodes` collection is rule-gated to `isSuperadmin()` so any
 * signed-in superadmin can enumerate codes from the browser.
 */

import { httpsCallable } from 'firebase/functions';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
} from 'firebase/firestore';
import { db, functions } from './firebase';
import { InvitationCode, InvitationCodeRedemption } from '../types';

const generateCallable = httpsCallable<
  { description?: string },
  { code: string }
>(functions, 'generateInvitationCode');

const deactivateCallable = httpsCallable<
  { code: string },
  { code: string; active: false }
>(functions, 'deactivateInvitationCode');

const reactivateCallable = httpsCallable<
  { code: string },
  { code: string; active: true }
>(functions, 'reactivateInvitationCode');

/** Superadmin: mint a new 6-char code. */
export async function generateInvitationCode(description?: string): Promise<string> {
  const { data } = await generateCallable(description ? { description } : {});
  return data.code;
}

/** Superadmin: mark a code inactive. Redemption history is retained. */
export async function deactivateInvitationCode(code: string): Promise<void> {
  await deactivateCallable({ code });
}

/** Superadmin: flip a previously deactivated code back to active. */
export async function reactivateInvitationCode(code: string): Promise<void> {
  await reactivateCallable({ code });
}

/** Superadmin: list all codes, newest first. */
export async function listInvitationCodes(): Promise<InvitationCode[]> {
  const colRef = collection(db, 'invitationCodes');
  const snapshot = await getDocs(query(colRef, orderBy('createdAt', 'desc')));
  return snapshot.docs.map((d) => ({ ...d.data(), id: d.id }) as InvitationCode);
}

/** Superadmin: fetch a single code doc. */
export async function getInvitationCode(code: string): Promise<InvitationCode | null> {
  const ref = doc(db, 'invitationCodes', code);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { ...snap.data(), id: snap.id } as InvitationCode;
}

/** Superadmin: list everyone who has redeemed a given code. */
export async function listRedemptions(code: string): Promise<InvitationCodeRedemption[]> {
  const colRef = collection(db, 'invitationCodes', code, 'redemptions');
  const snapshot = await getDocs(query(colRef, orderBy('redeemedAt', 'desc')));
  return snapshot.docs.map((d) => ({ ...d.data(), id: d.id }) as InvitationCodeRedemption);
}
