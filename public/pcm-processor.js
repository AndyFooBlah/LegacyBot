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
 * AudioWorklet processor for LegacyBot microphone capture.
 *
 * Runs on the dedicated audio thread (AudioWorkletGlobalScope) to capture
 * mic input as Float32 PCM and forward each frame to the main thread via
 * MessagePort. The main thread converts the data to Int16 PCM and streams
 * it to the Gemini Live API.
 *
 * Replaces the deprecated ScriptProcessorNode (GitHub Issue #76).
 */
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      // Copy Float32 data before transferring the buffer to avoid neutering
      // the original, which would corrupt further processing in this frame.
      const copy = new Float32Array(input[0]);
      this.port.postMessage({ channelData: copy }, [copy.buffer]);
    }
    return true; // Keep processor alive
  }
}

registerProcessor('pcm-processor', PCMProcessor);
