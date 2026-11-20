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
import { readFileSync } from 'fs';
import { join } from 'path';
import { GoogleGenAI } from '@google/genai';
import { buildMintGeminiLiveTokenHandler } from '../liveToken';
import {
  LIVE_TOKEN_API_VERSION,
  LIVE_TOKEN_MODEL_CONSTRAINT,
  NEW_SESSION_WINDOW_MS,
  TOKEN_TTL_MS,
  buildLiveTokenRequest,
} from '../liveTokenConfig';
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

  it('mints with exactly the request and API version in liveTokenConfig', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T12:00:00.000Z'));
    try {
      mockCreateToken.mockResolvedValue({ name: 'auth_tokens/abc' });
      const result = await handler({ auth: { uid: 'user-123' } } as any);

      const expected = buildLiveTokenRequest(Date.parse('2026-11-15T12:00:00.000Z'));
      expect(mockCreateToken).toHaveBeenCalledTimes(1);
      expect(mockCreateToken).toHaveBeenCalledWith(expected);
      // The client is told the same expiry the provider was asked for.
      expect(result).toEqual({ token: 'auth_tokens/abc', expireTime: expected.config.expireTime });
      // The SDK client is built for the version the token must be minted on,
      // with the server-side key and nothing else.
      expect(vi.mocked(GoogleGenAI)).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        httpOptions: { apiVersion: LIVE_TOKEN_API_VERSION },
      });
    } finally {
      vi.useRealTimers();
    }
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

describe('liveTokenConfig', () => {
  const now = Date.parse('2026-11-15T12:00:00.000Z');

  it('asks for a single-use token: 30-minute expiry, 1 minute to open the session', () => {
    expect(TOKEN_TTL_MS).toBe(30 * 60 * 1000);
    expect(NEW_SESSION_WINDOW_MS).toBe(60 * 1000);
    expect(buildLiveTokenRequest(now)).toEqual({
      config: {
        uses: 1,
        expireTime: '2026-11-15T12:30:00.000Z',
        newSessionExpireTime: '2026-11-15T12:01:00.000Z',
        ...(LIVE_TOKEN_MODEL_CONSTRAINT ? { liveConnectConstraints: { model: LIVE_TOKEN_MODEL_CONSTRAINT } } : {}),
      },
    });
  });

  it('mints on an API version that serves authTokens.create', () => {
    // v1 (the SDK default) returns 404 for authTokens.create.
    expect(['v1alpha', 'v1beta']).toContain(LIVE_TOKEN_API_VERSION);
  });

  it('a model lock, if one is ever added, matches the client model constant', () => {
    // functions/ cannot import from src/, so read the client constant off disk
    // (the same approach as models.test.ts).
    const frontend = readFileSync(join(__dirname, '../../../src/services/gemini.ts'), 'utf8');
    const match = frontend.match(/export const LIVE_MODEL = '([^']+)'/);
    expect(match, 'LIVE_MODEL not found in src/services/gemini.ts').toBeTruthy();
    if (LIVE_TOKEN_MODEL_CONSTRAINT !== null) {
      expect(LIVE_TOKEN_MODEL_CONSTRAINT).toBe(match![1]);
    }
    const request = buildLiveTokenRequest(now);
    expect(request.config.liveConnectConstraints?.model ?? null).toBe(LIVE_TOKEN_MODEL_CONSTRAINT);
  });

  it('imports nothing, so the client tests and the live suite can load it', () => {
    const source = readFileSync(join(__dirname, '../liveTokenConfig.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});
