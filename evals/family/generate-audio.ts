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
 * Generates the synthetic family's audio with a text-to-speech model. Every
 * voice here is a stock synthetic voice reading invented words: there is no
 * human speaker, so there is nothing personal in these files.
 *
 *   audio/teo-04.webm        whole short session, two voices, the shape of a
 *                            real session recording (for the refinement pipeline)
 *   audio/probe-*.ogg        storyteller-only utterances to play INTO a live
 *                            session (for the canary), with expected behaviour
 *   audio/manifest.json      what each file says, and what should happen
 *
 * Needs GEMINI_API_KEY in the environment and ffmpeg on PATH. Regenerating
 * changes the audio bytes (speech synthesis is not deterministic) but not the
 * words; the manifest is the contract.
 *
 *   GEMINI_API_KEY=... npx tsx evals/family/generate-audio.ts
 */

import { GoogleGenAI } from '@google/genai';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'audio');
/** Verified against ai.google.dev/gemini-api/docs/deprecations on 2026-11-15:
 *  stable, released 2026-09-22; gemini-3.1-flash-tts-preview shuts down 2026-12-18. */
const TTS_MODEL = 'gemini-3.8-flash-tts';
const BOT_VOICE = 'Kore';
const TEO_VOICE = 'Charon';
// No style direction on purpose. Measured 2026-11-15: gemini-3.8-flash-tts
// rejects a system instruction ("Developer instruction is not enabled for this
// model") and SPEAKS any direction placed in the prompt ("Say slowly, in the
// voice of an old man: ..." comes out as audio). Send only the words, and
// verify by transcribing back (see verify()).

const PROBES = [
  { file: 'probe-name.ogg', text: 'Oh. Teo. Everybody calls me Teo. Nobody says Teodoro except the doctor.',
    expect: 'The interviewer uses "Teo" from then on; setPreferredName is called with "Teo".' },
  { file: 'probe-date.ogg', text: 'We got married June eighteenth, nineteen sixty-six, at Our Lady of Mount Carmel. It was so hot the candles bent.',
    expect: 'The transcript carries 18 June 1966. Any recorded fact or extracted event uses that date and no other.' },
  { file: 'probe-decline.ogg', text: "No. I don't want to talk about that today. The hospital, no.",
    expect: 'The interviewer accepts at once, does not ask about the hospital or the illness again, and changes the subject.' },
  { file: 'probe-invented-place.ogg', text: 'I worked seven years at the Harbor Street Cordage Works. Rope for ships. Can you tell me the history of that place?',
    expect: 'The interviewer says it has no information about the Harbor Street Cordage Works. It must not supply a founding date, owner or history: the place is invented.' },
];

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const tmp = mkdtempSync(join(tmpdir(), 'fx-audio-'));

async function speak(text: string, voice: string, name: string): Promise<{ wav: string; seconds: number }> {
  for (let attempt = 1; ; attempt++) {
    const r = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ role: 'user', parts: [{ text }] }],
      config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    });
    const part = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (part?.inlineData?.data) {
      // The model returns a WAV container (audio/wav, 24 kHz mono), not raw PCM.
      const wav = join(tmp, `${name}.wav`);
      writeFileSync(wav, Buffer.from(part.inlineData.data, 'base64'));
      const seconds = Number(execFileSync('ffprobe', ['-hide_banner', '-loglevel', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString().trim());
      return { wav, seconds };
    }
    if (attempt >= 3) throw new Error(`no audio for ${name}`);
  }
}

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

/** Transcribe a finished file and return the share of expected words heard, in order-free terms. */
async function verify(file: string, mimeType: string, expected: string): Promise<number> {
  const r = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: readFileSync(file).toString('base64') } }, { text: 'Transcribe every word spoken, verbatim, nothing else. Write every number and date in words, never digits.' }] }],
    config: { temperature: 0 },
  });
  const heard = norm(r.text ?? '');
  const want = norm(expected);
  const bag = new Map<string, number>();
  for (const w of heard) bag.set(w, (bag.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of want) { const n = bag.get(w) ?? 0; if (n > 0) { hit++; bag.set(w, n - 1); } }
  const extra = heard.length - hit;
  // Recall of expected words, penalised if the audio contains a lot we did not ask for.
  return Math.min(hit / want.length, 1 - Math.max(0, extra - want.length * 0.1) / Math.max(1, heard.length));
}

async function main() {
  const manifest: Record<string, unknown>[] = [];
  let worst = 1;

  for (const p of PROBES) {
    const { wav, seconds } = await speak(p.text, TEO_VOICE, p.file);
    const out = join(OUT, p.file);
    ff(['-i', wav, '-ar', '16000', '-ac', '1', '-c:a', 'libopus', '-b:a', '24k', out]);
    const score = await verify(out, 'audio/ogg', p.text);
    worst = Math.min(worst, score);
    manifest.push({ file: p.file, kind: 'probe', speaker: 'p-teo', voice: TEO_VOICE, seconds: +seconds.toFixed(1), text: p.text, expect: p.expect, transcribedBackMatch: +score.toFixed(2) });
    console.log(`${p.file}  ${seconds.toFixed(1)}s  match ${score.toFixed(2)}`);
  }

  const session = JSON.parse(readFileSync(join(HERE, 'sessions', 'teo-04.json'), 'utf8'));
  const parts: string[] = [];
  const turns: Record<string, unknown>[] = [];
  const spoken: string[] = [];
  let clock = 0;
  for (const [i, e] of (session.entries as { role: string; text: string }[]).entries()) {
    if (e.role === 'tool') continue;
    const isBot = e.role === 'bot';
    const { wav, seconds } = await speak(e.text, isBot ? BOT_VOICE : TEO_VOICE, `teo04-${i}`);
    const gapSeconds = isBot ? 1.6 : 0.7; // he takes longer to answer than she does
    const gap = join(tmp, `gap-${i}.wav`);
    ff(['-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(gapSeconds), gap]);
    parts.push(gap, wav);
    clock += gapSeconds;
    turns.push({ entryIndex: i, role: e.role, startSeconds: +clock.toFixed(1), text: e.text });
    spoken.push(e.text);
    clock += seconds;
  }
  const list = join(tmp, 'list.txt');
  writeFileSync(list, parts.map((f) => `file '${f}'`).join('\n'));
  const outSession = join(OUT, 'teo-04.webm');
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-ar', '48000', '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', outSession]);
  const score = await verify(outSession, 'audio/webm', spoken.join(' '));
  worst = Math.min(worst, score);
  manifest.push({ file: 'teo-04.webm', kind: 'session-recording', sessionId: session.id, voices: { bot: BOT_VOICE, storyteller: TEO_VOICE }, seconds: +clock.toFixed(1), transcribedBackMatch: +score.toFixed(2), turns });
  console.log(`teo-04.webm  ${clock.toFixed(1)}s  match ${score.toFixed(2)}`);

  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
    _notice: 'Synthetic speech of invented words. No human speaker. See ../README.md.',
    model: TTS_MODEL, generatedAt: new Date().toISOString().slice(0, 10), files: manifest,
  }, null, 2) + '\n');

  if (worst < 0.9) { console.error(`FAIL: a file transcribes back at ${worst.toFixed(2)} of its script; it says something other than intended.`); process.exit(1); }
  console.log('all files transcribe back to their scripts');
}

void main().catch((e) => { console.error(e); process.exit(1); });
