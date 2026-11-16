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
 * Guard: the Gemini Live model id lives in exactly one place.
 *
 * Scans every source file under src/, functions/src/, scripts/, evals/ and
 * e2e/ (tests included) for Gemini model ids and fails, with file and line,
 * when it finds:
 *   - a Live model id anywhere but the constant file (src/services/gemini.ts),
 *     so no code path can carry its own copy of the model;
 *   - a Live model id VoiceCommon's registry marks legacy or shut down,
 *     unless the line carries the marker `model-history:` (a comment about
 *     the past);
 *   - something that looks like a Live model id that the registry does not
 *     know, so an unverified id cannot slip in.
 * Non-Live models (Flash, embeddings, TTS) are not this guard's business.
 *
 * It also pins the constant itself: LIVE_MODEL must be a model the registry
 * marks current. When the provider retires it and VoiceCommon's registry is
 * updated, this test fails on the dependency bump, which is the prompt to
 * move (verify against the provider docs, then `npm run test:live`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { LIVE_MODELS, getLiveModelInfo, resolveThinkingConfig } from '@andyfooblah/voice-common';
import { LIVE_MODEL, LIVE_THINKING_LEVEL } from '../services/gemini';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(HERE, '..', '..');

/** The one file allowed to spell a Live model id. */
const CONSTANT_FILE = 'src/services/gemini.ts';
/** This file needs example ids to test its own classifier. */
const SELF = 'src/__tests__/liveModelGuard.test.ts';

const HISTORY_MARKER = 'model-history:';
const MODEL_ID = /\bgemini-(?:\d|live-)[a-z0-9.-]*/g;
/** How a Live model id is recognised when the registry has not heard of it. */
const LOOKS_LIVE = /(?:^|-)live(?:-|$)|native-audio/;

type Finding = { file: string; line: number; id: string; problem: string };

function classify(file: string, lineNumber: number, lineText: string): Finding[] {
  const findings: Finding[] = [];
  for (const match of lineText.matchAll(MODEL_ID)) {
    const id = match[0].replace(/[.-]+$/, '');
    const info = getLiveModelInfo(id);
    if (!info && !LOOKS_LIVE.test(id)) continue; // not a Live model
    const history = lineText.includes(HISTORY_MARKER);
    if (!info) {
      findings.push({ file, line: lineNumber, id, problem: 'looks like a Live model id but is not in the VoiceCommon registry: verify it against the provider docs' });
    } else if (info.status !== 'current' && !history) {
      findings.push({ file, line: lineNumber, id, problem: `${info.status} Live model (replacement: ${info.replacement ?? 'see the registry'})` });
    } else if (file !== CONSTANT_FILE && !history) {
      findings.push({ file, line: lineNumber, id, problem: `Live model id outside ${CONSTANT_FILE}: import LIVE_MODEL instead` });
    }
  }
  return findings;
}

function* sourceFiles(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'lib', 'audio'].includes(entry.name)) continue;
      yield* sourceFiles(full);
    } else if (/\.(ts|tsx|js|mjs|cjs|json)$/.test(entry.name)) {
      yield full;
    }
  }
}

function scan(): { findings: Finding[]; filesScanned: number } {
  const findings: Finding[] = [];
  let filesScanned = 0;
  for (const top of ['src', path.join('functions', 'src'), 'scripts', 'evals', 'e2e']) {
    for (const full of sourceFiles(path.join(ROOT, top))) {
      const file = path.relative(ROOT, full).split(path.sep).join('/');
      if (file === SELF) continue;
      filesScanned += 1;
      fs.readFileSync(full, 'utf8')
        .split('\n')
        .forEach((text, i) => findings.push(...classify(file, i + 1, text)));
    }
  }
  return { findings, filesScanned };
}

describe('the Live model constant', () => {
  it('is a model the VoiceCommon registry marks current', () => {
    const info = getLiveModelInfo(LIVE_MODEL);
    expect(info, `${LIVE_MODEL} is not in the VoiceCommon Live registry`).toBeTruthy();
    expect(info!.status).toBe('current');
    expect(info!.shutdown).toBeNull();
  });

  it('resolves to a thinking config the model accepts', () => {
    // Throws LiveConfigError for a combination the registry knows is rejected.
    const thinking = resolveThinkingConfig(LIVE_MODEL, LIVE_THINKING_LEVEL);
    const support = getLiveModelInfo(LIVE_MODEL)!.thinking.support;
    if (support === 'rejected') expect(thinking).toBeUndefined();
    if (support === 'required') expect(thinking?.thinkingLevel).toBeTruthy();
  });

  it('is declared exactly once in the constant file', () => {
    const source = fs.readFileSync(path.join(ROOT, CONSTANT_FILE), 'utf8');
    const declarations = [...source.matchAll(/export const LIVE_MODEL = '([^']+)'/g)];
    expect(declarations).toHaveLength(1);
    expect(declarations[0][1]).toBe(LIVE_MODEL);
  });
});

describe('no stray or retired Live model ids in the source', () => {
  it('finds none outside the constant file', () => {
    const { findings } = scan();
    const report = findings.map((f) => `${f.file}:${f.line}  ${f.id}  ${f.problem}`).join('\n');
    expect(report).toBe('');
  });

  it('really scans the tree, including functions/ (it is not vacuously green)', () => {
    const { filesScanned } = scan();
    expect(filesScanned).toBeGreaterThan(100);
    const files = [...sourceFiles(path.join(ROOT, 'functions', 'src'))].map((f) => path.basename(f));
    expect(files).toContain('liveToken.ts');
    // The scanner's pattern sees the constant where it is declared.
    const constantFile = fs.readFileSync(path.join(ROOT, CONSTANT_FILE), 'utf8');
    const seen = new Set([...constantFile.matchAll(MODEL_ID)].map((m) => m[0].replace(/[.-]+$/, '')));
    expect(seen).toContain(LIVE_MODEL);
  });

  it('flags a current Live id written outside the constant file', () => {
    const id = Object.values(LIVE_MODELS).find((m) => m.status === 'current')!.id;
    expect(classify('src/hooks/useUnifiedSession.ts', 7, `liveModel: '${id}',`)).toEqual([
      { file: 'src/hooks/useUnifiedSession.ts', line: 7, id, problem: `Live model id outside ${CONSTANT_FILE}: import LIVE_MODEL instead` },
    ]);
    expect(classify(CONSTANT_FILE, 7, `export const LIVE_MODEL = '${id}';`)).toEqual([]);
  });

  it('flags legacy and shut-down ids everywhere, the constant file included', () => {
    expect(classify(CONSTANT_FILE, 1, "export const LIVE_MODEL = 'gemini-3.1-flash-live-preview';")[0].problem).toMatch(/^legacy Live model/);
    expect(classify('functions/src/liveToken.ts', 1, "model: 'gemini-2.0-flash-live-001'")[0].problem).toMatch(/^shutdown Live model/);
    expect(classify('src/a.ts', 1, "'gemini-2.5-flash-native-audio-preview-12-2025'")[0].problem).toMatch(/^legacy Live model/);
  });

  it('flags a Live-looking id the registry has never heard of', () => {
    expect(classify('src/a.ts', 1, "'gemini-9.9-live'")[0].problem).toMatch(/not in the VoiceCommon registry/);
    expect(classify('src/a.ts', 1, "'gemini-live-9.9-flash'")[0].problem).toMatch(/not in the VoiceCommon registry/);
  });

  it('allows marked history lines and ignores non-Live models', () => {
    expect(classify('src/a.ts', 1, '// model-history: sessions ran on gemini-3.1-flash-live-preview until 2026-09-19')).toEqual([]);
    expect(classify('functions/src/models.ts', 1, "export const REASONING_MODEL = 'gemini-3.8-flash';")).toEqual([]);
    expect(classify('functions/src/embeddings.ts', 1, "const EMBEDDING_MODEL = 'gemini-embedding-001';")).toEqual([]);
    expect(classify('evals/family/generate-audio.ts', 1, "const TTS_MODEL = 'gemini-3.8-flash-tts';")).toEqual([]);
  });
});
