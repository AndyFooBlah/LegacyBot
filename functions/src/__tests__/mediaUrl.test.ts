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
import { parseMediaPathFamilyId, isSessionAudioPath, sessionAudioPath } from '../mediaPath';

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

describe('isSessionAudioPath (#166)', () => {
  const ok = isSessionAudioPath;
  it('accepts exactly the canonical {familyId}/{dossierId}/{sessionId}.webm path', () => {
    expect(sessionAudioPath('fam1', 'dosA', 'sess9')).toBe('fam1/dosA/sess9.webm');
    expect(ok('fam1/dosA/sess9.webm', 'fam1', 'dosA', 'sess9')).toBe(true);
  });

  it('rejects another family or dossier prefix', () => {
    expect(ok('fam2/dosA/sess9.webm', 'fam1', 'dosA', 'sess9')).toBe(false);
    expect(ok('fam1/dosB/sess9.webm', 'fam1', 'dosA', 'sess9')).toBe(false);
  });

  it('rejects other objects under the right prefix (other sessions, clips, media)', () => {
    expect(ok('fam1/dosA/other.webm', 'fam1', 'dosA', 'sess9')).toBe(false);
    expect(ok('fam1/dosA/clips/sess9.webm', 'fam1', 'dosA', 'sess9')).toBe(false);
    expect(ok('fam1/dosA/sess9.webm/../x.webm', 'fam1', 'dosA', 'sess9')).toBe(false);
  });

  it('rejects non-string, empty, absolute and traversal values', () => {
    expect(ok(undefined, 'fam1', 'dosA', 'sess9')).toBe(false);
    expect(ok(null, 'fam1', 'dosA', 'sess9')).toBe(false);
    expect(ok('', 'fam1', 'dosA', 'sess9')).toBe(false);
    expect(ok('/fam1/dosA/sess9.webm', 'fam1', 'dosA', 'sess9')).toBe(false);
    expect(ok('fam1/../fam2/dosA/sess9.webm', 'fam1', 'dosA', 'sess9')).toBe(false);
  });
});
