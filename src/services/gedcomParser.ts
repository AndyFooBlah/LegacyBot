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
 * GEDCOM parser for LegacyBot.
 *
 * Parses GEDCOM 5.5/5.5.1 files (the standard export format from Ancestry.com,
 * FamilySearch, MyHeritage, etc.) into our FamilyMember[] format.
 *
 * GEDCOM structure:
 *   0 @I1@ INDI         — Individual record
 *   1 NAME John /Smith/  — Name (surname delimited by slashes)
 *   1 SEX M              — Sex
 *   1 BIRT               — Birth event
 *   2 DATE 1 JAN 1920    — Date sub-record
 *   2 PLAC New York       — Place sub-record
 *   1 FAMC @F1@          — Family as child (links to FAM record)
 *   1 FAMS @F2@          — Family as spouse
 *   0 @F1@ FAM           — Family record
 *   1 HUSB @I1@          — Husband
 *   1 WIFE @I2@          — Wife
 *   1 CHIL @I3@          — Child
 *
 * References: GEDCOM 5.5.1 spec (gedcom.io)
 */

import { FamilyMember } from '../types';

interface GedcomIndividual {
  id: string;
  name: string;
  sex: string;
  birthDate: string;
  birthPlace: string;
  deathDate: string;
  familiesAsChild: string[]; // FAM IDs where this person is a child
  familiesAsSpouse: string[]; // FAM IDs where this person is a spouse
}

interface GedcomFamily {
  id: string;
  husband: string | null;
  wife: string | null;
  children: string[];
}

interface GedcomLine {
  level: number;
  xref: string | null; // e.g. @I1@
  tag: string;
  value: string;
}

function parseLine(line: string): GedcomLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // GEDCOM line format: LEVEL [XREF] TAG [VALUE]
  // Examples:
  //   0 @I1@ INDI
  //   1 NAME John /Smith/
  //   2 DATE 1 JAN 1920
  const match = trimmed.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s+(.*))?$/);
  if (!match) return null;

  return {
    level: parseInt(match[1], 10),
    xref: match[2] || null,
    tag: match[3],
    value: match[4]?.trim() ?? '',
  };
}

/** Parse a GEDCOM name like "John /Smith/" into "John Smith" */
function cleanName(gedcomName: string): string {
  return gedcomName.replace(/\//g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse a GEDCOM file string into individual and family records.
 */
function parseGedcom(text: string): { individuals: Map<string, GedcomIndividual>; families: Map<string, GedcomFamily> } {
  const lines = text.split(/\r?\n/).map(parseLine).filter((l): l is GedcomLine => l !== null);

  const individuals = new Map<string, GedcomIndividual>();
  const families = new Map<string, GedcomFamily>();

  let currentIndi: GedcomIndividual | null = null;
  let currentFam: GedcomFamily | null = null;
  let currentSubTag = ''; // Track level-1 context (BIRT, DEAT, etc.)

  for (const line of lines) {
    if (line.level === 0) {
      // Save previous record
      if (currentIndi) individuals.set(currentIndi.id, currentIndi);
      if (currentFam) families.set(currentFam.id, currentFam);
      currentIndi = null;
      currentFam = null;
      currentSubTag = '';

      if (line.tag === 'INDI' && line.xref) {
        currentIndi = {
          id: line.xref,
          name: '',
          sex: '',
          birthDate: '',
          birthPlace: '',
          deathDate: '',
          familiesAsChild: [],
          familiesAsSpouse: [],
        };
      } else if (line.tag === 'FAM' && line.xref) {
        currentFam = {
          id: line.xref,
          husband: null,
          wife: null,
          children: [],
        };
      }
    } else if (line.level === 1) {
      currentSubTag = line.tag;

      if (currentIndi) {
        switch (line.tag) {
          case 'NAME':
            if (!currentIndi.name) currentIndi.name = cleanName(line.value);
            break;
          case 'SEX':
            currentIndi.sex = line.value;
            break;
          case 'FAMC':
            currentIndi.familiesAsChild.push(line.value);
            break;
          case 'FAMS':
            currentIndi.familiesAsSpouse.push(line.value);
            break;
        }
      }

      if (currentFam) {
        switch (line.tag) {
          case 'HUSB':
            currentFam.husband = line.value;
            break;
          case 'WIFE':
            currentFam.wife = line.value;
            break;
          case 'CHIL':
            currentFam.children.push(line.value);
            break;
        }
      }
    } else if (line.level === 2 && currentIndi) {
      if (currentSubTag === 'BIRT') {
        if (line.tag === 'DATE') currentIndi.birthDate = line.value;
        if (line.tag === 'PLAC') currentIndi.birthPlace = line.value;
      } else if (currentSubTag === 'DEAT') {
        if (line.tag === 'DATE') currentIndi.deathDate = line.value;
      }
    }
  }

  // Save last record
  if (currentIndi) individuals.set(currentIndi.id, currentIndi);
  if (currentFam) families.set(currentFam.id, currentFam);

  return { individuals, families };
}

/**
 * Determine the relationship label of a person relative to a root individual.
 */
function determineRelation(
  personId: string,
  rootId: string,
  individuals: Map<string, GedcomIndividual>,
  families: Map<string, GedcomFamily>,
): string {
  const person = individuals.get(personId);
  if (!person) return 'Relative';

  // Find the root's family as a child (parents' family)
  const root = individuals.get(rootId)!;
  const rootParentFamilies = root.familiesAsChild;
  const rootSpouseFamilies = root.familiesAsSpouse;

  // Check if person is in root's parent family
  for (const famId of rootParentFamilies) {
    const fam = families.get(famId);
    if (!fam) continue;

    if (fam.husband === personId) return person.sex === 'M' ? 'Father' : 'Parent';
    if (fam.wife === personId) return person.sex === 'F' ? 'Mother' : 'Parent';
    if (fam.children.includes(personId) && personId !== rootId) {
      return person.sex === 'M' ? 'Brother' : person.sex === 'F' ? 'Sister' : 'Sibling';
    }
  }

  // Check if person is root's spouse or child
  for (const famId of rootSpouseFamilies) {
    const fam = families.get(famId);
    if (!fam) continue;

    if (fam.husband === personId || fam.wife === personId) {
      return person.sex === 'M' ? 'Husband' : person.sex === 'F' ? 'Wife' : 'Spouse';
    }
    if (fam.children.includes(personId)) {
      return person.sex === 'M' ? 'Son' : person.sex === 'F' ? 'Daughter' : 'Child';
    }
  }

  // Check grandparent relationships (parents of parents)
  for (const famId of rootParentFamilies) {
    const fam = families.get(famId);
    if (!fam) continue;

    for (const parentId of [fam.husband, fam.wife].filter(Boolean) as string[]) {
      const parent = individuals.get(parentId);
      if (!parent) continue;

      for (const gpFamId of parent.familiesAsChild) {
        const gpFam = families.get(gpFamId);
        if (!gpFam) continue;

        if (gpFam.husband === personId || gpFam.wife === personId) {
          return person.sex === 'M' ? 'Grandfather' : person.sex === 'F' ? 'Grandmother' : 'Grandparent';
        }
      }
    }
  }

  // Check grandchildren
  for (const famId of rootSpouseFamilies) {
    const fam = families.get(famId);
    if (!fam) continue;

    for (const childId of fam.children) {
      const child = individuals.get(childId);
      if (!child) continue;

      for (const gcFamId of child.familiesAsSpouse) {
        const gcFam = families.get(gcFamId);
        if (!gcFam) continue;

        if (gcFam.children.includes(personId)) {
          return person.sex === 'M' ? 'Grandson' : person.sex === 'F' ? 'Granddaughter' : 'Grandchild';
        }

        // Also check children's spouses
        if (gcFam.husband === personId || gcFam.wife === personId) {
          return person.sex === 'M' ? 'Son-in-law' : person.sex === 'F' ? 'Daughter-in-law' : 'Child-in-law';
        }
      }
    }
  }

  // Check aunts/uncles (siblings of parents)
  for (const famId of rootParentFamilies) {
    const fam = families.get(famId);
    if (!fam) continue;

    for (const parentId of [fam.husband, fam.wife].filter(Boolean) as string[]) {
      const parent = individuals.get(parentId);
      if (!parent) continue;

      for (const parentFamId of parent.familiesAsChild) {
        const parentFam = families.get(parentFamId);
        if (!parentFam) continue;

        if (parentFam.children.includes(personId) && personId !== parentId) {
          return person.sex === 'M' ? 'Uncle' : person.sex === 'F' ? 'Aunt' : 'Aunt/Uncle';
        }
      }
    }
  }

  return 'Relative';
}

export interface GedcomImportResult {
  /** All individuals found in the GEDCOM file */
  individuals: { id: string; name: string; birthDate: string; birthPlace: string }[];
  /** Total count of individuals */
  totalCount: number;
}

/**
 * Preview a GEDCOM file — returns a list of individuals for the user to select
 * the root person (the storyteller).
 */
export function previewGedcom(fileContent: string): GedcomImportResult {
  const { individuals } = parseGedcom(fileContent);

  const list = Array.from(individuals.values()).map((indi) => ({
    id: indi.id,
    name: indi.name,
    birthDate: indi.birthDate,
    birthPlace: indi.birthPlace,
  }));

  // Sort by name for easy browsing
  list.sort((a, b) => a.name.localeCompare(b.name));

  return { individuals: list, totalCount: list.length };
}

/**
 * Import a GEDCOM file and convert to FamilyMember[] relative to a root person.
 *
 * @param fileContent - Raw GEDCOM file text
 * @param rootId - The GEDCOM ID of the storyteller (e.g. "@I1@")
 * @returns FamilyMember[] with relationship labels relative to the root
 *
 * Note: This returns members in the new relational model format (Phase 2).
 * Each member has an ID and empty relations array - relationships need to be
 * added manually by the user in the UI.
 */
export function importGedcom(fileContent: string, rootId: string): FamilyMember[] {
  const { individuals, families } = parseGedcom(fileContent);

  const members: FamilyMember[] = [];
  let idCounter = 0;

  for (const [id, indi] of individuals) {
    if (id === rootId) continue; // Skip the root person (they are the storyteller)

    const relation = determineRelation(id, rootId, individuals, families);
    const notes: string[] = [];
    notes.push(`GEDCOM relation: ${relation}`);
    if (indi.birthDate) notes.push(`Born: ${indi.birthDate}`);
    if (indi.birthPlace) notes.push(indi.birthPlace);
    if (indi.deathDate) notes.push(`Died: ${indi.deathDate}`);

    members.push({
      id: `gedcom-${idCounter++}`,
      name: indi.name || 'Unknown',
      memberType: 'person',
      relations: [], // Relations need to be added manually in the new relational model
      notes: notes.length > 0 ? notes.join('. ') : undefined,
    });
  }

  // Sort by relationship priority (based on old relation string in notes)
  const relationOrder: Record<string, number> = {
    'Spouse': 0, 'Husband': 0, 'Wife': 0,
    'Father': 1, 'Mother': 1, 'Parent': 1,
    'Son': 2, 'Daughter': 2, 'Child': 2,
    'Brother': 3, 'Sister': 3, 'Sibling': 3,
    'Grandfather': 4, 'Grandmother': 4, 'Grandparent': 4,
    'Grandson': 5, 'Granddaughter': 5, 'Grandchild': 5,
    'Uncle': 6, 'Aunt': 6, 'Aunt/Uncle': 6,
    'Son-in-law': 7, 'Daughter-in-law': 7, 'Child-in-law': 7,
  };

  members.sort((a, b) => {
    const relationA = a.notes?.match(/GEDCOM relation: (\w+)/)?.[1] || '';
    const relationB = b.notes?.match(/GEDCOM relation: (\w+)/)?.[1] || '';
    const orderA = relationOrder[relationA] ?? 99;
    const orderB = relationOrder[relationB] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });

  return members;
}
