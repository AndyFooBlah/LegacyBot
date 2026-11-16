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
 * Raw-WebSocket reachability probe for Gemini Live, used by the diagnostics
 * page (components/shared/SystemDiagnostics.tsx).
 *
 * It answers one question: would a real session get past setup right now?
 * So it does what a session does, minus the audio: open the endpoint the SDK
 * uses for an ephemeral token, send a setup message for `LIVE_MODEL` with the
 * thinking config VoiceCommon would send, and wait for `setupComplete`.
 *
 * Why not just wait for the socket to open: the server accepts the WebSocket
 * handshake for any URL and any token, and only validates when it reads the
 * setup message. A rejected token, model or thinking level arrives as a close
 * (1007 / 1008) after `onopen`. The previous probe resolved on `onopen` and
 * never sent a setup, so it was green whatever the model or token; and its
 * URL (`BidiGenerateContent?key=`) is one the server rejects for ephemeral
 * tokens ("API key not valid") as soon as a setup is sent. Measured
 * 2026-11-15; the live suite re-measures it (`npm run test:live`).
 *
 * No React, DOM or Firebase here. The WebSocket constructor is injectable so
 * the same code runs in the browser, in jsdom tests with a fake, and in Node.
 */

import { LIVE_API_VERSION, resolveThinkingConfig } from '@andyfooblah/voice-common';
import { LIVE_MODEL, LIVE_THINKING_LEVEL } from './gemini';

const LIVE_WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage';

/**
 * The endpoint `@google/genai` opens when its key is an ephemeral token
 * (`auth_tokens/...`): the constrained method, with the token as
 * `access_token`. Browsers cannot set WebSocket headers, so the query string
 * is the provider's protocol; the token is single-use and expires in minutes.
 */
export function buildLiveProbeUrl(token: string, apiVersion: string = LIVE_API_VERSION): string {
  return `${LIVE_WS_BASE}.${apiVersion}.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`;
}

export interface LiveProbeSetupMessage {
  setup: {
    model: string;
    generationConfig: {
      responseModalities: ['AUDIO'];
      thinkingConfig?: { thinkingLevel?: string };
    };
  };
}

/**
 * The smallest setup message a real session's would reduce to: the model
 * constant, the AUDIO modality, and the `thinkingConfig` VoiceCommon derives
 * for that model (none when the model rejects the field, as the current one does).
 */
export function buildLiveProbeSetup(): LiveProbeSetupMessage {
  const thinkingConfig = resolveThinkingConfig(LIVE_MODEL, LIVE_THINKING_LEVEL);
  return {
    setup: {
      model: `models/${LIVE_MODEL}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        ...(thinkingConfig ? { thinkingConfig: { thinkingLevel: thinkingConfig.thinkingLevel } } : {}),
      },
    },
  };
}

/** The slice of the WebSocket API the probe uses. */
export interface ProbeSocket {
  binaryType: string;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface ProbeLiveSetupOptions {
  /** Give up after this long. Default 6000 ms. */
  timeoutMs?: number;
  /** WebSocket constructor. Default: the global one. */
  WebSocketImpl?: new (url: string) => ProbeSocket;
  apiVersion?: string;
}

/** Server frames arrive as text or, in browsers, as binary (an ArrayBuffer). */
function frameToText(data: unknown): string {
  if (typeof data === 'string') return data;
  try {
    // `new Uint8Array(buffer)` rather than `instanceof ArrayBuffer`: the
    // buffer may come from another realm (an iframe, a test environment).
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data as ArrayBuffer);
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

/**
 * Resolve when the server answers the setup with `setupComplete`. Reject,
 * naming the model and the server's close code and reason, when it closes
 * first or does not answer in time. The token never appears in an error.
 */
export function probeLiveSetup(token: string, options: ProbeLiveSetupOptions = {}): Promise<void> {
  const Impl = options.WebSocketImpl ?? (WebSocket as unknown as new (url: string) => ProbeSocket);
  const timeoutMs = options.timeoutMs ?? 6000;
  return new Promise<void>((resolve, reject) => {
    const ws = new Impl(buildLiveProbeUrl(token, options.apiVersion));
    ws.binaryType = 'arraybuffer';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error(`${LIVE_MODEL}: no setupComplete within ${timeoutMs} ms`)),
      timeoutMs,
    );
    ws.onopen = () => ws.send(JSON.stringify(buildLiveProbeSetup()));
    ws.onmessage = (event) => {
      let message: { setupComplete?: unknown } | null = null;
      try { message = JSON.parse(frameToText(event.data)); } catch { /* not JSON: ignore */ }
      if (message && message.setupComplete !== undefined) finish();
    };
    ws.onerror = () => finish(new Error(`${LIVE_MODEL}: WebSocket failed`));
    ws.onclose = (event) =>
      finish(new Error(`${LIVE_MODEL}: setup rejected (close ${event?.code ?? 'unknown'}${event?.reason ? `: ${event.reason}` : ''})`));
  });
}
