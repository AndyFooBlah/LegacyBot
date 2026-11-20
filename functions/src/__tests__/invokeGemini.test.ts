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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildInvokeGeminiHandler, ALLOWED_CONFIG_KEYS } from '../invokeGemini';
import { HttpsError } from 'firebase-functions/v2/https';

const mockGenerateContent = vi.fn();
/** The `config` the handler handed to the SDK on its most recent call. */
const lastConfig = () => mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0].config;
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function() {
    return {
      models: {
        generateContent: mockGenerateContent,
      },
    };
  }),
}));

vi.mock('../membership', async () => {
  const { HttpsError } = await import('firebase-functions/v2/https');
  return {
    // Membership itself is tested in membership.test.ts; here every signed-in caller is a member.
    requireFamilyMember: vi.fn(async (request: { auth?: { uid: string } }) => {
      if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
      return request.auth.uid;
    }),
  };
});
vi.mock('../rateLimit', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('invokeGemini', () => {
  const mockApiKey = () => 'test-api-key';
  const handler = buildInvokeGeminiHandler({ apiKey: mockApiKey });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws unauthenticated if no user is signed in', async () => {
    const request = { auth: null, data: {} } as any;
    await expect(handler(request)).rejects.toThrow(
      new HttpsError('unauthenticated', 'Sign-in required.')
    );
  });

  it('throws invalid-argument if model is missing', async () => {
    const request = { auth: { uid: 'u1' }, data: { contents: 'hi' } } as any;
    await expect(handler(request)).rejects.toThrow(
      new HttpsError('invalid-argument', 'model is required.')
    );
  });

  it('throws permission-denied if model is not allowed', async () => {
    const request = { auth: { uid: 'u1' }, data: { model: 'gpt-4', contents: 'hi' } } as any;
    await expect(handler(request)).rejects.toThrow(
      new HttpsError('permission-denied', 'Model gpt-4 is not allowed.')
    );
  });

  it('throws invalid-argument if contents exceeds the input-size ceiling', async () => {
    const request = {
      auth: { uid: 'u1' },
      data: { model: 'gemini-3.8-flash', contents: 'x'.repeat(200_001) },
    } as any;
    await expect(handler(request)).rejects.toThrow(HttpsError);
    await expect(handler(request)).rejects.toThrow(/too large/);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('calls Gemini and returns the response', async () => {
    const request = { 
      auth: { uid: 'u1' }, 
      data: { model: 'gemini-3.8-flash', contents: [{ role: 'user', parts: [{ text: 'hi' }] }] } 
    } as any;
    
    mockGenerateContent.mockResolvedValue({
      text: 'Hello!',
      candidates: [{ parts: [{ text: 'Hello!' }] }],
      usageMetadata: { promptTokenCount: 5, candidateTokenCount: 2 }
    });

    const result = await handler(request);

    expect(result.text).toBe('Hello!');
    expect(result.usageMetadata).toBeDefined();
    expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.8-flash',
    }));
  });

  it('drops httpOptions so a caller cannot redirect the request (and the API key) to their own host', async () => {
    const handler = buildInvokeGeminiHandler({ apiKey: () => 'fake-key' });
    mockGenerateContent.mockResolvedValue({ text: 'ok', candidates: [] });
    await handler({
      auth: { uid: 'u1' },
      data: {
        model: 'gemini-3.8-flash',
        contents: 'hi',
        config: {
          temperature: 0.2,
          httpOptions: { baseUrl: 'https://attacker.example', headers: { 'x-evil': '1' } },
        },
      },
    } as never);
    const passed = lastConfig();
    expect(passed.httpOptions).toBeUndefined();
    expect(JSON.stringify(passed)).not.toContain('attacker.example');
    expect(passed.temperature).toBe(0.2);
  });

  it('passes only allow-listed config keys', async () => {
    const handler = buildInvokeGeminiHandler({ apiKey: () => 'fake-key' });
    mockGenerateContent.mockResolvedValue({ text: 'ok', candidates: [] });
    await handler({
      auth: { uid: 'u1' },
      data: {
        model: 'gemini-3.8-flash',
        contents: 'hi',
        config: {
          thinkingConfig: { thinkingLevel: 'HIGH' },
          responseMimeType: 'application/json',
          systemInstruction: 'be brief',
          tools: [{ googleSearch: {} }],
          abortSignal: {},
          cachedContent: 'cachedContents/x',
          candidateCount: 8,
          somethingNew: true,
        },
      },
    } as never);
    const passed = lastConfig();
    for (const key of Object.keys(passed)) expect(ALLOWED_CONFIG_KEYS).toContain(key);
    expect(passed.tools).toBeUndefined();
    expect(passed.candidateCount).toBe(1);
    expect(passed.thinkingConfig).toEqual({ thinkingLevel: 'HIGH' });
  });

  it('accepts function declarations and nothing else from a caller-supplied tools array', async () => {
    const handler = buildInvokeGeminiHandler({ apiKey: () => 'fake-key' });
    mockGenerateContent.mockResolvedValue({ text: 'ok', candidates: [] });
    await handler({
      auth: { uid: 'u1' },
      data: {
        model: 'gemini-3.8-flash',
        contents: 'hi',
        config: {
          tools: [
            { googleSearch: {} },
            { urlContext: {} },
            { codeExecution: {} },
            {
              googleSearch: {},
              functionDeclarations: [
                { name: 'recordFact', description: 'Record a fact', parameters: { type: 'object', properties: { fact: { type: 'string' } } }, behavior: 'NON_BLOCKING' },
                { name: 'bad name with spaces', description: 'x' },
                { description: 'no name' },
              ],
            },
          ],
        },
      },
    } as never);
    expect(lastConfig().tools).toEqual([
      { functionDeclarations: [{ name: 'recordFact', description: 'Record a fact', parameters: { type: 'object', properties: { fact: { type: 'string' } } } }] },
    ]);
    expect(JSON.stringify(lastConfig())).not.toMatch(/googleSearch|urlContext|codeExecution|NON_BLOCKING/);
  });

  it('drops tools entirely when no valid function declaration is present', async () => {
    const handler = buildInvokeGeminiHandler({ apiKey: () => 'fake-key' });
    mockGenerateContent.mockResolvedValue({ text: 'ok', candidates: [] });
    await handler({ auth: { uid: 'u1' }, data: { model: 'gemini-3.8-flash', contents: 'hi', config: { tools: [{ googleSearch: {} }] } } } as never);
    expect(lastConfig().tools).toBeUndefined();
  });

  it('ignores a config that is not a plain object', async () => {
    const handler = buildInvokeGeminiHandler({ apiKey: () => 'fake-key' });
    mockGenerateContent.mockResolvedValue({ text: 'ok', candidates: [] });
    await handler({ auth: { uid: 'u1' }, data: { model: 'gemini-3.8-flash', contents: 'hi', config: ['httpOptions'] } } as never);
    expect(lastConfig()).toEqual({});
  });

  it('caps maxOutputTokens if it exceeds the ceiling', async () => {
    const request = { 
      auth: { uid: 'u1' }, 
      data: { 
        model: 'gemini-3.8-flash', 
        contents: 'hi',
        config: { maxOutputTokens: 999999 } 
      } 
    } as any;
    
    mockGenerateContent.mockResolvedValue({ text: 'ok' });

    await handler(request);

    expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        maxOutputTokens: 32768,
      }),
    }));
  });
});
