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
 * Builds a PRIVATE denylist of personal identifiers from the real production
 * data, so that `scan.ts` can prove nothing committed to this public repo
 * (fixtures, docs, code comments) names a real family member or a place from
 * a real story.
 *
 * The denylist is itself personal data. It is written OUTSIDE the repo, mode
 * 0600, and must never be committed, pasted into an issue, or printed. This
 * script prints counts only.
 *
 *   tier1  names and emails from structured fields (accounts, members,
 *          dossiers, family trees, event people). A match is a hard failure.
 *   tier2  proper nouns from free text (transcripts, events, memoirs, notes):
 *          capitalised words that are not ordinary dictionary words. A match
 *          fails unless the word is on the generic allowlist in scan.ts.
 *
 * The owner's own name is excluded: it is the one name allowed in public.
 *
 * Usage:
 *   GOOGLE_CLOUD_QUOTA_PROJECT=legacybot-4814e npx tsx evals/pii/build-denylist.ts
 *   (optional) PII_DENYLIST=/some/path.json to change the output location
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

const PROJECT = process.env.GCLOUD_PROJECT ?? 'legacybot-4814e';
export const DEFAULT_DENYLIST = join(homedir(), '.config', 'biographybot', 'pii-denylist.json');
const OUT = process.env.PII_DENYLIST ?? DEFAULT_DENYLIST;

/** The owner's name and handles are public by decision; never deny them. */
const OWNER_TOKENS = new Set(['andrew', 'andy', 'brook', 'andybrook', 'fooblah', 'andyfooblah']);

/**
 * Kinship terms and placeholders that people type into name fields ("Mother",
 * "Unknown", "Cat"). They are not identifiers. Written without reference to
 * the corpus, so the list reveals nothing about it.
 */
const NOT_NAMES = new Set(`
unknown none name test tbd nobody someone anonymous
father mother dad mom mama papa parent parents
grandfather grandmother grandpa grandma grandparent granddad granny nana
greatgrandfather greatgrandmother great
son daughter child children kid kids baby twin twins
brother sister sibling siblings
uncle aunt auntie cousin nephew niece
husband wife spouse partner fiance fiancee widow widower
stepfather stepmother stepson stepdaughter stepbrother stepsister
godfather godmother godson goddaughter
friend neighbor neighbour boss teacher doctor pastor priest
cat dog pet bird horse fish bot the and family
`.split(/\s+/).filter(Boolean));

/** Synthetic families that live in production for monitoring are not PII. */
const SYNTHETIC_FAMILY_MARKER = 'syntheticFixture';

const tier1 = new Set<string>();
const tier2 = new Set<string>();
const emails = new Set<string>();

const dict = new Set<string>();
if (existsSync('/usr/share/dict/words')) {
  for (const w of readFileSync('/usr/share/dict/words', 'utf8').split('\n')) {
    if (w && w === w.toLowerCase()) dict.add(w);
  }
}

const words = (s: string): string[] => s.normalize('NFC').match(/[\p{L}][\p{L}'’-]*/gu) ?? [];

function addName(value: unknown): void {
  if (typeof value !== 'string') return;
  // Display-name fields sometimes hold an email address; treat it as one
  // rather than shredding it into "gmail" and "com".
  if (value.includes('@')) { addEmail(value); return; }
  const tokens = words(value).map((w) => w.toLowerCase()).filter((w) => w.length >= 3 && !OWNER_TOKENS.has(w) && !NOT_NAMES.has(w));
  for (const t of tokens) tier1.add(t);
  if (tokens.length > 1) tier1.add(tokens.join(' '));
}

function addEmail(value: unknown): void {
  if (typeof value !== 'string' || !value.includes('@')) return;
  const e = value.trim().toLowerCase();
  const local = e.split('@')[0];
  if ([...OWNER_TOKENS].some((o) => local === o || local.startsWith(o))) {
    // Owner's own addresses: public by decision. Relatives who share the
    // surname are still caught by their first names in tier1.
    if (local === 'andybrook' || local === 'andy' || local.startsWith('andrew')) return;
  }
  emails.add(e);
}

/** Capitalised words that are not sentence-initial and not ordinary words. */
function addProperNouns(value: unknown): void {
  if (typeof value !== 'string') return;
  for (const sentence of value.split(/(?<=[.!?…])\s+|\n+/)) {
    const ws = words(sentence);
    ws.forEach((w, i) => {
      if (i === 0) return; // sentence-initial capital carries no signal
      if (!/^\p{Lu}/u.test(w)) return;
      const lower = w.toLowerCase();
      // Contractions ("I'll", "That's", "We'd") are not proper nouns: judge
      // them by the part before the apostrophe.
      const base = lower.split(/['’]/)[0];
      if (base.length < 3 || OWNER_TOKENS.has(lower) || dict.has(lower) || dict.has(base)) return;
      tier2.add(lower);
    });
  }
}

async function main(): Promise<void> {
  initializeApp({ projectId: PROJECT });
  const db = getFirestore();
  let docsRead = 0;
  let skippedSynthetic = 0;

  for (const u of (await db.collection('users').get()).docs) {
    docsRead++;
    const d = u.data();
    if (d[SYNTHETIC_FAMILY_MARKER]) continue;
    addEmail(d.email);
    addName(d.displayName);
  }

  for (const family of (await db.collection('families').get()).docs) {
    const fd = family.data();
    if (fd[SYNTHETIC_FAMILY_MARKER]) { skippedSynthetic++; continue; }
    docsRead++;
    for (const m of (fd.familyTree ?? []) as Record<string, unknown>[]) {
      addName(m.name); addName(m.firstName); addName(m.lastName); addProperNouns(m.notes);
    }
    for (const m of (await family.ref.collection('members').get()).docs) {
      docsRead++; addEmail(m.data().email); addName(m.data().displayName);
    }
    for (const e of (await family.ref.collection('events').get()).docs) {
      docsRead++; addProperNouns(e.data().title); addProperNouns(e.data().description);
    }
    for (const dossier of (await family.ref.collection('dossiers').get()).docs) {
      docsRead++;
      const dd = dossier.data();
      addName(dd.storytellerName); addName(dd.preferredName); addEmail(dd.inviteEmail);
      for (const f of ['storytellerContext', 'historicalContext', 'interviewerNotes', 'profileSummary']) addProperNouns(dd[f]);
      for (const m of (dd.familyTree ?? []) as Record<string, unknown>[]) {
        addName(m.name); addName(m.firstName); addName(m.lastName); addProperNouns(m.notes);
      }
      for (const q of (await dossier.ref.collection('questions').get()).docs) {
        docsRead++; addProperNouns(q.data().text); addProperNouns(q.data().findings);
      }
      for (const e of (await dossier.ref.collection('events').get()).docs) {
        docsRead++;
        const ed = e.data();
        addProperNouns(ed.title); addProperNouns(ed.description);
        for (const p of (ed.people ?? []) as unknown[]) addName(p);
        if (typeof ed.location === 'string') { addProperNouns(`x ${ed.location}`); }
      }
      for (const m of (await dossier.ref.collection('memoirs').get()).docs) {
        docsRead++;
        addProperNouns(m.data().title);
        for (const c of (m.data().chapters ?? []) as Record<string, unknown>[]) {
          addProperNouns(c.title); addProperNouns(c.content);
        }
      }
      for (const f of (await dossier.ref.collection('miscFacts').get()).docs) {
        docsRead++; addProperNouns(f.data().text); addName(f.data().speakerLabel);
      }
      for (const m of (await dossier.ref.collection('media').get()).docs) {
        docsRead++; addProperNouns(m.data().caption); addProperNouns(m.data().title);
      }
      for (const s of (await dossier.ref.collection('sessions').get()).docs) {
        docsRead++;
        const t = await s.ref.collection('transcript').doc('entries').get();
        if (!t.exists) continue;
        for (const key of ['entries', 'editedEntries']) {
          for (const e of (t.data()?.[key] ?? []) as Record<string, unknown>[]) {
            addProperNouns(e.text); addProperNouns(e.cleanText); addName(e.speakerLabel);
          }
        }
      }
    }
  }

  for (const t of tier1) tier2.delete(t);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    builtAt: new Date().toISOString(),
    project: PROJECT,
    tier1: [...tier1].sort(),
    emails: [...emails].sort(),
    tier2: [...tier2].sort(),
  }), { mode: 0o600 });
  chmodSync(OUT, 0o600);

  // Counts only. Never print entries.
  console.log(`documents read: ${docsRead} (synthetic families skipped: ${skippedSynthetic})`);
  console.log(`tier1 names: ${tier1.size} | emails: ${emails.size} | tier2 proper nouns: ${tier2.size}`);
  console.log(`written to ${OUT} (mode 0600) — private, do not commit`);
  process.exit(0);
}

void main();
