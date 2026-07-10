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
 * Pure utility functions for mutating a family tree array.
 *
 * All functions return a new array (immutable). They are responsible for
 * keeping relationships bidirectional: every time a relation is added,
 * updated, or removed, the corresponding inverse is applied to the target
 * member in the same operation.
 *
 * Inverse mapping:
 *   Parent ↔ Child   |  Spouse ↔ Spouse  |  Sibling ↔ Sibling
 *   Friend ↔ Friend  |  Pet Owner ↔ Pet
 */

import { FamilyMember, RelationType } from '../types';

export const INVERSE_RELATION: Record<RelationType, RelationType> = {
  'Parent':    'Child',
  'Child':     'Parent',
  'Spouse':    'Spouse',
  'Sibling':   'Sibling',
  'Friend':    'Friend',
  'Pet Owner': 'Pet',
  'Pet':       'Pet Owner',
};

/**
 * Remove a member from the tree and scrub all relations pointing to it
 * from every remaining member.
 */
export function applyRemoveMember(tree: FamilyMember[], memberId: string): FamilyMember[] {
  return tree
    .filter((m) => m.id !== memberId)
    .map((m) => ({
      ...m,
      relations: m.relations.filter((r) => r.toMemberId !== memberId),
    }));
}

/**
 * Remove the relation at `relationIndex` from `memberId` and remove the
 * corresponding inverse relation from the target member.
 */
export function applyRemoveRelation(
  tree: FamilyMember[],
  memberId: string,
  relationIndex: number,
): FamilyMember[] {
  const member = tree.find((m) => m.id === memberId);
  if (!member) return tree;

  const relation = member.relations[relationIndex];
  const targetId = relation?.toMemberId;
  const inverseType = relation ? INVERSE_RELATION[relation.type] : null;

  return tree.map((m) => {
    if (m.id === memberId) {
      return { ...m, relations: m.relations.filter((_, i) => i !== relationIndex) };
    }
    if (targetId && inverseType && m.id === targetId) {
      return {
        ...m,
        relations: m.relations.filter(
          (r) => !(r.toMemberId === memberId && r.type === inverseType),
        ),
      };
    }
    return m;
  });
}

/**
 * Update the relation at `relationIndex` on `memberId` with `updates`, and
 * keep the inverse relation on the target member in sync:
 *   - Removes the old inverse from the old target (if any).
 *   - Adds the new inverse on the new target (idempotent, skips self-relations).
 */
export function applyUpdateRelation(
  tree: FamilyMember[],
  memberId: string,
  relationIndex: number,
  updates: { type?: RelationType; toMemberId?: string },
): FamilyMember[] {
  const member = tree.find((m) => m.id === memberId);
  if (!member) return tree;

  const oldRelation = member.relations[relationIndex];
  const newRelation = { ...oldRelation, ...updates };
  const oldTargetId = oldRelation.toMemberId;
  const newTargetId = newRelation.toMemberId;
  const oldInverseType = INVERSE_RELATION[oldRelation.type];
  const newInverseType = INVERSE_RELATION[newRelation.type];

  return tree.map((m) => {
    if (m.id === memberId) {
      return {
        ...m,
        relations: m.relations.map((r, i) => (i === relationIndex ? newRelation : r)),
      };
    }

    let rels = m.relations;

    // Remove the old inverse from the old target.
    if (oldTargetId && m.id === oldTargetId) {
      rels = rels.filter((r) => !(r.toMemberId === memberId && r.type === oldInverseType));
    }

    // Add the new inverse on the new target (skip self-relations, idempotent).
    if (newTargetId && newTargetId !== memberId && m.id === newTargetId) {
      if (!rels.some((r) => r.toMemberId === memberId && r.type === newInverseType)) {
        rels = [...rels, { type: newInverseType, toMemberId: memberId }];
      }
    }

    return rels === m.relations ? m : { ...m, relations: rels };
  });
}
