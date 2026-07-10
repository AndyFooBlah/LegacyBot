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
 * Tests for the GEDCOM parser.
 */

import { describe, it, expect } from 'vitest';
import { previewGedcom, importGedcom } from '../../services/gedcomParser';

const SAMPLE_GEDCOM = `
0 HEAD
1 SOUR Ancestry.com Family Trees
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Margaret /Johnson/
1 SEX F
1 BIRT
2 DATE 15 MAR 1935
2 PLAC Portland, Oregon
1 FAMC @F1@
1 FAMS @F2@
0 @I2@ INDI
1 NAME Robert /Johnson/
1 SEX M
1 BIRT
2 DATE 10 JUN 1908
1 DEAT
2 DATE 22 NOV 1980
1 FAMS @F1@
0 @I3@ INDI
1 NAME Mary /Smith/
1 SEX F
1 BIRT
2 DATE 5 APR 1912
1 FAMS @F1@
0 @I4@ INDI
1 NAME David /Williams/
1 SEX M
1 BIRT
2 DATE 1 JAN 1932
1 FAMS @F2@
0 @I5@ INDI
1 NAME Sarah /Williams/
1 SEX F
1 BIRT
2 DATE 20 SEP 1960
1 FAMC @F2@
0 @I6@ INDI
1 NAME James /Williams/
1 SEX M
1 BIRT
2 DATE 3 FEB 1963
1 FAMC @F2@
0 @I7@ INDI
1 NAME Thomas /Johnson/
1 SEX M
1 BIRT
2 DATE 12 AUG 1938
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I3@
1 CHIL @I1@
1 CHIL @I7@
0 @F2@ FAM
1 HUSB @I4@
1 WIFE @I1@
1 CHIL @I5@
1 CHIL @I6@
0 TRLR
`.trim();

describe('previewGedcom', () => {
  it('returns all individuals', () => {
    const result = previewGedcom(SAMPLE_GEDCOM);
    expect(result.totalCount).toBe(7);
  });

  it('parses names correctly', () => {
    const result = previewGedcom(SAMPLE_GEDCOM);
    const names = result.individuals.map((i) => i.name);
    expect(names).toContain('Margaret Johnson');
    expect(names).toContain('Robert Johnson');
    expect(names).toContain('David Williams');
  });

  it('parses birth dates', () => {
    const result = previewGedcom(SAMPLE_GEDCOM);
    const margaret = result.individuals.find((i) => i.name === 'Margaret Johnson');
    expect(margaret?.birthDate).toBe('15 MAR 1935');
  });

  it('parses birth places', () => {
    const result = previewGedcom(SAMPLE_GEDCOM);
    const margaret = result.individuals.find((i) => i.name === 'Margaret Johnson');
    expect(margaret?.birthPlace).toBe('Portland, Oregon');
  });

  it('sorts by name', () => {
    const result = previewGedcom(SAMPLE_GEDCOM);
    const names = result.individuals.map((i) => i.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

describe('importGedcom', () => {
  it('excludes the root person', () => {
    const members = importGedcom(SAMPLE_GEDCOM, '@I1@');
    const names = members.map((m) => m.name);
    expect(names).not.toContain('Margaret Johnson');
  });

  it('identifies parents correctly', () => {
    const members = importGedcom(SAMPLE_GEDCOM, '@I1@');
    const father = members.find((m) => m.name === 'Robert Johnson');
    expect(father?.notes).toContain('GEDCOM relation: Father');
    const mother = members.find((m) => m.name === 'Mary Smith');
    expect(mother?.notes).toContain('GEDCOM relation: Mother');
  });

  it('identifies spouse correctly', () => {
    const members = importGedcom(SAMPLE_GEDCOM, '@I1@');
    const husband = members.find((m) => m.name === 'David Williams');
    expect(husband?.notes).toContain('GEDCOM relation: Husband');
  });

  it('identifies children correctly', () => {
    const members = importGedcom(SAMPLE_GEDCOM, '@I1@');
    const daughter = members.find((m) => m.name === 'Sarah Williams');
    expect(daughter?.notes).toContain('GEDCOM relation: Daughter');
    const son = members.find((m) => m.name === 'James Williams');
    expect(son?.notes).toContain('GEDCOM relation: Son');
  });

  it('identifies siblings correctly', () => {
    const members = importGedcom(SAMPLE_GEDCOM, '@I1@');
    const brother = members.find((m) => m.name === 'Thomas Johnson');
    expect(brother?.notes).toContain('GEDCOM relation: Brother');
  });

  it('includes birth/death info in notes', () => {
    const members = importGedcom(SAMPLE_GEDCOM, '@I1@');
    const father = members.find((m) => m.name === 'Robert Johnson');
    expect(father?.notes).toContain('Born: 10 JUN 1908');
    expect(father?.notes).toContain('Died: 22 NOV 1980');
  });

  it('sorts by relationship priority', () => {
    const members = importGedcom(SAMPLE_GEDCOM, '@I1@');
    const relations = members.map((m) => m.notes?.match(/GEDCOM relation: (\w+)/)?.[1] || '');
    const husbandIdx = relations.indexOf('Husband');
    const fatherIdx = relations.indexOf('Father');
    const daughterIdx = relations.indexOf('Daughter');
    const brotherIdx = relations.indexOf('Brother');

    // Spouse before parents before children before siblings
    expect(husbandIdx).toBeLessThan(fatherIdx);
    expect(fatherIdx).toBeLessThan(daughterIdx);
    expect(daughterIdx).toBeLessThan(brotherIdx);
  });

  it('returns all non-root members', () => {
    const members = importGedcom(SAMPLE_GEDCOM, '@I1@');
    expect(members).toHaveLength(6);
  });
});
