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
 * The interview session's Gemini Live settings, in one pure module.
 *
 * `useUnifiedSession` spreads `buildSessionLiveOptions()` into VoiceCommon's
 * `useSession` and passes `buildSessionTools()` as its tools. The offline
 * tests and the live conformance suite (`npm run test:live`) import the same
 * functions, so what they check is what a real session sends.
 *
 * PURE: no React, DOM or Firebase. Only `@google/genai` enums/types, the
 * knowledge-common tool declarations and the model constant. Keep it that
 * way: the live suite loads it in plain Node.
 *
 * The Live model id itself lives in exactly one place, `LIVE_MODEL` in
 * `./gemini`. src/__tests__/liveModelGuard.test.ts fails if a Live model id
 * is written anywhere else.
 */

import { Type } from '@google/genai';
import type { FunctionDeclaration, SpeechConfig } from '@google/genai';
import {
  wikipediaTool,
  computeTimeDifferenceTool,
  computeTimeOffsetTool,
} from '@andyfooblah/knowledge-common';
import type { Dossier } from '../types';
import { LIVE_MODEL, LIVE_THINKING_LEVEL } from './gemini';

// ---------------------------------------------------------------------------
// Turn-taking
// ---------------------------------------------------------------------------

/**
 * Turn-taking mode (flip to compare):
 *   'manual' — client-side VAD; the bot waits `responseWaitSeconds` of real
 *              silence before responding (patient, robust to eager end-of-turn).
 *   'auto'   — Gemini server VAD with LOW end-of-speech sensitivity (snappier,
 *              but can grab the turn during a pause on this native-audio model).
 *
 * Both modes are exercised against the real API by the live suite.
 */
export type TurnMode = 'manual' | 'auto';
export const TURN_MODE: TurnMode = 'auto';

/** `Dossier.responseWaitSeconds` when the family has not set one. */
export const DEFAULT_RESPONSE_WAIT_SECONDS = 1.5;

/** The `useSession` options that decide the Live setup message. */
export interface SessionLiveOptions {
  liveModel: string;
  thinkingLevel: typeof LIVE_THINKING_LEVEL;
  speechConfig: SpeechConfig | undefined;
  endOfSpeechSilenceMs: number;
  endOfSpeechSensitivity: 'LOW';
  manualTurnControl: boolean;
}

/**
 * Build the Live options for a dossier's interview session.
 *
 * `turnMode` exists so tests can check the supported `'manual'` mode without
 * editing the constant; the app always uses {@link TURN_MODE}.
 */
export function buildSessionLiveOptions(
  dossier: Pick<Dossier, 'selectedVoice' | 'responseWaitSeconds'> | null | undefined,
  turnMode: TurnMode = TURN_MODE,
): SessionLiveOptions {
  return {
    // The single model constant. 'auto' lets VoiceCommon's registry derive the
    // thinkingConfig the model accepts (none for the current model), so a model
    // change cannot leave a thinking level the new model rejects.
    liveModel: LIVE_MODEL,
    thinkingLevel: LIVE_THINKING_LEVEL,
    speechConfig: dossier
      ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: dossier.selectedVoice } } }
      : undefined,
    // How patiently the interviewer waits before stepping in when the
    // storyteller pauses. Configured per-dossier in seconds; default 1.5s.
    endOfSpeechSilenceMs: Math.round((dossier?.responseWaitSeconds ?? DEFAULT_RESPONSE_WAIT_SECONDS) * 1000),
    // Storytellers often pause mid-thought while recalling. In 'manual' mode we
    // drive turn boundaries client-side (bot waits responseWaitSeconds of real
    // silence). In 'auto' mode we fall back to Gemini's server VAD with LOW
    // end-of-speech sensitivity so it's at least less eager to grab the turn.
    endOfSpeechSensitivity: 'LOW',
    manualTurnControl: turnMode === 'manual',
  };
}

/**
 * The text cue sent once after connecting so the bot speaks first. The
 * instruction's MANDATORY START section says what to do with it.
 */
export function buildGreetingTrigger(completedSessionCount: number, storytellerName: string): string {
  return completedSessionCount === 0
    ? `[First session with ${storytellerName}. Introduce yourself and begin as instructed.]`
    : `[Returning session #${completedSessionCount + 1} with ${storytellerName}. Welcome them back as instructed and continue their story.]`;
}

// ---------------------------------------------------------------------------
// Tool declarations
// ---------------------------------------------------------------------------

const updateQuestionStatusTool: FunctionDeclaration = {
  name: 'updateQuestionStatus',
  description: 'Mark a story queue question as asked, skipped, or answered. Call after each question is addressed.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING, description: 'Question ID from the story queue.' },
      status: { type: Type.STRING, description: 'New status: "asked", "answered", or "skipped".' },
      findings: { type: Type.STRING, description: 'Optional summary of what was said.' },
    },
    required: ['id', 'status'],
  },
};

const reportEmotionalObservationTool: FunctionDeclaration = {
  name: 'reportEmotionalObservation',
  description: 'Log an emotional observation about the storyteller (e.g. distress, joy, nostalgia).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      mood: { type: Type.STRING, description: 'Observed emotional state.' },
      confidence: { type: Type.STRING, description: 'Confidence: "high", "medium", or "low".' },
      trigger: { type: Type.STRING, description: 'What seemed to trigger this emotion.' },
      recommendation: { type: Type.STRING, description: 'Suggested response or topic change.' },
    },
    required: ['mood', 'confidence'],
  },
};

const setPreferredNameTool: FunctionDeclaration = {
  name: 'setPreferredName',
  description: 'Record the name the storyteller prefers to be called by.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: 'The preferred name.' },
    },
    required: ['name'],
  },
};

const identifySpeakerTool: FunctionDeclaration = {
  name: 'identifySpeaker',
  description: 'Identify who is currently speaking (e.g. a family member who joined). Use null for the primary storyteller.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      speakerLabel: { type: Type.STRING, description: 'Name of current speaker, or null for primary storyteller.' },
      confidence: { type: Type.STRING, description: 'Confidence: "high", "medium", or "low".' },
    },
    required: ['confidence'],
  },
};

const recordFactTool: FunctionDeclaration = {
  name: 'recordFact',
  description: 'Record a noteworthy fact or correction shared during the conversation.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING, description: 'The fact to record.' },
      isCorrection: { type: Type.BOOLEAN, description: 'True if this corrects a previously recorded fact.' },
      correctionNote: { type: Type.STRING, description: 'Explanation of the correction (optional).' },
    },
    required: ['text', 'isCorrection'],
  },
};

const searchContextTool: FunctionDeclaration = {
  name: 'searchContext',
  description: 'Search the family\'s accumulated knowledge for context relevant to the current conversation topic.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'The topic or question to search for.' },
      topK: { type: Type.NUMBER, description: 'Number of results to return (default 4).' },
    },
    required: ['query'],
  },
};

const getBiographyTool: FunctionDeclaration = {
  name: 'getBiography',
  description: "Retrieve the storyteller's full background/biography on record. The prompt only carries a short profile; call this when you want the complete background before asking about something specific.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
    required: [],
  },
};

const getQuestionFindingsTool: FunctionDeclaration = {
  name: 'getQuestionFindings',
  description: 'Retrieve what has already been learned (accumulated findings) about a specific Story Queue question, by its id. Call this before revisiting a topic so you build on prior answers instead of repeating them.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      questionId: { type: Type.STRING, description: 'The id of the Story Queue question.' },
    },
    required: ['questionId'],
  },
};

const searchPlaceTool: FunctionDeclaration = {
  name: 'searchPlace',
  description: 'Look up a place by name and return its address and location details.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'Place name or address to look up.' },
    },
    required: ['query'],
  },
};

const getDistanceTool: FunctionDeclaration = {
  name: 'getDistanceBetweenPlaces',
  description: 'Calculate the approximate distance between two named places.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      placeA: { type: Type.STRING, description: 'First place name.' },
      placeB: { type: Type.STRING, description: 'Second place name.' },
    },
    required: ['placeA', 'placeB'],
  },
};

const getJokeTool: FunctionDeclaration = {
  name: 'getJoke',
  description: 'Fetch a random clean joke to lighten the mood.',
  parameters: {
    type: Type.OBJECT,
    properties: {},
    required: [],
  },
};

const getWeatherTool: FunctionDeclaration = {
  name: 'getWeather',
  description: 'Get the current weather for a location the storyteller mentions.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      location: { type: Type.STRING, description: 'City or place name.' },
    },
    required: ['location'],
  },
};

const showPhotoTool: FunctionDeclaration = {
  name: 'showPhoto',
  description: 'Display a prompt photo to the storyteller to help them recall a memory.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      photoId: { type: Type.STRING, description: 'ID of the photo to display.' },
    },
    required: ['photoId'],
  },
};

/**
 * The session's tool declarations, in the order they are sent. `showPhoto`
 * is included only when the dossier has prompt photos. `endSession` is not
 * here: VoiceCommon's `useSession` appends it.
 */
export function buildSessionTools(hasPromptPhotos: boolean): FunctionDeclaration[] {
  return [
    updateQuestionStatusTool,
    reportEmotionalObservationTool,
    setPreferredNameTool,
    identifySpeakerTool,
    recordFactTool,
    searchContextTool,
    getBiographyTool,
    getQuestionFindingsTool,
    searchPlaceTool,
    getDistanceTool,
    getJokeTool,
    getWeatherTool,
    wikipediaTool,
    computeTimeDifferenceTool,
    computeTimeOffsetTool,
    ...(hasPromptPhotos ? [showPhotoTool] : []),
  ];
}
