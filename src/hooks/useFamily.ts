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
 * Family management hook for LegacyBot.
 * Provides family CRUD, member listing, and role checking.
 *
 * Firestore paths:
 *   families/{familyId}
 *   families/{familyId}/members/{uid}
 */

import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  query,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { Family, FamilyMember, FamilyMemberRecord, UserRole } from '../types';

/**
 * Subscribe to a single family document.
 */
export function useFamily(familyId: string | undefined) {
  const [family, setFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!familyId) {
      setFamily(null);
      setLoading(false);
      return;
    }

    const docRef = doc(db, 'families', familyId);
    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          // Normalize any family tree members that were saved before the
          // `relations` field was introduced.
          if (Array.isArray(data.familyTree)) {
            data.familyTree = data.familyTree.map((m: any, i: number) => ({
              ...m,
              id: m.id ?? `legacy-member-${i}`,
              relations: m.relations ?? [],
            }));
          }
          setFamily({ ...data, id: snapshot.id } as Family);
        } else {
          setFamily(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error('useFamily snapshot error:', err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [familyId]);

  return { family, loading };
}

/**
 * Subscribe to all members of a family.
 */
export function useFamilyMembers(familyId: string | undefined) {
  const [members, setMembers] = useState<(FamilyMemberRecord & { uid: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!familyId) {
      setMembers([]);
      setLoading(false);
      return;
    }

    const colRef = collection(db, 'families', familyId, 'members');
    const q = query(colRef);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            ...data,
            relations: data.relations ?? [],
            uid: d.id,
          };
        }) as unknown as (FamilyMemberRecord & { uid: string })[];
        setMembers(items);
        setLoading(false);
      },
      (err) => {
        console.error('useFamilyMembers snapshot error:', err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [familyId]);

  return { members, loading };
}

/**
 * Get the current user's roles within a specific family.
 */
export function useCurrentRoles(familyId: string | undefined, uid: string | undefined) {
  const [roles, setRoles] = useState<UserRole[]>([]);
  // Track which familyId+uid pair the current roles were loaded for.
  // loading is derived synchronously: true whenever we have a uid/familyId but
  // haven't yet received a snapshot confirming them. This prevents a transient
  // render where uid just arrived but the effect-based loading flag still reflects
  // a prior null-uid state, which would incorrectly trigger a Navigate redirect.
  const [loadedFor, setLoadedFor] = useState<{ familyId: string; uid: string } | null>(null);

  useEffect(() => {
    if (!familyId || !uid) {
      setRoles([]);
      setLoadedFor(null);
      return;
    }

    const docRef = doc(db, 'families', familyId, 'members', uid);
    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as FamilyMemberRecord;
          setRoles(data.roles);
        } else {
          setRoles([]);
        }
        setLoadedFor({ familyId, uid });
      },
      (err) => {
        console.error('useCurrentRoles snapshot error:', err);
        setRoles([]);
        setLoadedFor({ familyId, uid });
      },
    );

    return unsubscribe;
  }, [familyId, uid]);

  const loading = !loadedFor ||
    !(loadedFor.familyId === familyId && loadedFor.uid === uid);
  const isAdmin = !loading && roles.includes('admin');
  const isStoryteller = !loading && roles.includes('storyteller');

  return { roles, isAdmin, isStoryteller, loading };
}

/**
 * M9: Per-user family cap. A single account shouldn't be able to create
 * thousands of empty families — that would fan-out invitation emails and
 * Firestore docs. 10 is far above any plausible legitimate use.
 */
export const MAX_FAMILIES_PER_USER = 10;

// Family creation happens exclusively through the `redeemInvitationCode` Cloud
// Function (Admin SDK), which gates it behind a valid invitation code. Direct
// client-side creation is denied by `families` `allow create: if false`, so the
// former client-side `createFamily` helper has been removed — it could only
// ever have failed at runtime, and it wrote `familyIds` client-side, which is
// no longer permitted.

/**
 * Update the family tree for a family (shared across all dossiers).
 */
export async function updateFamilyTree(
  familyId: string,
  familyTree: FamilyMember[],
): Promise<void> {
  const docRef = doc(db, 'families', familyId);
  await updateDoc(docRef, { familyTree });
}

/**
 * Update the roles array for a family member.
 * Caller must be a family admin (enforced by Firestore rules).
 */
export async function updateMemberRoles(
  familyId: string,
  uid: string,
  roles: UserRole[],
): Promise<void> {
  const memberRef = doc(db, 'families', familyId, 'members', uid);
  await updateDoc(memberRef, { roles });
}

/**
 * Fetch the user's familyIds from their profile.
 */
export async function getUserFamilyIds(uid: string): Promise<string[]> {
  const userRef = doc(db, 'users', uid);
  const snapshot = await getDoc(userRef);
  if (!snapshot.exists()) return [];
  return snapshot.data().familyIds ?? [];
}
