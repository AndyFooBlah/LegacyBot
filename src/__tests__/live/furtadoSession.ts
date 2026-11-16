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
 * The interview session's real Live inputs, built for the fictional Furtado
 * family (evals/family). Shared by the offline config tests and the live
 * conformance suite, so both check what production would send for a dossier:
 * the real instruction builder, the real tool declarations, the real voice
 * and turn-taking options.
 *
 * Nothing here comes from a real family. The fixture is invented and is
 * scanned against production names (evals/family/README.md). Do not paste
 * real stories into this file.
 */

import type { FunctionDeclaration } from '@google/genai';
import type { Timestamp } from 'firebase/firestore';
import { buildDocs, loadSessions } from '../../../evals/family/seed';
import { buildSessionInstruction } from '../../services/gemini';
import {
  buildGreetingTrigger,
  buildSessionLiveOptions,
  buildSessionTools,
} from '../../services/liveSession';
import type { SessionLiveOptions, TurnMode } from '../../services/liveSession';
import type { Dossier, FamilyMember, InterviewQuestion, PromptPhoto } from '../../types';

export const TEO_DOSSIER_ID = 'fx-dossier-teo';

/** A fixed clock, so the instruction is the same on every run. */
export const FIXTURE_NOW = new Date('2026-11-15T18:00:00Z');
const FIXTURE_DATE_TIME = 'Sunday, November 15, 2026 at 10:00 AM PST';

export interface FurtadoDossier {
  dossier: Dossier;
  questions: InterviewQuestion[];
  familyTree: FamilyMember[];
}

/** The dossier, story queue and family tree exactly as evals/family/seed.ts would write them. */
export function loadFurtadoDossier(dossierId: string = TEO_DOSSIER_ID): FurtadoDossier {
  const docs = buildDocs((d) => d as unknown as Timestamp);
  const base = `/dossiers/${dossierId}`;
  const dossierDoc = docs.find((d) => d.path.endsWith(base));
  if (!dossierDoc) throw new Error(`fixture dossier ${dossierId} not found`);
  const dossier = { ...(dossierDoc.data as unknown as Dossier), id: dossierId };
  const questions = docs
    .filter((d) => d.path.includes(`${base}/questions/`))
    .map((d) => ({ ...(d.data as unknown as InterviewQuestion), id: d.path.split('/').pop() }));
  return { dossier, questions, familyTree: dossier.familyTree };
}

/** Everything the storytellers say across the fixture sessions, as one text. */
function storytellerWords(): string {
  return loadSessions()
    .flatMap((s) => s.entries.filter((e) => e.role === 'user').map((e) => e.text))
    .join(' ');
}

export type InstructionVariant =
  /** A first session: short profile, empty findings, the first-session greeting. */
  | 'first-session'
  /** A returning session with findings and a previous-session summary. */
  | 'returning'
  /**
   * The largest instruction production builds: a returning session for a
   * dossier whose family pasted a long biography and which has no rolling
   * profile summary yet, so the full biography is inlined, plus prompt photos.
   */
  | 'returning-full-biography';

export interface FurtadoSessionInputs extends FurtadoDossier {
  variant: InstructionVariant;
  systemInstruction: string;
  /** The opening cue `useUnifiedSession` passes to `startSession`. */
  greetingTrigger: string;
  tools: FunctionDeclaration[];
  liveOptions: SessionLiveOptions;
  completedSessionCount: number;
  promptPhotos: PromptPhoto[];
}

export interface FurtadoSessionOverrides {
  /** Override the dossier's own `responseWaitSeconds`. */
  responseWaitSeconds?: number | null;
  turnMode?: TurnMode;
}

/**
 * Build the inputs `useUnifiedSession` would hand VoiceCommon for Teo's
 * dossier, using the production builders.
 */
export function buildFurtadoSessionInputs(
  variant: InstructionVariant = 'returning',
  overrides: FurtadoSessionOverrides = {},
): FurtadoSessionInputs {
  const loaded = loadFurtadoDossier();
  const stamp = FIXTURE_NOW as unknown as Timestamp;
  let dossier: Dossier = { ...loaded.dossier };
  if (overrides.responseWaitSeconds === null) delete dossier.responseWaitSeconds;
  else if (overrides.responseWaitSeconds !== undefined) dossier.responseWaitSeconds = overrides.responseWaitSeconds;

  let questions = loaded.questions;
  let completedSessionCount = 0;
  let previousSessionSummary: string | undefined;
  let lastSessionDate: Date | undefined;
  let recentSessionDates: Date[] = [];
  let promptPhotos: PromptPhoto[] = [];

  if (variant !== 'first-session') {
    const sessions = loadSessions().filter((s) => s.dossierId === TEO_DOSSIER_ID);
    completedSessionCount = sessions.length;
    recentSessionDates = sessions.map((s) => new Date(s.startTime));
    lastSessionDate = recentSessionDates[recentSessionDates.length - 1];
    previousSessionSummary = sessions.map((s) => s.title).join('; ');
    // Findings as the interviewer would have recorded them: the storyteller's
    // own first answer in the session that covered the topic.
    questions = loaded.questions.map((q, i) => ({
      ...q,
      findings:
        q.status === 'Unasked'
          ? ''
          : (sessions[i % sessions.length].entries.find((e) => e.role === 'user')?.text ?? '').slice(0, 400),
    }));
  }

  if (variant === 'returning-full-biography') {
    dossier = {
      ...dossier,
      profileSummary: undefined,
      storytellerContext: `${dossier.storytellerContext}\n\nIn the family's own words: ${storytellerWords()}`,
    };
    promptPhotos = [
      { id: 'fx-photo-1', storageUrl: 'https://photos.example/fx-photo-1.jpg', caption: 'The house in Capelo before the volcano. Who is standing by the door?', uploadedBy: 'fx-marisa', createdAt: stamp },
      { id: 'fx-photo-2', storageUrl: 'https://photos.example/fx-photo-2.jpg', caption: 'The boat at the dock in New Bedford. What year was this?', uploadedBy: 'fx-marisa', createdAt: stamp },
    ];
  }

  const systemInstruction = buildSessionInstruction({
    dossier,
    questions,
    familyTree: loaded.familyTree,
    promptPhotos,
    completedSessionCount,
    previousSessionSummary,
    lastSessionDate,
    preferredName: dossier.preferredName,
    currentDateTime: FIXTURE_DATE_TIME,
    recentSessionDates,
  });

  return {
    variant,
    dossier,
    questions,
    familyTree: loaded.familyTree,
    systemInstruction,
    greetingTrigger: buildGreetingTrigger(completedSessionCount, dossier.storytellerName),
    tools: buildSessionTools(promptPhotos.length > 0),
    liveOptions: buildSessionLiveOptions(dossier, overrides.turnMode),
    completedSessionCount,
    promptPhotos,
  };
}
