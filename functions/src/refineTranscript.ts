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
 * Offline transcript refinement (#123).
 *
 * Downloads a completed session's mixed audio from Cloud Storage, sends it to
 * Gemini 3.1 Pro (audio input + structured output), and returns a diarized,
 * higher-fidelity utterance list. The real-time Gemini Live transcript is
 * optimized for latency, not accuracy; this one-shot offline pass fixes
 * mis-heard proper names and fuzzy boundaries that every downstream artifact
 * (gap analysis, embeddings, memoir) would otherwise inherit.
 *
 * Audio goes through the Files API (not inline base64) so multi-minute — up to
 * multi-hour — sessions work without hitting the ~20 MB inline request cap or
 * having to byte-slice a WebM/Opus container.
 */

import { getStorage } from 'firebase-admin/storage';
import * as logger from 'firebase-functions/logger';
import { GoogleGenAI, Type } from '@google/genai';
import type { RefinedUtterance } from './transcriptAlignment';
import { REASONING_MODEL } from './models';

/** Gemini model used for offline refinement — matches the app's other Pro-tier
 *  server calls (analysis.ts, memoir.ts). */
export const REFINEMENT_MODEL = REASONING_MODEL;

/** Poll settings while the uploaded audio file transitions PROCESSING → ACTIVE. */
const FILE_POLL_INTERVAL_MS = 2000;
const FILE_POLL_MAX_ATTEMPTS = 60; // ~2 min ceiling

const REFINE_PROMPT = `You are a professional transcriptionist. This audio is a recorded life-story interview between an AI interviewer (speaker "model") and a human storyteller (speaker "user").

Produce a faithful, verbatim transcript as an ordered list of utterances. For each utterance give:
- speaker: "user" for the human storyteller, "model" for the AI interviewer
- start_time and end_time: seconds from the start of the audio (numbers)
- text: exactly what was said, with correct proper nouns, natural sentence boundaries, and standard punctuation and capitalization

Rules:
- Preserve the speaker's actual words. Do NOT summarize, paraphrase, add, or omit content.
- Remove only non-speech artifacts (control characters, obvious transcription garbage).
- Keep disfluencies only where they carry meaning; do not invent them.
- Order utterances by start_time.`;

const REFINE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    utterances: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          speaker: { type: Type.STRING, enum: ['user', 'model'] },
          start_time: { type: Type.NUMBER },
          end_time: { type: Type.NUMBER },
          text: { type: Type.STRING },
        },
        required: ['speaker', 'start_time', 'end_time', 'text'],
      },
    },
  },
  required: ['utterances'],
} as const;

export interface DownloadedAudio {
  buffer: Buffer;
  mimeType: string;
}

export interface RefineDeps {
  apiKey: string;
  /** Injectable for tests; defaults to a Cloud Storage download. */
  downloadAudio?: (objectPath: string) => Promise<DownloadedAudio>;
}

/** Default GCS download: audioUrl on the session doc is an object PATH. */
async function defaultDownloadAudio(objectPath: string): Promise<DownloadedAudio> {
  const file = getStorage().bucket().file(objectPath);
  const [meta] = await file.getMetadata();
  const [buffer] = await file.download();
  const mimeType = (meta.contentType ?? 'audio/webm').split(';')[0].trim();
  return { buffer, mimeType };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Coerce the model's snake_case rows into RefinedUtterance, dropping junk. */
function normalizeUtterances(raw: unknown): RefinedUtterance[] {
  const list = (raw as { utterances?: unknown })?.utterances;
  if (!Array.isArray(list)) return [];
  const out: RefinedUtterance[] = [];
  for (const r of list) {
    const speaker = r?.speaker === 'model' ? 'model' : r?.speaker === 'user' ? 'user' : null;
    const text = typeof r?.text === 'string' ? r.text.trim() : '';
    const startTime = Number(r?.start_time);
    const endTime = Number(r?.end_time);
    if (!speaker || !text || !Number.isFinite(startTime)) continue;
    out.push({
      speaker,
      startTime,
      endTime: Number.isFinite(endTime) ? endTime : startTime,
      text,
    });
  }
  out.sort((a, b) => a.startTime - b.startTime);
  return out;
}

/**
 * Build a refinement handler. `apiKey` is the server-side GEMINI_API_KEY.
 * Returns a function that takes a GCS object path and yields refined utterances.
 * Throws on hard failure (caller treats refinement as best-effort).
 */
export function buildRefineTranscriptHandler(deps: RefineDeps) {
  const ai = new GoogleGenAI({ apiKey: deps.apiKey });
  const downloadAudio = deps.downloadAudio ?? defaultDownloadAudio;

  return async function refine(objectPath: string): Promise<RefinedUtterance[]> {
    const { buffer, mimeType } = await downloadAudio(objectPath);
    logger.info(`[Refine] Downloaded audio ${objectPath} (${buffer.length} bytes, ${mimeType})`);

    // Upload via the Files API and wait until it is ACTIVE.
    let uploaded = await ai.files.upload({
      file: new Blob([buffer], { type: mimeType }),
      config: { mimeType },
    });

    try {
      for (
        let attempt = 0;
        uploaded.state === 'PROCESSING' && attempt < FILE_POLL_MAX_ATTEMPTS;
        attempt++
      ) {
        await sleep(FILE_POLL_INTERVAL_MS);
        uploaded = await ai.files.get({ name: uploaded.name! });
      }
      if (uploaded.state !== 'ACTIVE') {
        throw new Error(`Uploaded audio not ACTIVE (state=${uploaded.state})`);
      }

      const response = await ai.models.generateContent({
        model: REFINEMENT_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { fileData: { fileUri: uploaded.uri!, mimeType } },
              { text: REFINE_PROMPT },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: REFINE_SCHEMA,
          temperature: 0,
        },
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(response.text ?? '{"utterances":[]}');
      } catch {
        throw new Error('Refinement returned unparseable JSON');
      }
      const utterances = normalizeUtterances(parsed);
      logger.info(`[Refine] Model returned ${utterances.length} utterances`);
      return utterances;
    } finally {
      // Best-effort cleanup of the uploaded file (it also auto-expires ~48h).
      try {
        if (uploaded.name) await ai.files.delete({ name: uploaded.name });
      } catch (err) {
        logger.warn('[Refine] Failed to delete uploaded audio file:', err);
      }
    }
  };
}
