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
 * LIVE: the token broker's half of the production path, and the diagnostics
 * probe.
 *
 * In production a signed-in browser calls the `mintGeminiLiveToken` callable,
 * which mints a single-use ephemeral token, and VoiceCommon opens the Live
 * session with it. This file runs everything after the callable's sign-in
 * and rate-limit checks for real:
 *   - mint a token with the request and API version the callable uses
 *     (functions/src/liveTokenConfig.ts), with the Cloud Functions package's
 *     own copy of the SDK when it is installed;
 *   - open a session with that token and the full production config, on the
 *     API version VoiceCommon pins, and run the greeting turn;
 *   - confirm the token really is single use;
 *   - run the diagnostics page's raw-WebSocket probe (services/liveProbe.ts)
 *     with a real token.
 *
 * Not covered: Firebase sign-in, the callable's auth and rate-limit checks,
 * and the browser. See TESTING.md, "What is not covered".
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';
import { GoogleGenAI } from '@google/genai';
import { LIVE_API_VERSION, LiveSetupError, LiveTestSession } from '@andyfooblah/voice-common/testing';
import { LIVE_TOKEN_API_VERSION, buildLiveTokenRequest } from '../../../functions/src/liveTokenConfig';
import { LIVE_MODEL } from '../../services/gemini';
import { buildLiveProbeUrl, probeLiveSetup } from '../../services/liveProbe';
import { buildFurtadoSessionInputs } from './furtadoSession';
import { LIVE_API_KEY, customCheck, describeLive, redact, targetFor } from './liveEnv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = path.resolve(HERE, '../../../functions');

type GenAICtor = typeof GoogleGenAI;

/**
 * The SDK the deployed callable runs: functions/ pins its own
 * `@google/genai`, which can be a different major from the web client's. Use
 * it when functions/node_modules is installed; otherwise the client's.
 */
function brokerSdk(): { GoogleGenAI: GenAICtor; version: string } {
  try {
    const require = createRequire(path.join(FUNCTIONS_DIR, 'package.json'));
    const entry = require.resolve('@google/genai');
    if (entry.startsWith(FUNCTIONS_DIR)) {
      const pkgPath = path.join(FUNCTIONS_DIR, 'node_modules', '@google', 'genai', 'package.json');
      const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version as string;
      return { GoogleGenAI: (require('@google/genai') as { GoogleGenAI: GenAICtor }).GoogleGenAI, version: `functions ${version}` };
    }
  } catch {
    // functions/ dependencies are not installed: fall through.
  }
  return { GoogleGenAI, version: 'client copy' };
}

/** Mint exactly as functions/src/liveToken.ts does. */
async function mintLikeTheBroker(): Promise<{ token: string; sdk: string }> {
  const { GoogleGenAI: Ctor, version } = brokerSdk();
  const ai = new Ctor({ apiKey: LIVE_API_KEY, httpOptions: { apiVersion: LIVE_TOKEN_API_VERSION } });
  const token = await ai.authTokens.create(buildLiveTokenRequest(Date.now()));
  if (!token?.name) throw new Error('authTokens.create returned no token');
  return { token: token.name, sdk: version };
}

describeLive(`live: broker-minted token → production session on ${LIVE_MODEL}`, () => {
  const inputs = buildFurtadoSessionInputs('returning');
  const target = targetFor(inputs);

  it('a token minted the way the callable mints it opens a production session and the bot greets', async () => {
    await customCheck('token broker', 'broker-token-session', async () => {
      const { token, sdk } = await mintLikeTheBroker();
      const startedAt = Date.now();
      const session = await LiveTestSession.connect({
        ephemeralToken: token,
        model: target.model,
        config: target.config,
        apiVersion: LIVE_API_VERSION,
      });
      try {
        const setupMs = Date.now() - startedAt;
        const since = session.mark();
        session.sendText(inputs.greetingTrigger);
        const audio = await session.waitForType('audio', 30_000, { since });
        await session.waitForType('turnComplete', 45_000, { since: session.trace.indexOf(audio) });
        const greeting = session.outputText(since).trim();
        if (!greeting) throw new Error('no greeting transcript');
        return {
          detail: `minted on ${LIVE_TOKEN_API_VERSION}, connected on ${LIVE_API_VERSION}, greeted: "${greeting.slice(0, 50)}"`,
          metrics: { mintSdk: sdk, mintApiVersion: LIVE_TOKEN_API_VERSION, connectApiVersion: LIVE_API_VERSION, setupMs, audioBytes: session.audioBytes(since) },
        };
      } finally {
        await session.close();
      }
    });
  });

  it('the token is single use: a second session with it is refused', async () => {
    await customCheck('token broker', 'broker-token-single-use', async () => {
      const { token } = await mintLikeTheBroker();
      const first = await LiveTestSession.connect({ ephemeralToken: token, model: target.model, config: target.config });
      await first.close();
      let refused: LiveSetupError | null = null;
      try {
        const second = await LiveTestSession.connect({ ephemeralToken: token, model: target.model, config: target.config, connectTimeoutMs: 10_000 });
        await second.close();
      } catch (err) {
        if (err instanceof LiveSetupError) refused = err;
        else throw err;
      }
      if (!refused) throw new Error('a used token opened a second session: `uses: 1` is not being enforced');
      return { detail: `second use refused (${refused.code ?? 'no close code'}: ${redact(refused.reason).slice(0, 80)})`, metrics: { closeCode: refused.code ?? -1 } };
    });
  });
});

describeLive(`live: the diagnostics probe on ${LIVE_MODEL}`, () => {
  it('probeLiveSetup reaches setupComplete with a broker-minted token', async () => {
    await customCheck('diagnostics probe', 'probe-setup', async () => {
      const { token } = await mintLikeTheBroker();
      const startedAt = Date.now();
      await probeLiveSetup(token, { timeoutMs: 10_000 });
      return { detail: 'setup message for the model constant accepted on the constrained endpoint', metrics: { ms: Date.now() - startedAt } };
    });
  });

  it('probeLiveSetup fails for a token the server does not know (it is not vacuously green)', async () => {
    await customCheck('diagnostics probe', 'probe-rejects-bad-token', async () => {
      const outcome = await probeLiveSetup('auth_tokens/this-token-does-not-exist', { timeoutMs: 10_000 }).then(
        () => null,
        (err: Error) => err.message,
      );
      if (outcome === null) throw new Error('the probe reported success for a made-up token');
      expect(outcome).toContain(LIVE_MODEL);
      return { detail: `rejected: ${redact(outcome).slice(0, 100)}` };
    });
  });

  it('the API-key URL form the probe used before is refused for an ephemeral token', async () => {
    // Recorded so the reason for the constrained endpoint stays measured: if
    // the provider starts accepting this form, this test says so.
    await customCheck('diagnostics probe', 'legacy-url-refused', async () => {
      const { token } = await mintLikeTheBroker();
      const legacyUrl = buildLiveProbeUrl(token)
        .replace('BidiGenerateContentConstrained', 'BidiGenerateContent')
        .replace('access_token=', 'key=');
      class LegacySocket extends WebSocket {
        constructor() {
          super(legacyUrl);
        }
      }
      const outcome = await probeLiveSetup(token, { timeoutMs: 10_000, WebSocketImpl: LegacySocket as never }).then(
        () => null,
        (err: Error) => err.message,
      );
      if (outcome === null) {
        return { status: 'warn' as const, detail: 'the server now accepts an ephemeral token on BidiGenerateContent?key=; the constrained endpoint is still what the SDK uses' };
      }
      return { detail: `refused as expected: ${redact(outcome).slice(0, 100)}` };
    });
  });
});
