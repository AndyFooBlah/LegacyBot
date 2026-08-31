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
 * Pure alignment of a refined (offline-STT) transcript onto the existing
 * real-time transcript entries for a session (#123).
 *
 * Design constraints:
 *  - KEEP the existing entry boundaries (count + order). Downstream artifacts
 *    (events' sourceEntryIds, memoir references) address entries positionally,
 *    so we replace each entry's *text* rather than re-segmenting.
 *  - Never lose the original: the prior text is pushed into editHistory and
 *    mirrored into originalText (set once), tagged with AI_REFINEMENT_MARKER.
 *  - Non-destructive on ambiguity: an entry with no confident refined match is
 *    left exactly as-is.
 *
 * Alignment is by time window, measured RELATIVE TO THE FIRST CONTENT ENTRY
 * (not the session doc's startTime) so it is robust to any offset between when
 * the session document was created and when audio recording actually began.
 * Each refined utterance is assigned to the same-role entry whose [start,next)
 * window contains the utterance's midpoint, falling back to the nearest
 * same-role entry within ALIGN_TOLERANCE_SEC. Refined text for an entry is the
 * space-joined text of the utterances assigned to it.
 *
 * This module is intentionally free of firebase-admin so it is trivially unit
 * testable; the caller passes the `editedAt` value to stamp into editHistory.
 */

/** Sentinel `editedBy` value marking an AI-refinement edit (vs a real uid). */
export const AI_REFINEMENT_MARKER = 'ai-refinement';

/** Max seconds a refined utterance midpoint may sit outside an entry's window
 *  and still be assigned to it. Beyond this the utterance is dropped (the entry
 *  keeps its original text) rather than risk a wrong assignment. */
export const ALIGN_TOLERANCE_SEC = 30;

export interface RefinedUtterance {
  /** Speaker as emitted by the refinement model. */
  speaker: 'user' | 'model';
  /** Audio-relative start/end in seconds. */
  startTime: number;
  endTime: number;
  text: string;
}

/** Minimal structural view of a stored TranscriptEntry that alignment touches.
 *  Unknown fields are preserved via the index signature. */
export interface AlignEntry {
  role: 'user' | 'bot' | 'tool';
  text: string;
  timestamp: { toMillis(): number };
  originalText?: string;
  editHistory?: Array<{
    text: string;
    editedBy: string;
    editedByName?: string;
    editedAt: unknown;
  }>;
  [key: string]: unknown;
}

export interface AlignResult {
  entries: AlignEntry[];
  /** How many entries had their text replaced. */
  replacedCount: number;
}

/** Map a refinement speaker label to a stored entry role. */
function speakerToRole(speaker: 'user' | 'model'): 'user' | 'bot' {
  return speaker === 'model' ? 'bot' : 'user';
}

/**
 * Align refined utterances onto existing entries, returning a new entries array
 * (existing array is not mutated). `editedAt` is stamped into each new
 * editHistory row (pass a Firestore Timestamp in production; any value in tests).
 */
export function alignRefinedToEntries(
  entries: AlignEntry[],
  refined: RefinedUtterance[],
  editedAt: unknown,
): AlignResult {
  const firstContent = entries.findIndex((e) => e.role !== 'tool');
  if (firstContent === -1 || refined.length === 0) {
    return { entries, replacedCount: 0 };
  }

  const zeroMs = entries[firstContent].timestamp.toMillis();
  const offsetSec = entries.map((e) => (e.timestamp.toMillis() - zeroMs) / 1000);

  // Collect the refined text assigned to each entry index.
  const buckets: string[][] = entries.map(() => []);

  for (const utt of refined) {
    const mid = (utt.startTime + utt.endTime) / 2;
    const wantRole = speakerToRole(utt.speaker);

    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].role !== wantRole) continue;
      const start = offsetSec[i];
      const end = i + 1 < entries.length ? offsetSec[i + 1] : Infinity;
      if (mid >= start && mid < end) {
        bestIdx = i;
        bestDist = 0;
        break;
      }
      const distToWindow =
        mid < start ? start - mid : end === Infinity ? Infinity : mid - end;
      if (distToWindow < bestDist) {
        bestDist = distToWindow;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestDist <= ALIGN_TOLERANCE_SEC) {
      const t = utt.text.trim();
      if (t) buckets[bestIdx].push(t);
    }
  }

  let replacedCount = 0;
  const out = entries.map((entry, i) => {
    if (entry.role === 'tool') return entry;
    const refinedText = buckets[i].join(' ').replace(/\s+/g, ' ').trim();
    if (!refinedText || refinedText === entry.text.trim()) return entry;

    replacedCount++;
    const prior = entry.text;
    return {
      ...entry,
      text: refinedText,
      originalText: entry.originalText ?? prior,
      editHistory: [
        ...(entry.editHistory ?? []),
        {
          text: prior,
          editedBy: AI_REFINEMENT_MARKER,
          editedByName: 'AI Refinement',
          editedAt,
        },
      ],
    };
  });

  return { entries: out, replacedCount };
}
