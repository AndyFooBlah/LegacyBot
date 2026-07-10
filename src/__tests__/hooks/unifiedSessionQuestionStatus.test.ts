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
 * Structural regression test for the updateQuestionStatus tool guard.
 *
 * The Gemini interviewer occasionally invents Story Queue question IDs. Before
 * the guard, an invented ID flowed through onQuestionUpdate → updateQuestion →
 * Firestore updateDoc() on a non-existent document, throwing
 * `FirebaseError: No document to update` as an uncaught promise rejection, and
 * separately created a phantom question doc via setDoc(..., { merge: true }).
 *
 * The fix validates the incoming id against the loaded story queue
 * (`questionsRef.current`) inside the tool handler and, for unknown ids,
 * returns an informative string to the model instead of writing.
 *
 * A full functional test of onToolCall would need the heavy VoiceCommon harness
 * (see unifiedSessionEndSession.test.ts for the same rationale), so we lint the
 * source to lock the guard in place. The functional no-op behavior of the
 * shared write path is covered in useDossier.test.ts.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE_PATH = path.resolve(__dirname, '../../hooks/useUnifiedSession.ts');

describe('useUnifiedSession — updateQuestionStatus unknown-id guard', () => {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');

  // Isolate the updateQuestionStatus case body.
  const caseMatch = source.match(
    /case 'updateQuestionStatus':\s*\{([\s\S]*?)\n {6}\}/,
  );

  it('has an updateQuestionStatus tool handler', () => {
    expect(caseMatch).not.toBeNull();
  });

  it('validates the id against the loaded story queue before writing', () => {
    const body = caseMatch![1];
    // Must check membership in questionsRef.current...
    expect(body).toMatch(/questionsRef\.current[\s\S]*\.some\s*\(/);
    // ...and the guard must precede the write calls (early return on unknown id).
    const guardIdx = body.search(/questionsRef\.current/);
    const updateIdx = body.search(/updateQuestionStateInFirestore/);
    const callbackIdx = body.search(/onQuestionUpdateRef\.current/);
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(guardIdx).toBeLessThan(updateIdx);
    expect(guardIdx).toBeLessThan(callbackIdx);
  });

  it('returns an informative result to the model for an unknown id', () => {
    const body = caseMatch![1];
    // The unknown-id branch returns a string mentioning the id and telling the
    // model not to invent ids, rather than a bare 'ok'.
    expect(body).toMatch(/return\s+`No Story Queue question exists with id/);
    expect(body).toMatch(/do not invent ids/i);
  });
});
