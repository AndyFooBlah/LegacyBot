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
 * LIVE: a written interview (#210) against the real model.
 *
 * Runs the production turn engine (services/textInterview.ts) with the
 * production instruction and tools for the fictional Furtado family, through
 * the same tool filtering the server broker applies, and the same model and
 * generation settings the browser hook sends. What the mocks cannot show and
 * this can: that the model accepts this conversation shape across tool calls
 * (reasoning models reject a history that drops their call signatures), and
 * that the interviewer behaves on the page as it does in speech.
 *
 * Not covered: the callable itself (sign-in, membership, rate limits) and the
 * browser screen.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { sanitizeFunctionTools } from '../../../functions/src/brokerConfig';
import { REASONING_MODEL } from '../../services/gemini';
import {
  runTextTurn, TEXT_END_SESSION_TOOL, WRITTEN_MODE_ADDENDUM,
  type TextContent, type TextFunctionDeclaration, type TextGenerateRequest,
} from '../../services/textInterview';
import { buildFurtadoSessionInputs } from './furtadoSession';
import { LIVE_API_KEY, describeLive } from './liveEnv';

const FUNCTIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../functions');

/**
 * In production the request is made by the Cloud Function, with the functions
 * package's own copy of the SDK, which is a different version from the app's.
 * Use that copy when it is installed, so this exercises the SDK that will
 * actually carry the conversation (and its call signatures) to the model.
 */
function brokerSdk(): { Ctor: typeof GoogleGenAI; version: string } {
  try {
    const require = createRequire(path.join(FUNCTIONS_DIR, 'package.json'));
    if (require.resolve('@google/genai').startsWith(FUNCTIONS_DIR)) {
      // Read the version off disk: the package does not export its package.json,
      // and a require() of it throws, which would silently fall through to the
      // client copy and test the wrong SDK.
      const pkg = path.join(FUNCTIONS_DIR, 'node_modules', '@google', 'genai', 'package.json');
      const version = (JSON.parse(fs.readFileSync(pkg, 'utf8')) as { version: string }).version;
      return { Ctor: (require('@google/genai') as { GoogleGenAI: typeof GoogleGenAI }).GoogleGenAI, version: `functions ${version}` };
    }
  } catch {
    // functions/ dependencies are not installed: fall through.
  }
  return { Ctor: GoogleGenAI, version: 'client copy' };
}

describeLive('written interview with Teo Furtado (real model, production instruction and tools)', () => {
  const inputs = buildFurtadoSessionInputs('first-session');
  const sdk = brokerSdk();
  console.log(`[live] written interview: model ${REASONING_MODEL}, SDK ${sdk.version}`);
  const ai = new sdk.Ctor({ apiKey: LIVE_API_KEY });
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const contents: TextContent[] = [];
  const systemInstruction = inputs.systemInstruction + WRITTEN_MODE_ADDENDUM;
  const tools = [...(inputs.tools as unknown as TextFunctionDeclaration[]), TEXT_END_SESSION_TOOL];

  const generate = async (req: TextGenerateRequest) => {
    const response = await ai.models.generateContent({
      model: REASONING_MODEL,
      contents: req.contents as never,
      config: {
        systemInstruction: req.systemInstruction,
        // Exactly what the broker forwards: declarations rebuilt, nothing else.
        tools: sanitizeFunctionTools([{ functionDeclarations: req.tools }]) as never,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        maxOutputTokens: 4096,
        temperature: 0.7,
      },
    });
    return { candidates: response.candidates };
  };
  const deps = {
    generate,
    systemInstruction,
    tools,
    onToolCall: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return 'Done.'; },
  };
  const say = async (text: string) => {
    contents.push({ role: 'user', parts: [{ text }] });
    return runTextTurn(contents, deps);
  };
  const words = (t: string) => t.trim().split(/\s+/).length;

  it('runs on the Cloud Functions copy of the SDK when it is installed', () => {
    const installed = fs.existsSync(path.join(FUNCTIONS_DIR, 'node_modules', '@google', 'genai', 'package.json'));
    if (installed) expect(sdk.version).toMatch(/^functions \d/);
  });

  it('opens the conversation in writing: short, warm, no markup', async () => {
    const r = await say(inputs.greetingTrigger);
    expect(r.replyText.length).toBeGreaterThan(20);
    expect(words(r.replyText)).toBeLessThan(160);
    expect(r.replyText).not.toMatch(/^#|^\s*[-*] |\*\*/m);
    expect(r.endRequested).toBe(false);
  });

  it('takes the name he asks for, through a tool call and back', async () => {
    const r = await say('Oh. Teo. Everybody calls me Teo. Nobody says Teodoro except the doctor.');
    expect(calls.some((c) => c.name === 'setPreferredName' && JSON.stringify(c.args).includes('Teo'))).toBe(true);
    expect(r.replyText).toMatch(/Teo\b/);
  });

  it('keeps going across several turns with tools in the history', async () => {
    const r1 = await say('I was born in Capelo, on Faial, in March of 1941. My father had a small vineyard and two cows.');
    expect(r1.replyText.length).toBeGreaterThan(20);
    const r2 = await say('We got married June eighteenth, nineteen sixty-six, at Our Lady of Mount Carmel. It was so hot the candles bent.');
    expect(r2.replyText.length).toBeGreaterThan(20);
    expect(words(r2.replyText)).toBeLessThan(160);
  });

  it('accepts a refusal and does not ask about it again', async () => {
    const r = await say("My wife Lucinda died in 2019. I don't want to talk about that today. The hospital, no.");
    expect(r.replyText).not.toMatch(/hospital[^.!?]*\?/i);
    expect(r.replyText).not.toMatch(/(last|final) (days|weeks|months|illness)[^.!?]*\?/i);
    const next = await say('We had a dog called Sardinha who rode on the boat.');
    expect(next.replyText).not.toMatch(/hospital|illness/i);
  });

  it('ends when he says he is done', async () => {
    const r = await say("I am tired now. Let's stop for today.");
    expect(r.endRequested).toBe(true);
    expect(r.replyText.length).toBeGreaterThan(5);
  });
});
