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
 * Tests for src/utils/familyTree.ts — pure tree mutation helpers that keep
 * family-tree relationships bidirectional.
 */

import { describe, it, expect } from 'vitest';
import { applyRemoveMember, applyRemoveRelation, applyUpdateRelation, INVERSE_RELATION } from '../../utils/familyTree';
import { FamilyMember } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMember(id: string, relations: FamilyMember['relations'] = []): FamilyMember {
  return { id, name: id, relations, memberType: 'person' };
}

// ---------------------------------------------------------------------------
// INVERSE_RELATION
// ---------------------------------------------------------------------------

describe('INVERSE_RELATION', () => {
  it('maps every RelationType to its inverse', () => {
    expect(INVERSE_RELATION['Parent']).toBe('Child');
    expect(INVERSE_RELATION['Child']).toBe('Parent');
    expect(INVERSE_RELATION['Spouse']).toBe('Spouse');
    expect(INVERSE_RELATION['Sibling']).toBe('Sibling');
    expect(INVERSE_RELATION['Friend']).toBe('Friend');
    expect(INVERSE_RELATION['Pet Owner']).toBe('Pet');
    expect(INVERSE_RELATION['Pet']).toBe('Pet Owner');
  });

  it('is its own inverse for symmetric relations', () => {
    for (const type of ['Spouse', 'Sibling', 'Friend'] as const) {
      expect(INVERSE_RELATION[INVERSE_RELATION[type]]).toBe(type);
    }
  });
});

// ---------------------------------------------------------------------------
// applyRemoveMember
// ---------------------------------------------------------------------------

describe('applyRemoveMember', () => {
  it('removes the target member', () => {
    const tree = [makeMember('a'), makeMember('b')];
    const result = applyRemoveMember(tree, 'a');
    expect(result.map((m) => m.id)).toEqual(['b']);
  });

  it('scrubs relations pointing to the removed member from all remaining members', () => {
    const tree = [
      makeMember('a', [{ type: 'Spouse', toMemberId: 'b' }]),
      makeMember('b', [{ type: 'Spouse', toMemberId: 'a' }]),
      makeMember('c', [{ type: 'Friend', toMemberId: 'a' }]),
    ];
    const result = applyRemoveMember(tree, 'a');
    expect(result.find((m) => m.id === 'b')!.relations).toEqual([]);
    expect(result.find((m) => m.id === 'c')!.relations).toEqual([]);
  });

  it('leaves unrelated members unchanged', () => {
    const tree = [
      makeMember('a'),
      makeMember('b', [{ type: 'Friend', toMemberId: 'c' }]),
      makeMember('c', [{ type: 'Friend', toMemberId: 'b' }]),
    ];
    const result = applyRemoveMember(tree, 'a');
    expect(result.find((m) => m.id === 'b')!.relations).toEqual([{ type: 'Friend', toMemberId: 'c' }]);
  });

  it('returns tree unchanged when memberId not found', () => {
    const tree = [makeMember('a')];
    const result = applyRemoveMember(tree, 'nonexistent');
    expect(result).toEqual(tree);
  });
});

// ---------------------------------------------------------------------------
// applyRemoveRelation
// ---------------------------------------------------------------------------

describe('applyRemoveRelation', () => {
  it('removes the relation from the source member', () => {
    const tree = [
      makeMember('a', [{ type: 'Parent', toMemberId: 'b' }]),
      makeMember('b', [{ type: 'Child', toMemberId: 'a' }]),
    ];
    const result = applyRemoveRelation(tree, 'a', 0);
    expect(result.find((m) => m.id === 'a')!.relations).toEqual([]);
  });

  it('removes the inverse relation from the target member', () => {
    const tree = [
      makeMember('a', [{ type: 'Parent', toMemberId: 'b' }]),
      makeMember('b', [{ type: 'Child', toMemberId: 'a' }]),
    ];
    const result = applyRemoveRelation(tree, 'a', 0);
    expect(result.find((m) => m.id === 'b')!.relations).toEqual([]);
  });

  it('handles symmetric relations (Spouse)', () => {
    const tree = [
      makeMember('a', [{ type: 'Spouse', toMemberId: 'b' }]),
      makeMember('b', [{ type: 'Spouse', toMemberId: 'a' }]),
    ];
    const result = applyRemoveRelation(tree, 'a', 0);
    expect(result.find((m) => m.id === 'b')!.relations).toEqual([]);
  });

  it('does not remove non-matching relations from target', () => {
    const tree = [
      makeMember('a', [{ type: 'Parent', toMemberId: 'b' }]),
      makeMember('b', [
        { type: 'Child', toMemberId: 'a' },
        { type: 'Sibling', toMemberId: 'c' },
      ]),
    ];
    const result = applyRemoveRelation(tree, 'a', 0);
    expect(result.find((m) => m.id === 'b')!.relations).toEqual([
      { type: 'Sibling', toMemberId: 'c' },
    ]);
  });

  it('is a no-op when relation has no target', () => {
    const tree = [
      makeMember('a', [{ type: 'Parent', toMemberId: '' }]),
      makeMember('b'),
    ];
    const result = applyRemoveRelation(tree, 'a', 0);
    expect(result.find((m) => m.id === 'a')!.relations).toEqual([]);
    expect(result.find((m) => m.id === 'b')!.relations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyUpdateRelation — target changes
// ---------------------------------------------------------------------------

describe('applyUpdateRelation — toMemberId changes', () => {
  it('adds the inverse on the new target when a target is selected', () => {
    const tree = [
      makeMember('a', [{ type: 'Parent', toMemberId: '' }]),
      makeMember('b'),
    ];
    const result = applyUpdateRelation(tree, 'a', 0, { toMemberId: 'b' });
    expect(result.find((m) => m.id === 'b')!.relations).toEqual([
      { type: 'Child', toMemberId: 'a' },
    ]);
  });

  it('removes inverse from old target when target changes', () => {
    const tree = [
      makeMember('a', [{ type: 'Parent', toMemberId: 'b' }]),
      makeMember('b', [{ type: 'Child', toMemberId: 'a' }]),
      makeMember('c'),
    ];
    const result = applyUpdateRelation(tree, 'a', 0, { toMemberId: 'c' });
    expect(result.find((m) => m.id === 'b')!.relations).toEqual([]);
    expect(result.find((m) => m.id === 'c')!.relations).toEqual([
      { type: 'Child', toMemberId: 'a' },
    ]);
  });

  it('does not add a self-relation inverse', () => {
    const tree = [makeMember('a', [{ type: 'Sibling', toMemberId: '' }])];
    const result = applyUpdateRelation(tree, 'a', 0, { toMemberId: 'a' });
    // The source relation is updated but no inverse is added to itself
    expect(result.find((m) => m.id === 'a')!.relations).toEqual([
      { type: 'Sibling', toMemberId: 'a' },
    ]);
  });

  it('does not add a duplicate inverse', () => {
    const tree = [
      makeMember('a', [
        { type: 'Sibling', toMemberId: 'b' },
        { type: 'Sibling', toMemberId: '' },
      ]),
      makeMember('b', [{ type: 'Sibling', toMemberId: 'a' }]),
    ];
    // Set second relation's target to b (duplicate inverse would result)
    const result = applyUpdateRelation(tree, 'a', 1, { toMemberId: 'b' });
    const bRelations = result.find((m) => m.id === 'b')!.relations;
    expect(bRelations.filter((r) => r.toMemberId === 'a' && r.type === 'Sibling')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// applyUpdateRelation — type changes
// ---------------------------------------------------------------------------

describe('applyUpdateRelation — type changes', () => {
  it('updates the inverse type on the target when type changes', () => {
    const tree = [
      makeMember('a', [{ type: 'Parent', toMemberId: 'b' }]),
      makeMember('b', [{ type: 'Child', toMemberId: 'a' }]),
    ];
    const result = applyUpdateRelation(tree, 'a', 0, { type: 'Spouse' });
    expect(result.find((m) => m.id === 'b')!.relations).toEqual([
      { type: 'Spouse', toMemberId: 'a' },
    ]);
  });

  it('handles Pet Owner ↔ Pet inverse correctly', () => {
    const tree = [
      makeMember('owner', [{ type: 'Pet Owner', toMemberId: 'fluffy' }]),
      makeMember('fluffy', [{ type: 'Pet', toMemberId: 'owner' }]),
    ];
    // Change owner's relation type (shouldn't happen in normal flow, but verify)
    const result = applyUpdateRelation(tree, 'owner', 0, { type: 'Friend' });
    expect(result.find((m) => m.id === 'fluffy')!.relations).toEqual([
      { type: 'Friend', toMemberId: 'owner' },
    ]);
  });
});
