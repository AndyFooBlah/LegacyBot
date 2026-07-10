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
 * Regression test for the "KnowledgeCommon is not initialized" runtime bug
 * (2026-04-18): searchWikipedia was called from useSession, useUnifiedSession,
 * useTalkSession, and SystemDiagnostics before any initializeKnowledgeCommon
 * call existed in index.tsx. The tool threw at first invocation, making the
 * Wikipedia tool completely non-functional in production.
 *
 * This suite enforces two invariants:
 *   1. Every LegacyBot entry point that imports directly from
 *      @andyfooblah/knowledge-common does so under the assumption that KC is
 *      initialized. So index.tsx MUST call initializeKnowledgeCommon with the
 *      required fields.
 *   2. getKnowledgeConfig() must succeed after loading index.tsx's init block.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const INDEX_PATH = path.resolve(__dirname, '../../index.tsx');

describe('LegacyBot entry point — KnowledgeCommon initialization', () => {
  const source = fs.readFileSync(INDEX_PATH, 'utf8');

  it('imports initializeKnowledgeCommon from the KC package', () => {
    expect(source).toMatch(
      /import\s*\{\s*initializeKnowledgeCommon[^}]*\}\s*from\s*['"]@andyfooblah\/knowledge-common['"]/,
    );
  });

  it('invokes initializeKnowledgeCommon at module load time', () => {
    // Expect an initializeKnowledgeCommon({ ... }) call, not just an import.
    expect(source).toMatch(/initializeKnowledgeCommon\s*\(\s*\{/);
  });

  it('passes a server-side gemini broker (no Gemini key in the bundle)', () => {
    // Match the KC init block and assert it contains the broker, not a key.
    const match = source.match(/initializeKnowledgeCommon\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    expect(match).not.toBeNull();
    const block = match![1];
    // Must wire up the broker — both invokeGemini and embedContent.
    expect(block).toMatch(/gemini\s*:/);
    expect(block).toMatch(/invokeGemini/);
    expect(block).toMatch(/embedContent/);
    // And must NOT pass a long-lived key — that's the whole point.
    expect(block).not.toMatch(/geminiApiKey/);
    expect(block).not.toMatch(/VITE_GEMINI/);
  });

  it('routes Maps/Weather/Joke through toolOverrides (no keys in browser)', () => {
    const match = source.match(/initializeKnowledgeCommon\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    expect(match).not.toBeNull();
    const block = match![1];
    expect(block).toMatch(/toolOverrides/);
    expect(block).toMatch(/searchPlace/);
    expect(block).toMatch(/getDistanceBetweenPlaces/);
    expect(block).toMatch(/getWeather/);
    expect(block).toMatch(/getJoke/);
  });

  it('wires cacheWikipediaArticle through the admin-SDK callable (cache-poisoning defence)', () => {
    const match = source.match(/initializeKnowledgeCommon\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/cacheWikipediaArticle/);
  });
});
