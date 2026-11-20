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

import { describe, it, expect, vi } from 'vitest';
import { runTextTurn, TEXT_END_SESSION_TOOL, WRITTEN_MODE_ADDENDUM, type TextContent } from '../../services/textInterview';

const text = (t: string) => ({ candidates: [{ content: { role: 'model', parts: [{ text: t }] } }] });
const call = (name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args, id: 'call-1' }, thoughtSignature: 'sig-abc', ...extra }] } }] });

function deps(responses: unknown[], onToolCall = vi.fn().mockResolvedValue('ok')) {
  const generate = vi.fn();
  for (const r of responses) r instanceof Error ? generate.mockRejectedValueOnce(r) : generate.mockResolvedValueOnce(r);
  return { generate, onToolCall, systemInstruction: 'SYS', tools: [TEXT_END_SESSION_TOOL] };
}
const start = (): TextContent[] => [{ role: 'user', parts: [{ text: 'We came in May.' }] }];

describe('runTextTurn', () => {
  it('returns what the interviewer wrote and records its turn in the conversation', async () => {
    const contents = start();
    const d = deps([text('May of 1959. What do you remember of the harbour?')]);
    const result = await runTextTurn(contents, d);
    expect(result).toEqual({ replyText: 'May of 1959. What do you remember of the harbour?', toolEvents: [], endRequested: false });
    expect(contents).toHaveLength(2);
    expect(contents[1].role).toBe('model');
    expect(d.generate).toHaveBeenCalledWith({ systemInstruction: 'SYS', contents, tools: [TEXT_END_SESSION_TOOL] });
  });

  it('runs a tool the interviewer asks for and gives it the result before it replies', async () => {
    const contents = start();
    const onToolCall = vi.fn().mockResolvedValue('Fact recorded.');
    const d = deps([call('recordFact', { fact: 'Arrived May 1959' }), text('Thank you. And then?')], onToolCall);
    const result = await runTextTurn(contents, d);

    expect(onToolCall).toHaveBeenCalledWith('recordFact', { fact: 'Arrived May 1959' });
    expect(result.replyText).toBe('Thank you. And then?');
    expect(result.toolEvents).toMatchObject([{ name: 'recordFact', args: { fact: 'Arrived May 1959' }, result: 'Fact recorded.' }]);
    // user, model(call), user(functionResponse), model(text)
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user', 'model']);
    expect(contents[2].parts[0]).toEqual({ functionResponse: { name: 'recordFact', response: { result: 'Fact recorded.' }, id: 'call-1' } });
  });

  it("keeps the model's own turn byte for byte, signatures included", async () => {
    const contents = start();
    await runTextTurn(contents, deps([call('recordFact', {}), text('ok then')]));
    expect(contents[1].parts[0]).toHaveProperty('thoughtSignature', 'sig-abc');
  });

  it('leaves private reasoning out of the reply', async () => {
    const d = deps([{ candidates: [{ content: { parts: [{ text: 'thinking about what to ask', thought: true }, { text: 'What was the ship called?' }] } }] }]);
    expect((await runTextTurn(start(), d)).replyText).toBe('What was the ship called?');
  });

  it('ends the session itself: endSession is not passed to the tool handler', async () => {
    const onToolCall = vi.fn();
    const d = deps([{ candidates: [{ content: { parts: [{ text: 'Rest well, Teo.' }, { functionCall: { name: 'endSession', args: {} } }] } }] }], onToolCall);
    const result = await runTextTurn(start(), d);
    expect(result.endRequested).toBe(true);
    expect(result.replyText).toBe('Rest well, Teo.');
    expect(onToolCall).not.toHaveBeenCalled();
    expect(d.generate).toHaveBeenCalledTimes(1);
  });

  it('asks again for a goodbye if endSession came with no text', async () => {
    const d = deps([call('endSession', {}), text('Goodbye for now.')]);
    const result = await runTextTurn(start(), d);
    expect(result).toMatchObject({ endRequested: true, replyText: 'Goodbye for now.' });
  });

  it('tells the interviewer when a tool fails, and carries on', async () => {
    const onToolCall = vi.fn().mockRejectedValue(new Error('offline'));
    const contents = start();
    const result = await runTextTurn(contents, deps([call('searchContext', { q: 'boat' }), text('Tell me about the boat.')], onToolCall));
    expect(result.replyText).toBe('Tell me about the boat.');
    expect(JSON.stringify(contents[2])).toContain('Tool failed: offline');
  });

  it('puts the conversation back as it was when the model call fails, so the turn can be retried', async () => {
    const contents = start();
    await expect(runTextTurn(contents, deps([call('recordFact', {}), new Error('network')]))).rejects.toThrow('network');
    expect(contents).toEqual(start());
  });

  it('treats a reply with no text as a failure, not as silence', async () => {
    const contents = start();
    await expect(runTextTurn(contents, deps([{ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }]))).rejects.toThrow(/cut off/);
    await expect(runTextTurn(contents, deps([{ candidates: [] }]))).rejects.toThrow(/no text/);
    expect(contents).toEqual(start());
  });

  it('stops a runaway tool loop', async () => {
    const d = deps(Array.from({ length: 10 }, () => call('recordFact', {})));
    await expect(runTextTurn(start(), d)).rejects.toThrow(/never wrote a reply/);
    expect(d.generate.mock.calls.length).toBeLessThanOrEqual(7);
  });
});

describe('WRITTEN_MODE_ADDENDUM', () => {
  it('tells the interviewer this is typed, one question at a time, and to drop a declined topic', () => {
    expect(WRITTEN_MODE_ADDENDUM).toMatch(/TYPED, not spoken/);
    expect(WRITTEN_MODE_ADDENDUM).toMatch(/ONE question per message/);
    expect(WRITTEN_MODE_ADDENDUM).toMatch(/accept that at once/);
    expect(WRITTEN_MODE_ADDENDUM).toMatch(/endSession/);
  });
});
