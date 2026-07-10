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
 * Tests for audio encoding/decoding utilities.
 *
 * These are pure functions with no side effects, making them ideal unit tests.
 * Focus areas:
 *   - encode/decode roundtrip integrity
 *   - Edge cases: empty input, large arrays, invalid base64
 *   - PCM Int16 ↔ Float32 conversion accuracy and boundary values
 *
 * References: design.md §5.3 (Priority 1) | src/services/audioUtils.ts
 */

import { describe, it, expect } from 'vitest';
import { encode, decode, decodeAudioData } from '../../services/audioUtils';

describe('encode / decode', () => {
  it('roundtrips a simple byte array', () => {
    const original = new Uint8Array([0, 1, 127, 128, 255]);
    const encoded = encode(original);
    const decoded = decode(encoded);
    expect(decoded).toEqual(original);
  });

  it('roundtrips an empty array', () => {
    const original = new Uint8Array(0);
    const encoded = encode(original);
    const decoded = decode(encoded);
    expect(decoded).toEqual(original);
  });

  it('roundtrips a single byte', () => {
    const original = new Uint8Array([42]);
    expect(decode(encode(original))).toEqual(original);
  });

  it('roundtrips all possible byte values (0-255)', () => {
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;
    expect(decode(encode(original))).toEqual(original);
  });

  it('handles a moderately large array (64KB — typical audio chunk)', () => {
    const original = new Uint8Array(65536);
    for (let i = 0; i < original.length; i++) original[i] = i % 256;
    expect(decode(encode(original))).toEqual(original);
  });

  it('produces valid base64 output', () => {
    const encoded = encode(new Uint8Array([72, 101, 108, 108, 111])); // "Hello"
    expect(encoded).toBe('SGVsbG8=');
  });

  it('decode throws on invalid base64 input', () => {
    expect(() => decode('!!!not-base64!!!')).toThrow();
  });
});

describe('decodeAudioData', () => {
  // Helper: create a mock AudioContext for decoding
  function createMockContext(sampleRate = 24000) {
    return new AudioContext({ sampleRate }) as unknown as AudioContext;
  }

  it('converts Int16 silence (0) to Float32 zero', async () => {
    const int16 = new Int16Array([0, 0, 0, 0]);
    const uint8 = new Uint8Array(int16.buffer);
    const ctx = createMockContext();

    const buffer = await decodeAudioData(uint8, ctx, 24000, 1);

    expect(buffer.numberOfChannels).toBe(1);
    const samples = buffer.getChannelData(0);
    expect(samples[0]).toBeCloseTo(0, 5);
    expect(samples[1]).toBeCloseTo(0, 5);
  });

  it('converts Int16 max (32767) to Float32 ~1.0', async () => {
    const int16 = new Int16Array([32767]);
    const uint8 = new Uint8Array(int16.buffer);
    const ctx = createMockContext();

    const buffer = await decodeAudioData(uint8, ctx, 24000, 1);
    const samples = buffer.getChannelData(0);

    // 32767 / 32768 ≈ 0.99997
    expect(samples[0]).toBeGreaterThan(0.999);
    expect(samples[0]).toBeLessThanOrEqual(1.0);
  });

  it('converts Int16 min (-32768) to Float32 -1.0', async () => {
    const int16 = new Int16Array([-32768]);
    const uint8 = new Uint8Array(int16.buffer);
    const ctx = createMockContext();

    const buffer = await decodeAudioData(uint8, ctx, 24000, 1);
    const samples = buffer.getChannelData(0);

    expect(samples[0]).toBe(-1.0);
  });

  it('converts a known signal correctly', async () => {
    // Quarter-amplitude: 8192/32768 = 0.25
    const int16 = new Int16Array([8192, -8192, 16384, -16384]);
    const uint8 = new Uint8Array(int16.buffer);
    const ctx = createMockContext();

    const buffer = await decodeAudioData(uint8, ctx, 16000, 1);
    const samples = buffer.getChannelData(0);

    expect(samples[0]).toBeCloseTo(0.25, 2);
    expect(samples[1]).toBeCloseTo(-0.25, 2);
    expect(samples[2]).toBeCloseTo(0.5, 2);
    expect(samples[3]).toBeCloseTo(-0.5, 2);
  });

  it('creates a buffer with the correct sample rate', async () => {
    const int16 = new Int16Array([0]);
    const uint8 = new Uint8Array(int16.buffer);
    const ctx = createMockContext(16000);

    const buffer = await decodeAudioData(uint8, ctx, 16000, 1);
    expect(buffer.sampleRate).toBe(16000);
  });

  it('handles an empty buffer', async () => {
    const uint8 = new Uint8Array(0);
    const ctx = createMockContext();

    const buffer = await decodeAudioData(uint8, ctx, 24000, 1);
    expect(buffer.length).toBe(0);
  });

  it('handles multi-channel (stereo) audio', async () => {
    // Interleaved stereo: [L0, R0, L1, R1]
    const int16 = new Int16Array([0, 32767, 32767, 0]);
    const uint8 = new Uint8Array(int16.buffer);
    const ctx = createMockContext();

    const buffer = await decodeAudioData(uint8, ctx, 24000, 2);

    expect(buffer.numberOfChannels).toBe(2);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    expect(left[0]).toBeCloseTo(0, 5); // L0 = 0
    expect(right[0]).toBeGreaterThan(0.999); // R0 = max
    expect(left[1]).toBeGreaterThan(0.999); // L1 = max
    expect(right[1]).toBeCloseTo(0, 5); // R1 = 0
  });
});
