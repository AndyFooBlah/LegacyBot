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

// Helper function to convert Float32Array (from AudioBuffer) to Int16Array (PCM)
export function convertFloat32ToInt16(buffer: Float32Array): ArrayBuffer {
  let l = buffer.length;
  const buf = new Int16Array(l);
  while (l--) {
    buf[l] = Math.min(1, buffer[l]) * 0x7fff;
  }
  return buf.buffer;
}

// Simple Resampler (for demonstration purposes, a more robust one might be needed for production)
// This is a basic linear interpolation resampler.
export class Resampler {
  private fromSampleRate: number;
  private toSampleRate: number;
  private ratio: number;
  private tail: Float32Array;

  constructor(fromSampleRate: number, toSampleRate: number) {
    this.fromSampleRate = fromSampleRate;
    this.toSampleRate = toSampleRate;
    this.ratio = this.fromSampleRate / this.toSampleRate;
    this.tail = new Float32Array(0);
  }

  resample(buffer: Float32Array): Float32Array {
    const newLength = Math.round((buffer.length + this.tail.length) / this.ratio);
    const out = new Float32Array(newLength);
    const combined = new Float32Array(buffer.length + this.tail.length);
    combined.set(this.tail, 0);
    combined.set(buffer, this.tail.length);

    let i = 0;
    let lastWrite = 0;
    while (i < newLength) {
      const originalIndex = i * this.ratio;
      const floor = Math.floor(originalIndex);
      const ceil = Math.ceil(originalIndex);
      const frac = originalIndex - floor;

      if (ceil < combined.length) {
        out[i] = combined[floor] * (1 - frac) + combined[ceil] * frac;
        lastWrite = i;
      } else {
        break;
      }
      i++;
    }
    this.tail = combined.slice(Math.floor((lastWrite + 1) * this.ratio));
    return out.slice(0, lastWrite + 1);
  }
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}