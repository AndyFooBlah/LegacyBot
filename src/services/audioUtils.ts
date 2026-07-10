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
 * Audio encoding/decoding utilities for LegacyBot.
 *
 * Handles the low-level conversion between:
 *   - Raw PCM audio (Int16, 16kHz) used by the Gemini Live API
 *   - Base64-encoded strings for API transport
 *   - AudioBuffer objects for browser playback
 *
 * The Gemini Live API streams PCM audio in both directions:
 *   - Input:  16-bit PCM, 16kHz, mono (from getUserMedia via ScriptProcessor)
 *   - Output: 16-bit PCM, 24kHz, mono (decoded to AudioBuffer for playback)
 *
 * References: design.md §1.1, §3.3 | (migrated from original services/audioUtils.ts)
 */

/** Encode a Uint8Array to a base64 string for API transport. */
export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Decode a base64 string back to a Uint8Array. */
export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decode raw PCM Int16 data into a Web Audio API AudioBuffer.
 *
 * The Gemini API returns audio as raw Int16 PCM. We need to convert it
 * to Float32 samples and wrap it in an AudioBuffer for playback via
 * AudioBufferSourceNode.
 *
 * @param data       Raw PCM bytes (Int16 format)
 * @param ctx        The AudioContext to create the buffer with
 * @param sampleRate Expected sample rate (24000 for Gemini output)
 * @param numChannels Number of audio channels (1 = mono)
 */
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  if (!data || data.length === 0) {
    return ctx.createBuffer(numChannels, 0, sampleRate);
  }
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Convert Int16 [-32768, 32767] to Float32 [-1.0, 1.0]
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
