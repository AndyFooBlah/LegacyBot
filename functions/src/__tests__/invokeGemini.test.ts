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
import { buildInvokeGeminiHandler } from '../invokeGemini';
import { HttpsError } from 'firebase-functions/v2/https';

const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function() {
    return {
      models: {
        generateContent: mockGenerateContent,
      },
    };
  }),
}));

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

  it('calls Gemini and returns the response', async () => {
    const request = { 
      auth: { uid: 'u1' }, 
      data: { model: 'gemini-2.5-flash', contents: [{ role: 'user', parts: [{ text: 'hi' }] }] } 
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
      model: 'gemini-2.5-flash',
    }));
  });

  it('caps maxOutputTokens if it exceeds the ceiling', async () => {
    const request = { 
      auth: { uid: 'u1' }, 
      data: { 
        model: 'gemini-2.5-flash', 
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
