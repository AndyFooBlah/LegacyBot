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
import { buildMintGeminiLiveTokenHandler } from '../liveToken';
import { HttpsError } from 'firebase-functions/v2/https';

// Mock the GoogleGenAI SDK
const mockCreateToken = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function() {
    return {
      authTokens: {
        create: mockCreateToken,
      },
    };
  }),
}));

// Mock rate limiting
vi.mock('../rateLimit', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('mintGeminiLiveToken', () => {
  const mockApiKey = () => 'test-api-key';
  const handler = buildMintGeminiLiveTokenHandler({ apiKey: mockApiKey });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws unauthenticated if no user is signed in', async () => {
    const request = { auth: null } as any;
    await expect(handler(request)).rejects.toThrow(
      new HttpsError('unauthenticated', 'Sign-in required.')
    );
  });

  it('mints a token for an authenticated user', async () => {
    const request = { auth: { uid: 'user-123' } } as any;
    mockCreateToken.mockResolvedValue({ name: 'ephemeral-token-abc' });

    const result = await handler(request);

    expect(result.token).toBe('ephemeral-token-abc');
    expect(result.expireTime).toBeDefined();
    expect(mockCreateToken).toHaveBeenCalledWith({
      config: expect.objectContaining({
        uses: 1,
      }),
    });
  });

  it('throws internal if GEMINI_API_KEY is missing', async () => {
    const brokenHandler = buildMintGeminiLiveTokenHandler({ apiKey: () => '' });
    const request = { auth: { uid: 'user-123' } } as any;
    await expect(brokenHandler(request)).rejects.toThrow(
      new HttpsError('internal', 'GEMINI_API_KEY is not configured on this server.')
    );
  });

  it('throws internal if token creation fails', async () => {
    const request = { auth: { uid: 'user-123' } } as any;
    mockCreateToken.mockRejectedValue(new Error('API error'));

    await expect(handler(request)).rejects.toThrow(
      new HttpsError('internal', 'Failed to mint Gemini Live token.')
    );
  });
});
