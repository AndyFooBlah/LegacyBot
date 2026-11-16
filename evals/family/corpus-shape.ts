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
 * Measures the SHAPE of interview transcripts — turn lengths, speaking ratio,
 * disfluency, tool use — without reading out any content. Used to check that
 * the synthetic test family talks like real storytellers do.
 *
 *   npx tsx evals/family/corpus-shape.ts --real          # production Firestore, numbers only
 *   npx tsx evals/family/corpus-shape.ts --fixture       # evals/family/sessions/*.json
 *
 * The real-corpus mode prints aggregates only: counts, means, percentiles.
 * No word, name or sentence from a real session is ever printed, and it must
 * stay that way (see JOURNAL.md, 2026-10-18 consent decision).
 */

import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

interface Entry { role: string; text?: string }
interface Session { entries: Entry[]; durationSeconds: number }

const FILLERS = /\b(um+|uh+|er+|ah+|hmm+|you know|i mean|well,|let me think|let's see)\b/gi;
const wc = (s: string) => (s.trim().match(/\S+/g) ?? []).length;
const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function shape(sessions: Session[]) {
  const userLens: number[] = [], botLens: number[] = [], ratios: number[] = [], turnsPerMin: number[] = [];
  let userWords = 0, fillers = 0, tools = 0, turns = 0, noPunct = 0, userTurns = 0, questionsFromBot = 0, botTurns = 0;
  for (const s of sessions) {
    let u = 0, b = 0, n = 0;
    for (const e of s.entries) {
      const t = e.text ?? '';
      if (e.role === 'tool') { tools++; continue; }
      const w = wc(t); if (!w) continue;
      n++; turns++;
      if (e.role === 'user') { userLens.push(w); u += w; userTurns++; userWords += w; fillers += (t.match(FILLERS) ?? []).length; if (!/[.!?]/.test(t)) noPunct++; }
      else { botLens.push(w); b += w; botTurns++; if (t.includes('?')) questionsFromBot++; }
    }
    if (u + b > 0) ratios.push(u / (u + b));
    if (s.durationSeconds > 0) turnsPerMin.push(n / (s.durationSeconds / 60));
  }
  return {
    sessions: sessions.length,
    turnsPerSession_median: pct(sessions.map((s) => s.entries.filter((e) => e.role !== 'tool').length), 0.5),
    user_words_per_turn: { mean: +mean(userLens).toFixed(1), p10: pct(userLens, 0.1), p50: pct(userLens, 0.5), p90: pct(userLens, 0.9), max: Math.max(0, ...userLens) },
    bot_words_per_turn: { mean: +mean(botLens).toFixed(1), p50: pct(botLens, 0.5), p90: pct(botLens, 0.9) },
    storyteller_speaking_ratio: { mean: +mean(ratios).toFixed(2), p10: +pct(ratios, 0.1).toFixed(2), p90: +pct(ratios, 0.9).toFixed(2) },
    user_turns_5_words_or_fewer: +(userLens.filter((x) => x <= 5).length / Math.max(1, userLens.length)).toFixed(2),
    fillers_per_100_user_words: +((fillers / Math.max(1, userWords)) * 100).toFixed(2),
    user_turns_without_punctuation: +(noPunct / Math.max(1, userTurns)).toFixed(2),
    bot_turns_with_question: +(questionsFromBot / Math.max(1, botTurns)).toFixed(2),
    tool_entries_per_session: +(tools / Math.max(1, sessions.length)).toFixed(2),
    turns_per_minute_median: +pct(turnsPerMin, 0.5).toFixed(1),
  };
}

async function real(): Promise<Session[]> {
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'legacybot-4814e' });
  const db = getFirestore();
  const out: Session[] = [];
  for (const f of (await db.collection('families').get()).docs) {
    if (f.data().syntheticFixture) continue;
    for (const d of (await f.ref.collection('dossiers').get()).docs) {
      for (const s of (await d.ref.collection('sessions').get()).docs) {
        if (s.data().status !== 'completed') continue;
        const t = await s.ref.collection('transcript').doc('entries').get();
        const entries = (t.data()?.entries ?? []) as Entry[];
        if (entries.length) out.push({ entries, durationSeconds: s.data().durationSeconds ?? 0 });
      }
    }
  }
  return out;
}

function fixture(): Session[] {
  const dir = join(HERE, 'sessions');
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    return { entries: j.entries, durationSeconds: j.durationSeconds };
  });
}

async function main() {
  const mode = process.argv.includes('--real') ? 'real' : 'fixture';
  const sessions = mode === 'real' ? await real() : fixture();
  const all = shape(sessions);
  const long = shape(sessions.filter((s) => s.durationSeconds >= 300));
  console.log(JSON.stringify({ mode, all, sessions_5min_or_longer: long }, null, 2));
  process.exit(0);
}
if (process.argv[1]?.endsWith('corpus-shape.ts')) void main();
