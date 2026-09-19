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
 * Deterministic groundedness eval — no model calls, no LLM judge, no corpus.
 *
 * Both of the app's generative outputs cite their sources, so fabrication is
 * directly checkable against the transcripts they came from:
 *
 *   - StoryEvent.sources[].entryIndices must index real transcript entries
 *   - Memoir ChapterCitation.quote must appear verbatim in the cited entry
 *
 * A failure here means the model invented a citation, which is the single
 * worst failure mode for a memoir someone's family will keep.
 *
 * Prints counts only. It deliberately never echoes transcript text, because
 * this is real family content about named living people.
 *
 * Baseline recorded 2026-09-19, while generation still ran on
 * gemini-3.1-pro-preview: 206/206 event indices resolved, 83/83 memoir quotes
 * verbatim, across 66 events and 11 chapters. Re-run after new memoirs are
 * generated on gemini-3.8-flash to detect a regression from that switch.
 *
 * Usage:
 *   GOOGLE_CLOUD_QUOTA_PROJECT=legacybot-4814e npx tsx evals/groundedness.ts
 *
 * Exits non-zero if any citation fails to resolve, so it can gate a release.
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = process.env.GCLOUD_PROJECT ?? 'legacybot-4814e';

interface Entry { text?: string; cleanText?: string }

const normalize = (t: string): string =>
  t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

async function main(): Promise<void> {
  initializeApp({ projectId: PROJECT });
  const db = getFirestore();

  const ev = { events: 0, noSources: 0, resolved: 0, badIndex: 0, sessionGone: 0 };
  const ch = { chapters: 0, quotes: 0, verbatim: 0, notFound: 0, badIndex: 0 };

  for (const family of (await db.collection('families').get()).docs) {
    for (const dossier of (await family.ref.collection('dossiers').get()).docs) {
      const cache = new Map<string, Entry[] | null>();
      const transcript = async (sessionId: string): Promise<Entry[] | null> => {
        if (cache.has(sessionId)) return cache.get(sessionId)!;
        const doc = await dossier.ref
          .collection('sessions').doc(sessionId)
          .collection('transcript').doc('entries').get();
        const entries = doc.exists ? ((doc.data()?.entries as Entry[]) ?? []) : null;
        cache.set(sessionId, entries);
        return entries;
      };

      for (const eventDoc of (await dossier.ref.collection('events').get()).docs) {
        ev.events++;
        const sources = (eventDoc.data().sources ?? []) as
          { sessionId: string; entryIndices?: number[] }[];
        if (sources.length === 0) { ev.noSources++; continue; }
        for (const source of sources) {
          const entries = await transcript(source.sessionId);
          if (!entries) { ev.sessionGone++; continue; }
          for (const i of source.entryIndices ?? []) {
            if (i < 0 || i >= entries.length || typeof entries[i]?.text !== 'string') ev.badIndex++;
            else ev.resolved++;
          }
        }
      }

      for (const memoir of (await dossier.ref.collection('memoirs').get()).docs) {
        const chapters = (memoir.data().chapters ?? []) as
          { citations?: { sessionId: string; entryIndex: number; quote?: string }[] }[];
        for (const chapter of chapters) {
          ch.chapters++;
          for (const citation of chapter.citations ?? []) {
            ch.quotes++;
            const entries = await transcript(citation.sessionId);
            if (!entries || citation.entryIndex < 0 || citation.entryIndex >= entries.length) {
              ch.badIndex++; continue;
            }
            const entry = entries[citation.entryIndex];
            const haystack = normalize(`${entry.text ?? ''} ${entry.cleanText ?? ''}`);
            if (haystack.includes(normalize(citation.quote ?? ''))) ch.verbatim++;
            else ch.notFound++;
          }
        }
      }
    }
  }

  console.log('EVENT CITATIONS');
  console.log(`  events: ${ev.events} | with no sources: ${ev.noSources}`);
  console.log(`  indices resolved: ${ev.resolved} | out of range: ${ev.badIndex} | session gone: ${ev.sessionGone}`);
  console.log('MEMOIR CHAPTER CITATIONS');
  console.log(`  chapters: ${ch.chapters} | citations: ${ch.quotes}`);
  console.log(`  verbatim in cited entry: ${ch.verbatim} | NOT found: ${ch.notFound} | bad index: ${ch.badIndex}`);

  const failures = ev.badIndex + ev.sessionGone + ch.notFound + ch.badIndex;
  console.log(failures === 0 ? '\nPASS — every citation resolves' : `\nFAIL — ${failures} unresolved citation(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
