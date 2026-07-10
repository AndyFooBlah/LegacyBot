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
 * FamilyTreePage — admin editor for the relational family tree.
 *
 * Route: /family/:familyId/tree
 */

import React from 'react';
import { useParams } from 'react-router-dom';
import { useFamily, updateFamilyTree } from '../../hooks/useFamily';
import { FamilyNav } from './FamilyNav';
import { FamilyMember, MemberType, RelationType } from '../../types';
import { applyRemoveMember, applyRemoveRelation, applyUpdateRelation } from '../../utils/familyTree';

function treeDisplayName(m: { name: string; firstName?: string; lastName?: string }): string {
  if (m.firstName && m.lastName) return `${m.lastName}, ${m.firstName}`;
  if (m.firstName) return m.firstName;
  return m.name || 'Unnamed';
}

export const FamilyTreePage: React.FC = () => {
  const { familyId } = useParams<{ familyId: string }>();
  const { family, loading } = useFamily(familyId);

  function handleAddFamilyMember(memberType: MemberType) {
    if (!familyId || !family) return;
    const newMember: FamilyMember = {
      id: `member-${Date.now()}`,
      name: '',
      relations: [],
      memberType,
    };
    updateFamilyTree(familyId, [...(family.familyTree ?? []), newMember]);
  }

  function handleFamilyMemberChange(memberId: string, updates: Partial<FamilyMember>) {
    if (!familyId || !family) return;
    const updated = (family.familyTree ?? []).map((m) =>
      m.id === memberId ? { ...m, ...updates } : m,
    );
    updateFamilyTree(familyId, updated);
  }

  function handleRemoveFamilyMember(memberId: string) {
    if (!familyId || !family) return;
    const tree = family.familyTree ?? [];
    const member = tree.find((m) => m.id === memberId);
    if (!window.confirm(`Remove ${member ? treeDisplayName(member) : 'this member'} from the family tree?`)) return;
    updateFamilyTree(familyId, applyRemoveMember(tree, memberId));
  }

  function handleAddRelation(memberId: string) {
    if (!familyId || !family) return;
    const member = (family.familyTree ?? []).find((m) => m.id === memberId);
    if (!member) return;
    handleFamilyMemberChange(memberId, {
      relations: [...member.relations, { type: 'Parent' as RelationType, toMemberId: '' }],
    });
  }

  function handleRemoveRelation(memberId: string, relationIndex: number) {
    if (!familyId || !family) return;
    updateFamilyTree(familyId, applyRemoveRelation(family.familyTree ?? [], memberId, relationIndex));
  }

  function handleUpdateRelation(
    memberId: string,
    relationIndex: number,
    updates: { type?: RelationType; toMemberId?: string },
  ) {
    if (!familyId || !family) return;
    updateFamilyTree(
      familyId,
      applyUpdateRelation(family.familyTree ?? [], memberId, relationIndex, updates),
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  const familyTree = family?.familyTree ?? [];

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-6">
      <FamilyNav familyId={familyId!} familyName={family?.name} />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-700">Family Tree</h2>
          <div className="flex gap-2">
            <button
              onClick={() => handleAddFamilyMember('person')}
              className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
            >
              + Add Person
            </button>
            <button
              onClick={() => handleAddFamilyMember('pet')}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors"
            >
              + Add Pet
            </button>
          </div>
        </div>

        {familyTree.length === 0 ? (
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-8 text-center text-slate-400">
            No family members added yet. Add people, pets, and friends to build your family tree.
          </div>
        ) : (
          <div className="space-y-4">
            {familyTree.map((member) => (
              <div
                key={member.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4"
              >
                {/* Member header */}
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-2">
                      {member.memberType === 'pet' ? (
                        <input
                          type="text"
                          value={member.name}
                          onChange={(e) => handleFamilyMemberChange(member.id, { name: e.target.value })}
                          placeholder="Pet name"
                          className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      ) : (
                        <>
                          <input
                            type="text"
                            value={member.firstName ?? ''}
                            onChange={(e) =>
                              handleFamilyMemberChange(member.id, {
                                firstName: e.target.value,
                                name: [e.target.value, member.lastName ?? ''].filter(Boolean).join(' '),
                              })
                            }
                            placeholder="First name"
                            className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                          <input
                            type="text"
                            value={member.lastName ?? ''}
                            onChange={(e) =>
                              handleFamilyMemberChange(member.id, {
                                lastName: e.target.value,
                                name: [member.firstName ?? '', e.target.value].filter(Boolean).join(' '),
                              })
                            }
                            placeholder="Last name"
                            className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </>
                      )}
                      <span className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded-full font-medium">
                        {member.memberType === 'pet' ? '🐾 Pet' : '👤 Person'}
                      </span>
                    </div>

                    <textarea
                      value={member.notes || ''}
                      onChange={(e) => handleFamilyMemberChange(member.id, { notes: e.target.value })}
                      placeholder="Notes (optional)"
                      rows={2}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                    />
                  </div>

                  <button
                    onClick={() => handleRemoveFamilyMember(member.id)}
                    className="text-slate-300 hover:text-rose-500 transition-colors text-xl ml-4"
                    title="Remove member"
                  >
                    &times;
                  </button>
                </div>

                {/* Relationships */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Relationships
                    </p>
                    <button
                      onClick={() => handleAddRelation(member.id)}
                      className="text-xs text-indigo-600 font-medium hover:underline"
                    >
                      + Add Relationship
                    </button>
                  </div>

                  {member.relations.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No relationships defined yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {member.relations.map((relation, relationIdx) => (
                        <div
                          key={relationIdx}
                          className="flex items-center gap-2 bg-slate-50 rounded-lg p-2"
                        >
                          <select
                            value={relation.type}
                            onChange={(e) =>
                              handleUpdateRelation(member.id, relationIdx, {
                                type: e.target.value as RelationType,
                              })
                            }
                            className="p-1.5 bg-white border border-slate-200 rounded text-xs outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="Parent">Parent</option>
                            <option value="Spouse">Spouse</option>
                            <option value="Child">Child</option>
                            <option value="Sibling">Sibling</option>
                            <option value="Friend">Friend</option>
                            <option value="Pet Owner">Pet Owner</option>
                            <option value="Pet">Pet</option>
                          </select>

                          <span className="text-xs text-slate-400">of</span>

                          <select
                            value={relation.toMemberId}
                            onChange={(e) =>
                              handleUpdateRelation(member.id, relationIdx, {
                                toMemberId: e.target.value,
                              })
                            }
                            className="flex-1 p-1.5 bg-white border border-slate-200 rounded text-xs outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="">Select a member…</option>
                            {familyTree
                              .filter((m) => m.id !== member.id)
                              .map((m) => (
                                <option key={m.id} value={m.id}>
                                  {treeDisplayName(m)}
                                  {m.memberType === 'pet' ? ' 🐾' : ''}
                                </option>
                              ))}
                          </select>

                          <button
                            onClick={() => handleRemoveRelation(member.id, relationIdx)}
                            className="text-slate-300 hover:text-rose-500 transition-colors text-lg"
                            title="Remove relationship"
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
