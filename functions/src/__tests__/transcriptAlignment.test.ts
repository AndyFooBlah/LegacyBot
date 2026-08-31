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
import {
  alignRefinedToEntries,
  AI_REFINEMENT_MARKER,
  type AlignEntry,
  type RefinedUtterance,
} from '../transcriptAlignment';

const T0 = 1_000_000; // arbitrary epoch ms for the first entry

/** Build an entry whose timestamp is `sec` seconds after T0. */
function entry(role: AlignEntry['role'], text: string, sec: number, extra: Partial<AlignEntry> = {}): AlignEntry {
  return {
    role,
    text,
    timestamp: { toMillis: () => T0 + sec * 1000 },
    ...extra,
  };
}

const EDITED_AT = { marker: 'ts' };

describe('alignRefinedToEntries', () => {
  it('replaces text 1:1 for a clean conversation, preserving originals', () => {
    const entries: AlignEntry[] = [
      entry('bot', 'Hi Andy its me Zephyr', 0),
      entry('user', 'i grew up on a farm', 5),
      entry('bot', 'what was that like', 12),
    ];
    const refined: RefinedUtterance[] = [
      { speaker: 'model', startTime: 0, endTime: 4, text: "Hi Andy, it's me, Zephyr." },
      { speaker: 'user', startTime: 5, endTime: 10, text: 'I grew up on a farm.' },
      { speaker: 'model', startTime: 12, endTime: 15, text: 'What was that like?' },
    ];

    const { entries: out, replacedCount } = alignRefinedToEntries(entries, refined, EDITED_AT);

    expect(replacedCount).toBe(3);
    expect(out[0].text).toBe("Hi Andy, it's me, Zephyr.");
    expect(out[1].text).toBe('I grew up on a farm.');
    expect(out[2].text).toBe('What was that like?');
    // Originals preserved
    expect(out[0].originalText).toBe('Hi Andy its me Zephyr');
    expect(out[1].editHistory?.[0]).toMatchObject({
      text: 'i grew up on a farm',
      editedBy: AI_REFINEMENT_MARKER,
      editedAt: EDITED_AT,
    });
  });

  it('merges multiple refined utterances that fall in one entry window', () => {
    const entries: AlignEntry[] = [
      entry('user', 'raw long answer', 0),
      entry('bot', 'ok', 20),
    ];
    const refined: RefinedUtterance[] = [
      { speaker: 'user', startTime: 1, endTime: 6, text: 'First part.' },
      { speaker: 'user', startTime: 7, endTime: 14, text: 'Second part.' },
      { speaker: 'model', startTime: 20, endTime: 22, text: 'Okay.' },
    ];

    const { entries: out } = alignRefinedToEntries(entries, refined, EDITED_AT);
    expect(out[0].text).toBe('First part. Second part.');
    expect(out[1].text).toBe('Okay.');
  });

  it('leaves an entry untouched when no refined utterance matches its window', () => {
    const entries: AlignEntry[] = [
      entry('bot', 'greeting', 0),
      entry('user', 'unheard mumble', 5),
      entry('bot', 'closing', 300), // far past any refined audio
    ];
    const refined: RefinedUtterance[] = [
      { speaker: 'model', startTime: 0, endTime: 3, text: 'Greeting refined.' },
      { speaker: 'user', startTime: 5, endTime: 9, text: 'Unheard mumble refined.' },
    ];

    const { entries: out, replacedCount } = alignRefinedToEntries(entries, refined, EDITED_AT);
    expect(replacedCount).toBe(2);
    expect(out[2].text).toBe('closing'); // untouched, no editHistory added
    expect(out[2].editHistory).toBeUndefined();
  });

  it('never touches tool entries', () => {
    const entries: AlignEntry[] = [
      entry('user', 'tell me', 0),
      entry('tool', '[searchContext]', 3, { toolName: 'searchContext' }),
      entry('bot', 'here', 6),
    ];
    const refined: RefinedUtterance[] = [
      { speaker: 'user', startTime: 0, endTime: 2, text: 'Tell me.' },
      { speaker: 'model', startTime: 6, endTime: 8, text: 'Here.' },
    ];

    const { entries: out } = alignRefinedToEntries(entries, refined, EDITED_AT);
    expect(out[1].text).toBe('[searchContext]');
    expect(out[1].role).toBe('tool');
    expect(out[0].text).toBe('Tell me.');
    expect(out[2].text).toBe('Here.');
  });

  it('does not match a refined utterance to a differently-roled entry', () => {
    const entries: AlignEntry[] = [
      entry('bot', 'bot line', 0),
      entry('user', 'user line', 5),
    ];
    // Only a user utterance in the bot's window — must not overwrite the bot entry.
    const refined: RefinedUtterance[] = [
      { speaker: 'user', startTime: 1, endTime: 3, text: 'Actually a user talking.' },
    ];

    const { entries: out } = alignRefinedToEntries(entries, refined, EDITED_AT);
    expect(out[0].text).toBe('bot line'); // unchanged — role mismatch
    expect(out[1].text).toBe('Actually a user talking.'); // nearest same-role entry
  });

  it('is a no-op when refined text equals the existing text', () => {
    const entries: AlignEntry[] = [entry('user', 'Already perfect.', 0)];
    const refined: RefinedUtterance[] = [
      { speaker: 'user', startTime: 0, endTime: 2, text: 'Already perfect.' },
    ];
    const { entries: out, replacedCount } = alignRefinedToEntries(entries, refined, EDITED_AT);
    expect(replacedCount).toBe(0);
    expect(out[0].editHistory).toBeUndefined();
  });

  it('returns entries unchanged when there are no refined utterances', () => {
    const entries: AlignEntry[] = [entry('user', 'x', 0)];
    const { entries: out, replacedCount } = alignRefinedToEntries(entries, [], EDITED_AT);
    expect(replacedCount).toBe(0);
    expect(out).toBe(entries);
  });

  it('appends to existing editHistory rather than clobbering it', () => {
    const entries: AlignEntry[] = [
      entry('user', 'v2 text', 0, {
        originalText: 'v0 text',
        editHistory: [{ text: 'v0 text', editedBy: 'uid-123', editedByName: 'Human', editedAt: {} }],
      }),
    ];
    const refined: RefinedUtterance[] = [
      { speaker: 'user', startTime: 0, endTime: 2, text: 'v3 refined text.' },
    ];
    const { entries: out } = alignRefinedToEntries(entries, refined, EDITED_AT);
    expect(out[0].text).toBe('v3 refined text.');
    // originalText was already set — must not be overwritten
    expect(out[0].originalText).toBe('v0 text');
    expect(out[0].editHistory).toHaveLength(2);
    expect(out[0].editHistory?.[1].editedBy).toBe(AI_REFINEMENT_MARKER);
  });
});
