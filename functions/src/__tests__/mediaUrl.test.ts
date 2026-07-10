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

import { describe, it, expect } from 'vitest';
import { parseMediaPathFamilyId } from '../mediaPath';

describe('parseMediaPathFamilyId', () => {
  it('returns the familyId (first segment) for a valid media path', () => {
    expect(parseMediaPathFamilyId('fam1/dossierA/session123.webm')).toBe('fam1');
    expect(parseMediaPathFamilyId('fam1/dossierA/media/photo_1')).toBe('fam1');
  });

  it('rejects empty / non-string paths', () => {
    expect(() => parseMediaPathFamilyId('')).toThrow(/path is required/);
    expect(() => parseMediaPathFamilyId(undefined)).toThrow(/path is required/);
    expect(() => parseMediaPathFamilyId(42)).toThrow(/path is required/);
  });

  it('rejects traversal and absolute paths', () => {
    expect(() => parseMediaPathFamilyId('/fam1/d/x')).toThrow(/Invalid path/);
    expect(() => parseMediaPathFamilyId('fam1/../fam2/d/x')).toThrow(/Invalid path/);
    expect(() => parseMediaPathFamilyId('fam1//d/x')).toThrow(/Invalid path/);
  });

  it('rejects paths shallower than familyId/dossierId/name', () => {
    expect(() => parseMediaPathFamilyId('fam1/onlytwo')).toThrow(/Invalid media path/);
    expect(() => parseMediaPathFamilyId('fam1')).toThrow(/Invalid media path/);
  });
});
