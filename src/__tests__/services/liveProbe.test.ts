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
 * The diagnostics page's Gemini Live probe (services/liveProbe.ts).
 *
 * The probe is a second Live code path: it opens a raw WebSocket instead of
 * going through VoiceCommon. These tests pin that it uses the one model
 * constant, the endpoint the SDK uses for ephemeral tokens, the thinking
 * config VoiceCommon derives for the model, and that it only reports success
 * on `setupComplete`. The live suite runs the same function against the real
 * API with a real token.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LIVE_API_VERSION, buildLiveConnectConfig, resolveThinkingConfig } from '@andyfooblah/voice-common';
import { LIVE_MODEL, LIVE_THINKING_LEVEL } from '../../services/gemini';
import { buildLiveProbeSetup, buildLiveProbeUrl, probeLiveSetup } from '../../services/liveProbe';
import type { ProbeSocket } from '../../services/liveProbe';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = 'auth_tokens/0123456789abcdef';

class FakeSocket implements ProbeSocket {
  static instances: FakeSocket[] = [];
  binaryType = 'blob';
  onopen: ProbeSocket['onopen'] = null;
  onmessage: ProbeSocket['onmessage'] = null;
  onerror: ProbeSocket['onerror'] = null;
  onclose: ProbeSocket['onclose'] = null;
  sent: string[] = [];
  closed = false;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; }
}

function start(options: { timeoutMs?: number } = {}) {
  FakeSocket.instances = [];
  const promise = probeLiveSetup(TOKEN, { WebSocketImpl: FakeSocket, ...options });
  return { promise, socket: FakeSocket.instances[0] };
}

afterEach(() => vi.useRealTimers());

describe('buildLiveProbeUrl', () => {
  it('is the constrained endpoint with the token as access_token, on the version VoiceCommon pins', () => {
    expect(buildLiveProbeUrl(TOKEN)).toBe(
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${LIVE_API_VERSION}.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens%2F0123456789abcdef`,
    );
  });

  it('never uses the API-key form, which the server rejects for ephemeral tokens', () => {
    expect(buildLiveProbeUrl(TOKEN)).not.toContain('?key=');
    expect(buildLiveProbeUrl(TOKEN)).not.toMatch(/GenerativeService\.BidiGenerateContent\?/);
  });
});

describe('buildLiveProbeSetup', () => {
  it('names the model constant and asks for audio', () => {
    const { setup } = buildLiveProbeSetup();
    expect(setup.model).toBe(`models/${LIVE_MODEL}`);
    expect(setup.generationConfig.responseModalities).toEqual(['AUDIO']);
  });

  it('carries exactly the thinking config a real session would', () => {
    // The same registry lookup buildLiveConnectConfig does for the session.
    const session = buildLiveConnectConfig({ model: LIVE_MODEL, systemInstruction: 'x', thinkingLevel: LIVE_THINKING_LEVEL });
    const expected = resolveThinkingConfig(LIVE_MODEL, LIVE_THINKING_LEVEL);
    expect(session.thinkingConfig).toEqual(expected);
    const probe = buildLiveProbeSetup().setup.generationConfig;
    if (expected) expect(probe.thinkingConfig).toEqual({ thinkingLevel: expected.thinkingLevel });
    else expect(probe).not.toHaveProperty('thinkingConfig');
    // And the modality matches the session's.
    expect(probe.responseModalities).toEqual(session.responseModalities);
  });
});

describe('probeLiveSetup', () => {
  it('opens the probe URL and sends the setup message once the socket opens', async () => {
    const { promise, socket } = start();
    expect(socket.url).toBe(buildLiveProbeUrl(TOKEN));
    expect(socket.binaryType).toBe('arraybuffer');
    expect(socket.sent).toEqual([]);
    socket.onopen?.({});
    expect(socket.sent).toEqual([JSON.stringify(buildLiveProbeSetup())]);
    socket.onmessage?.({ data: '{"setupComplete":{}}' });
    await expect(promise).resolves.toBeUndefined();
    expect(socket.closed).toBe(true);
  });

  it('does NOT report success just because the socket opened', async () => {
    vi.useFakeTimers();
    const { promise, socket } = start({ timeoutMs: 6000 });
    const outcome = vi.fn();
    promise.then(() => outcome('resolved'), (e: Error) => outcome(e.message));
    socket.onopen?.({});
    await vi.advanceTimersByTimeAsync(5999);
    expect(outcome).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(outcome).toHaveBeenCalledWith(`${LIVE_MODEL}: no setupComplete within 6000 ms`);
    expect(socket.closed).toBe(true);
  });

  it('accepts setupComplete delivered as a binary frame (how browsers receive it)', async () => {
    const { promise, socket } = start();
    socket.onopen?.({});
    socket.onmessage?.({ data: new TextEncoder().encode('{\n  "setupComplete": {}\n}\n').buffer });
    await expect(promise).resolves.toBeUndefined();
  });

  it('ignores frames that are not setupComplete', async () => {
    const { promise, socket } = start();
    socket.onopen?.({});
    socket.onmessage?.({ data: 'not json' });
    socket.onmessage?.({ data: '{"serverContent":{}}' });
    socket.onmessage?.({ data: '{"setupComplete":{}}' });
    await expect(promise).resolves.toBeUndefined();
  });

  it('reports a rejected setup with the server close code and reason', async () => {
    const { promise, socket } = start();
    socket.onopen?.({});
    socket.onclose?.({ code: 1007, reason: 'Thinking level is not supported for this model.' });
    await expect(promise).rejects.toThrow(
      `${LIVE_MODEL}: setup rejected (close 1007: Thinking level is not supported for this model.)`,
    );
  });

  it('reports a socket error', async () => {
    const { promise, socket } = start();
    socket.onerror?.({});
    await expect(promise).rejects.toThrow(`${LIVE_MODEL}: WebSocket failed`);
  });

  it('never puts the token in an error message', async () => {
    for (const fail of [
      (s: FakeSocket) => s.onclose?.({ code: 1008, reason: 'nope' }),
      (s: FakeSocket) => s.onerror?.({}),
    ]) {
      const { promise, socket } = start();
      fail(socket);
      const message = await promise.then(() => '', (e: Error) => e.message);
      expect(message).not.toBe('');
      expect(message).not.toContain('auth_tokens');
      expect(message).not.toContain('0123456789abcdef');
    }
  });
});

describe('SystemDiagnostics uses the probe', () => {
  const source = fs.readFileSync(
    path.resolve(HERE, '../../components/shared/SystemDiagnostics.tsx'),
    'utf8',
  );

  it('mints a token through the broker and hands it to probeLiveSetup', () => {
    expect(source).toMatch(/const \{ token \} = await mintGeminiLiveToken\(\);\s*await probeLiveSetup\(token\);/);
  });

  it('opens no WebSocket of its own', () => {
    expect(source).not.toMatch(/new WebSocket\(/);
    expect(source).not.toContain('BidiGenerateContent?');
    expect(source).not.toContain('wss://');
  });
});
