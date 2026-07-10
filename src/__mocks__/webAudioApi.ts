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
 * Browser audio API mocks for testing.
 *
 * Mocks AudioContext, MediaRecorder, getUserMedia, and related APIs so that
 * tests can verify the audio pipeline without real hardware or browser support.
 *
 * Each mock tracks calls and state so tests can assert against them:
 *   - MockAudioContext: tracks created buffers, connected nodes, close() calls
 *   - MockMediaRecorder: tracks start/stop, emits ondataavailable on demand
 *   - MockMediaStream: provides getTracks() with stoppable tracks
 */

import { vi } from 'vitest';

// --- AudioContext mock ---

class MockAudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  private channels: Float32Array[];

  constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = options.numberOfChannels;
    this.length = options.length;
    this.sampleRate = options.sampleRate;
    this.channels = Array.from(
      { length: options.numberOfChannels },
      () => new Float32Array(options.length),
    );
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

class MockAudioBufferSourceNode {
  buffer: MockAudioBuffer | null = null;
  private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  connect(_dest: any) { return _dest; }
  start(_when?: number) {
    // Simulate 'ended' event after a short delay
    setTimeout(() => this.dispatchEvent('ended'), 10);
  }
  stop() {}
  addEventListener(event: string, fn: (...args: unknown[]) => void) {
    (this.listeners[event] ??= []).push(fn);
  }
  private dispatchEvent(event: string) {
    (this.listeners[event] ?? []).forEach((fn) => fn());
  }
}

class MockMediaStreamDestination {
  stream = new MockMediaStream();
}

class MockScriptProcessor {
  onaudioprocess: ((e: any) => void) | null = null;
  connect(_dest: any) { return _dest; }
}

class MockMediaStreamSource {
  connect(_dest: any) { return _dest; }
}

class MockAudioContext {
  sampleRate: number;
  currentTime = 0;
  state: 'running' | 'closed' = 'running';

  constructor(options?: { sampleRate?: number }) {
    this.sampleRate = options?.sampleRate ?? 44100;
  }

  createBuffer(numChannels: number, length: number, sampleRate: number) {
    return new MockAudioBuffer({ numberOfChannels: numChannels, length, sampleRate });
  }
  createBufferSource() { return new MockAudioBufferSourceNode(); }
  createMediaStreamDestination() { return new MockMediaStreamDestination(); }
  createMediaStreamSource(_stream: any) { return new MockMediaStreamSource(); }
  createScriptProcessor(_bufferSize: number, _inputChannels: number, _outputChannels: number) {
    return new MockScriptProcessor();
  }
  get destination() { return {}; }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

// --- MediaRecorder mock ---

class MockMediaRecorder {
  static isTypeSupported(mimeType: string) {
    return mimeType.includes('audio/webm');
  }

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((e: any) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType: string;
  audioBitsPerSecond: number;

  constructor(_stream: any, options?: { mimeType?: string; audioBitsPerSecond?: number }) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
    this.audioBitsPerSecond = options?.audioBitsPerSecond ?? 128000;
  }

  start(_timeslice?: number) { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    // Simulate final data chunk
    this.ondataavailable?.({ data: new Blob(['mock-audio'], { type: this.mimeType }) });
    this.onstop?.();
  }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
}

// --- MediaStream mock ---

class MockMediaStream {
  private tracks = [{ stop: vi.fn(), kind: 'audio', enabled: true }];
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
}

// --- Install mocks globally ---

Object.defineProperty(globalThis, 'AudioContext', { value: MockAudioContext, writable: true });
Object.defineProperty(globalThis, 'MediaRecorder', { value: MockMediaRecorder, writable: true });
Object.defineProperty(globalThis, 'MediaStream', { value: MockMediaStream, writable: true });

if (!globalThis.navigator) {
  Object.defineProperty(globalThis, 'navigator', { value: {}, writable: true });
}
Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  value: {
    getUserMedia: vi.fn().mockResolvedValue(new MockMediaStream()),
  },
  writable: true,
});

// Export for direct use in tests
export {
  MockAudioContext,
  MockAudioBuffer,
  MockMediaRecorder,
  MockMediaStream,
};
