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
 * The turn engine for WRITTEN interviews (issue #210).
 *
 * A written interview is the same interviewer as a spoken one: the same
 * system instruction (services/gemini.ts), the same tools, the same
 * post-session analysis. Only the transport differs. Instead of a live audio
 * connection, each turn is one request to the reasoning model with the
 * conversation so far, and the model answers with text, with calls to the
 * interviewer's tools, or both.
 *
 * This file is pure: no React, no Firebase, no network. `generate` is passed
 * in, so the browser hook can route it through the server broker and the live
 * test can call the model directly.
 */

/** One turn of model-facing conversation, in the provider's shape. Model turns are kept exactly as returned. */
export interface TextContent { role: 'user' | 'model'; parts: Record<string, unknown>[] }

export interface TextFunctionDeclaration { name: string; description?: string; parameters?: unknown }

export interface TextGenerateRequest {
  systemInstruction: string;
  contents: TextContent[];
  tools: TextFunctionDeclaration[];
}
export interface TextGenerateResponse { candidates?: unknown }

export interface ToolEvent { name: string; args: Record<string, unknown>; result: string; durationMs: number }

export interface TextTurnResult {
  /** What the interviewer wrote. Never empty: a turn with no text throws. */
  replyText: string;
  toolEvents: ToolEvent[];
  /** The interviewer called endSession: show the reply, then end. */
  endRequested: boolean;
}

/**
 * Appended to the interviewer's instruction for a written session. The base
 * instruction was written for speech ("you must speak first", "listen"); this
 * tells the model how the same job is done on the page.
 */
export const WRITTEN_MODE_ADDENDUM = `

WRITTEN CONVERSATION — READ THIS LAST, IT OVERRIDES ANYTHING ABOVE ABOUT SPEAKING OR AUDIO:
This conversation is TYPED, not spoken. The storyteller reads your words and writes back in their own time.
- Wherever the instructions above say "speak", "say", "listen" or "hear", read "write" and "read". There is no audio and no recording.
- Write the way a thoughtful friend writes a short letter: warm, plain, no lists, no headings, no markdown.
- Ask ONE question per message. Keep each message under about 120 words.
- When they have told you something before, quote a few of their own words back so they know they were read.
- They may answer at length, or in one line, or after a long while. Never hurry them and never comment on how long they took.
- Do not describe sounds, pauses, tone of voice or anything you could only know by hearing them.
- If they write that they would rather not answer something, accept that at once and move to something else. Do not return to it.
- When they say they are done for now, thank them briefly and call endSession.`;

/** The text transport's own end-of-session tool (the voice library injects its own). */
export const TEXT_END_SESSION_TOOL: TextFunctionDeclaration = {
  name: 'endSession',
  description:
    'End the written conversation. Call this when the storyteller says they are finished for now, after writing a brief, warm closing message in the same turn.',
  parameters: { type: 'object', properties: {} },
};

const MAX_TOOL_ROUNDS = 6;

interface Candidate { content?: { role?: string; parts?: Record<string, unknown>[] }; finishReason?: string }

function firstCandidate(response: TextGenerateResponse): Candidate {
  const list = response.candidates;
  return Array.isArray(list) && list.length > 0 ? (list[0] as Candidate) : {};
}

/**
 * Run one storyteller turn to completion: call the model, run any tools it
 * asks for, feed the results back, and repeat until it has written a reply.
 *
 * `contents` is the running conversation and is appended to IN PLACE: on
 * success it ends with the model's final turn. On failure it is restored to
 * what it was, so the caller can simply try again.
 */
export async function runTextTurn(
  contents: TextContent[],
  deps: {
    generate: (req: TextGenerateRequest) => Promise<TextGenerateResponse>;
    onToolCall: (name: string, args: Record<string, unknown>) => Promise<string>;
    systemInstruction: string;
    tools: TextFunctionDeclaration[];
  },
): Promise<TextTurnResult> {
  const checkpoint = contents.length;
  const toolEvents: ToolEvent[] = [];
  const written: string[] = [];
  let endRequested = false;

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await deps.generate({ systemInstruction: deps.systemInstruction, contents, tools: deps.tools });
      const candidate = firstCandidate(response);
      const parts = candidate.content?.parts ?? [];

      // Keep the model's turn exactly as it came back. Reasoning models attach
      // signatures to their function calls and reject a history that drops them.
      if (parts.length > 0) contents.push({ role: 'model', parts });

      for (const part of parts) {
        if (typeof part.text === 'string' && part.thought !== true && part.text.trim()) written.push(part.text.trim());
      }

      const calls = parts
        .map((p) => p.functionCall as { name?: string; args?: Record<string, unknown>; id?: string } | undefined)
        .filter((c): c is { name: string; args?: Record<string, unknown>; id?: string } => typeof c?.name === 'string');

      if (calls.length === 0) {
        if (written.length === 0) {
          throw new Error(
            candidate.finishReason === 'MAX_TOKENS'
              ? 'The reply was cut off before any text was written.'
              : 'The interviewer returned no text.',
          );
        }
        break;
      }
      if (round === MAX_TOOL_ROUNDS) {
        if (written.length === 0) throw new Error('The interviewer kept calling tools and never wrote a reply.');
        break;
      }

      const responses: Record<string, unknown>[] = [];
      for (const call of calls) {
        const args = call.args ?? {};
        const started = Date.now();
        let result: string;
        if (call.name === TEXT_END_SESSION_TOOL.name) {
          endRequested = true;
          result = 'The conversation will end after this message.';
        } else {
          try {
            result = await deps.onToolCall(call.name, args);
          } catch (err) {
            // A failed tool is something the interviewer can work around; it is not a failed turn.
            result = `Tool failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
        toolEvents.push({ name: call.name, args, result, durationMs: Date.now() - started });
        responses.push({ functionResponse: { name: call.name, response: { result }, ...(call.id ? { id: call.id } : {}) } });
      }
      contents.push({ role: 'user', parts: responses });

      // endSession with a goodbye already written in the same turn: done.
      if (endRequested && written.length > 0) break;
    }
  } catch (err) {
    contents.length = checkpoint;
    throw err;
  }

  return { replyText: written.join('\n\n'), toolEvents, endRequested };
}
