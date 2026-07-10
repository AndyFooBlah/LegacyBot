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
 * Tests for Gemini system instruction generation.
 *
 * buildSystemInstruction is a pure function — no API calls or side effects.
 * Tests verify that the instruction includes all required context and handles
 * edge cases (empty fields, special characters, large question sets).
 *
 * References: design.md §5.3 (Priority 1) | src/services/gemini.ts
 */

import { describe, it, expect } from 'vitest';
import { buildSystemInstruction, BuildInstructionOptions, buildTalkSystemInstruction, BuildTalkInstructionOptions } from '../../services/gemini';
import { Dossier, InterviewQuestion } from '../../types';
import { TalkContext } from '../../services/storage';

/** Minimal valid Dossier for testing. */
function makeDossier(overrides: Partial<Dossier> = {}): Dossier {
  return {
    storytellerUid: null,
    storytellerName: 'Margaret',
    storytellerContext: 'Grew up on a farm in Iowa.',
    historicalContext: 'Post-war rural America, 1950s.',
    familyTree: [{ id: 'member-1', name: 'Arthur', memberType: 'person', relations: [{ type: 'Parent', toMemberId: 'margaret' }] }],
    selectedVoice: 'Zephyr',
    personality: 'empathetic',
    interviewerNotes: '',
    createdAt: { toDate: () => new Date() } as any,
    updatedAt: { toDate: () => new Date() } as any,
    ...overrides,
  };
}

/** Minimal valid question for testing. */
function makeQuestion(overrides: Partial<InterviewQuestion> = {}): InterviewQuestion {
  return {
    id: 'q1',
    text: 'Tell me about your childhood.',
    status: 'Unasked',
    findings: '',
    order: 0,
    createdAt: { toDate: () => new Date() } as any,
    updatedAt: { toDate: () => new Date() } as any,
    ...overrides,
  };
}

/** Helper to build options with defaults for first session. */
function makeOptions(overrides: Partial<BuildInstructionOptions> = {}): BuildInstructionOptions {
  return {
    dossier: makeDossier(),
    questions: [],
    completedSessionCount: 0,
    ...overrides,
  };
}

describe('buildSystemInstruction', () => {
  it('includes the storyteller name in the instruction', () => {
    const instruction = buildSystemInstruction(makeOptions());
    expect(instruction).toContain('Margaret');
  });

  it('includes the personality traits for empathetic mode', () => {
    const instruction = buildSystemInstruction(makeOptions({ dossier: makeDossier({ personality: 'empathetic' }) }));
    expect(instruction).toContain('warm, attentive biographer');
  });

  it('includes the personality traits for investigative mode', () => {
    const instruction = buildSystemInstruction(makeOptions({ dossier: makeDossier({ personality: 'investigative' }) }));
    expect(instruction).toContain('oral historian');
  });

  it('includes the personality traits for casual mode', () => {
    const instruction = buildSystemInstruction(makeOptions({ dossier: makeDossier({ personality: 'casual' }) }));
    expect(instruction).toContain('curious, respectful grandchild');
  });

  it('includes family tree members', () => {
    const dossier = makeDossier({
      familyTree: [
        { id: 'member-1', name: 'Arthur', memberType: 'person', relations: [{ type: 'Parent', toMemberId: 'margaret' }] },
        { id: 'member-2', name: 'Eleanor', memberType: 'person', relations: [{ type: 'Parent', toMemberId: 'margaret' }] },
      ],
    });
    const instruction = buildSystemInstruction(makeOptions({ dossier }));
    expect(instruction).toContain('Arthur');
    expect(instruction).toContain('Eleanor');
    expect(instruction).toContain('Parent');
  });

  it('includes historical context', () => {
    const instruction = buildSystemInstruction(makeOptions());
    expect(instruction).toContain('Post-war rural America');
  });

  it('includes storyteller context when present', () => {
    const instruction = buildSystemInstruction(makeOptions());
    expect(instruction).toContain('Grew up on a farm in Iowa');
  });

  it('omits storyteller context line when empty', () => {
    const instruction = buildSystemInstruction(makeOptions({ dossier: makeDossier({ storytellerContext: '' }) }));
    expect(instruction).not.toContain('Storyteller Background:');
  });

  it('includes question text and status in the instruction', () => {
    const questions = [
      makeQuestion({ id: 'q1', text: 'Tell me about your childhood.', status: 'Unasked' }),
      makeQuestion({ id: 'q2', text: 'What was your first job?', status: 'InProgress', findings: 'Worked at a bakery' }),
    ];
    const instruction = buildSystemInstruction(makeOptions({ questions }));

    expect(instruction).toContain('Tell me about your childhood');
    expect(instruction).toContain('What was your first job');
    expect(instruction).toContain('Unasked');
    expect(instruction).toContain('InProgress');
    expect(instruction).toContain('Worked at a bakery');
  });

  it('handles an empty question list', () => {
    const instruction = buildSystemInstruction(makeOptions());
    expect(instruction).toContain('Story Queue: []');
  });

  it('handles special characters in storyteller name', () => {
    const dossier = makeDossier({ storytellerName: 'John "Johnny" O\'Brien' });
    const instruction = buildSystemInstruction(makeOptions({ dossier }));
    expect(instruction).toContain('John "Johnny" O\'Brien');
  });

  it('handles empty family tree', () => {
    const dossier = makeDossier({ familyTree: [] });
    const instruction = buildSystemInstruction(makeOptions({ dossier }));
    expect(instruction).toContain('Family Tree: []');
  });

  it('includes interviewing rules', () => {
    const instruction = buildSystemInstruction(makeOptions());
    expect(instruction).toContain('NEVER INTERRUPT');
    expect(instruction).toContain('HANDLE PAUSES');
    expect(instruction).toContain('MAP STORIES TO QUESTIONS');
    expect(instruction).toContain('updateQuestionStatus');
  });

  it('handles a large number of questions without crashing', () => {
    const questions = Array.from({ length: 50 }, (_, i) =>
      makeQuestion({ id: `q${i}`, text: `Question ${i}: Tell me about topic ${i}.` }),
    );
    const instruction = buildSystemInstruction(makeOptions({ questions }));

    expect(instruction.length).toBeGreaterThan(0);
    expect(instruction).toContain('Question 49');
  });

  it('does not throw with empty storyteller name', () => {
    const dossier = makeDossier({ storytellerName: '' });
    expect(() => buildSystemInstruction(makeOptions({ dossier }))).not.toThrow();
  });

  // --- New tests for #33 (first session intro), #38 (returning session recap) ---

  it('generates first session introduction for completedSessionCount=0', () => {
    const instruction = buildSystemInstruction(makeOptions({ completedSessionCount: 0 }));
    expect(instruction).toContain('MANDATORY START (FIRST SESSION)');
    expect(instruction).toContain('Hello Margaret');
    expect(instruction).toContain('Zephyr'); // bot is named after the voice preset
    expect(instruction).toContain('Your family asked me to help preserve your stories');
  });

  it('generates returning session recap for completedSessionCount>0', () => {
    const instruction = buildSystemInstruction(makeOptions({ completedSessionCount: 3 }));
    expect(instruction).toContain('MANDATORY START (RETURNING SESSION');
    expect(instruction).toContain('session #4');
    expect(instruction).toContain('spoken with you 3 times before');
    expect(instruction).not.toContain('FIRST SESSION');
  });

  it('includes previous session summary in returning session', () => {
    const instruction = buildSystemInstruction(makeOptions({
      completedSessionCount: 1,
      previousSessionSummary: 'Discussed childhood memories of the farm.',
    }));
    expect(instruction).toContain('Discussed childhood memories of the farm.');
  });

  it('includes recent findings in returning session recap', () => {
    const questions = [
      makeQuestion({ id: 'q1', text: 'Childhood?', status: 'Completed', findings: 'Grew up on a farm with 3 siblings' }),
      makeQuestion({ id: 'q2', text: 'First job?', status: 'InProgress', findings: 'Worked at the bakery downtown' }),
    ];
    const instruction = buildSystemInstruction(makeOptions({ questions, completedSessionCount: 2 }));
    expect(instruction).toContain('Grew up on a farm with 3 siblings');
    expect(instruction).toContain('Worked at the bakery downtown');
  });

  // --- New tests for #34 (admin interviewer notes) ---

  it('includes admin interviewer notes when present', () => {
    const dossier = makeDossier({ interviewerNotes: 'Margaret is hard of hearing. Speak clearly and slowly.' });
    const instruction = buildSystemInstruction(makeOptions({ dossier }));
    expect(instruction).toContain('ADDITIONAL GUIDANCE FROM THE FAMILY');
    expect(instruction).toContain('Margaret is hard of hearing');
    expect(instruction).toContain('people who know the storyteller personally');
  });

  it('omits admin notes section when interviewerNotes is empty', () => {
    const instruction = buildSystemInstruction(makeOptions({ dossier: makeDossier({ interviewerNotes: '' }) }));
    expect(instruction).not.toContain('ADDITIONAL GUIDANCE FROM THE FAMILY');
  });

  it('omits admin notes section when interviewerNotes is whitespace', () => {
    const instruction = buildSystemInstruction(makeOptions({ dossier: makeDossier({ interviewerNotes: '   ' }) }));
    expect(instruction).not.toContain('ADDITIONAL GUIDANCE FROM THE FAMILY');
  });

  // --- Emotional awareness ---

  it('includes emotional awareness section', () => {
    const instruction = buildSystemInstruction(makeOptions());
    expect(instruction).toContain('EMOTIONAL AWARENESS');
    expect(instruction).toContain('reportEmotionalObservation');
  });
});

// ---------------------------------------------------------------------------
// buildTalkSystemInstruction
// ---------------------------------------------------------------------------

function makeTalkContext(overrides: Partial<TalkContext> = {}): TalkContext {
  return {
    recentTranscripts: [],
    eventTitles: [],
    miscFactTexts: [],
    ...overrides,
  };
}

function makeTalkOptions(overrides: Partial<BuildTalkInstructionOptions> = {}): BuildTalkInstructionOptions {
  return {
    dossier: makeDossier(),
    talkContext: makeTalkContext(),
    ...overrides,
  };
}

describe('buildTalkSystemInstruction', () => {
  it('returns a non-empty string', () => {
    const instruction = buildTalkSystemInstruction(makeTalkOptions());
    expect(instruction.length).toBeGreaterThan(100);
  });

  it('addresses the storyteller by name', () => {
    const instruction = buildTalkSystemInstruction(makeTalkOptions({ dossier: makeDossier({ storytellerName: 'Margaret' }) }));
    expect(instruction).toContain('Margaret');
  });

  it('uses preferredName when provided', () => {
    const instruction = buildTalkSystemInstruction(makeTalkOptions({ preferredName: 'Maggie' }));
    expect(instruction).toContain('Maggie');
    expect(instruction).not.toContain('Margaret');
  });

  it('includes the recordFact tool reference', () => {
    const instruction = buildTalkSystemInstruction(makeTalkOptions());
    expect(instruction).toContain('recordFact');
  });

  it('includes the endTalk tool reference', () => {
    const instruction = buildTalkSystemInstruction(makeTalkOptions());
    expect(instruction).toContain('endTalk');
  });

  it('does not include interview-mode tools', () => {
    const instruction = buildTalkSystemInstruction(makeTalkOptions());
    expect(instruction).not.toContain('updateQuestionStatus');
    expect(instruction).not.toContain('Story Queue');
  });

  it('embeds storyteller biography', () => {
    const instruction = buildTalkSystemInstruction(makeTalkOptions({
      dossier: makeDossier({ storytellerContext: 'Grew up on a farm in Iowa.' }),
    }));
    expect(instruction).toContain('Grew up on a farm in Iowa.');
  });

  it('includes prior session transcripts', () => {
    const talkContext = makeTalkContext({
      recentTranscripts: [
        { sessionId: 'session-1', date: 'January 1, 2026', excerpt: 'Storyteller: We moved to Ohio in 1955.' },
      ],
    });
    const instruction = buildTalkSystemInstruction(makeTalkOptions({ talkContext }));
    expect(instruction).toContain('We moved to Ohio in 1955.');
    expect(instruction).toContain('January 1, 2026');
  });

  it('includes event titles', () => {
    const talkContext = makeTalkContext({
      eventTitles: ['Marriage of Ralph and Margaret', 'Birth of Arthur'],
    });
    const instruction = buildTalkSystemInstruction(makeTalkOptions({ talkContext }));
    expect(instruction).toContain('Marriage of Ralph and Margaret');
    expect(instruction).toContain('Birth of Arthur');
  });

  it('includes previously recorded misc facts', () => {
    const talkContext = makeTalkContext({
      miscFactTexts: ['Father worked at the mill until 1962.'],
    });
    const instruction = buildTalkSystemInstruction(makeTalkOptions({ talkContext }));
    expect(instruction).toContain('Father worked at the mill until 1962.');
  });

  it('handles no prior context gracefully', () => {
    const instruction = buildTalkSystemInstruction(makeTalkOptions({
      talkContext: makeTalkContext(),
    }));
    expect(instruction).toContain('No previous sessions');
    expect(instruction).toContain('No events recorded');
  });

  it('instructs to note corrections with isCorrection', () => {
    const instruction = buildTalkSystemInstruction(makeTalkOptions());
    expect(instruction).toContain('isCorrection');
  });

  it('discourages prompting the user to keep talking', () => {
    const instruction = buildTalkSystemInstruction(makeTalkOptions());
    expect(instruction).toContain('Do NOT prompt');
  });
});
