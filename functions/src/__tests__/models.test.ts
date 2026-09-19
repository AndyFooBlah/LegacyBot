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
 * functions/ cannot import from src/, so REASONING_MODEL is declared twice.
 * This test reads the frontend copy off disk and asserts the two agree, so a
 * one-sided edit fails CI instead of silently splitting the app across two
 * models.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { REASONING_MODEL } from '../models';

describe('REASONING_MODEL', () => {
  it('matches the frontend copy in src/services/gemini.ts', () => {
    const frontend = readFileSync(
      join(__dirname, '../../../src/services/gemini.ts'),
      'utf8',
    );
    const match = frontend.match(
      /export const REASONING_MODEL = '([^']+)'/,
    );
    expect(match, 'REASONING_MODEL not found in src/services/gemini.ts').toBeTruthy();
    expect(match![1]).toBe(REASONING_MODEL);
  });

  it('is not a preview model', () => {
    // The batch path deliberately runs a stable release; a preview here would
    // violate the model-preference rule and can 404 without warning.
    expect(REASONING_MODEL).not.toMatch(/preview|exp/);
  });
});
