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
 * Audio mixer hook for LegacyBot session recording.
 *
 * Manages the browser audio pipeline that:
 *   1. Captures the user's microphone input (getUserMedia)
 *   2. Provides a mixed audio destination where both user and bot audio
 *      are combined for archival recording
 *   3. Runs a MediaRecorder on the mixed stream, producing a WebM/Opus
 *      blob at 128 kbps
 *
 * Architecture (from design.md §3.3):
 *
 *   getUserMedia ──→ userNode ──→ mixedDest ──→ MediaRecorder ──→ GCS
 *                                    ↑
 *   Gemini audio ──→ botNode  ──────┘
 *
 * The MediaRecorder uses `timeslice` (10s) to emit chunks periodically.
 * This enables partial session recovery — if the connection drops, we
 * can still upload whatever audio was captured up to that point.
 *
 * References: design.md §3.3 | GitHub Issues #8, #9
 */

import { useRef, useCallback } from 'react';

/** The interval (ms) at which MediaRecorder emits data chunks. */
const TIMESLICE_MS = 10_000;

/** Target bitrate for the archived audio (128 kbps WebM/Opus). */
const AUDIO_BITRATE = 128_000;

export interface AudioMixerHandle {
  /** The user's microphone MediaStream (for sending PCM to Gemini). */
  stream: MediaStream | null;
  /** The AudioContext used for playback (24kHz for Gemini output). */
  playbackContext: AudioContext | null;
  /** The AudioContext used for input processing (16kHz for Gemini input). */
  inputContext: AudioContext | null;
  /** The mixed destination node — connect bot audio sources here for archival. */
  mixedDest: MediaStreamAudioDestinationNode | null;
  /** Start the mixer: request mic, set up AudioContexts, start MediaRecorder. */
  start: () => Promise<void>;
  /** Stop the mixer: stop MediaRecorder and mic, return the recorded audio blob. */
  stop: () => Promise<Blob | null>;
  /** Flush current audio chunks without stopping (for partial recovery). */
  flush: () => Blob | null;
}

/**
 * Hook that manages the audio pipeline for a live session.
 * Call `start()` before connecting to Gemini, and `stop()` when ending
 * the session. Use `flush()` to get a partial recording on disconnect.
 */
export function useAudioMixer(): AudioMixerHandle {
  const streamRef = useRef<MediaStream | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const mixedDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const start = useCallback(async () => {
    // Request microphone access
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        throw Object.assign(new Error('Microphone access denied. Please allow microphone access in your browser settings.'), { name: 'NotAllowedError' });
      }
      if (err.name === 'NotFoundError') {
        throw Object.assign(new Error('No microphone found. Please connect a microphone and try again.'), { name: 'NotFoundError' });
      }
      throw Object.assign(new Error('Could not access microphone. Please check your device and browser settings.'), { name: err.name });
    }
    streamRef.current = stream;

    // Create AudioContexts:
    //   - playbackContext at 24kHz (Gemini output sample rate)
    //   - inputContext at 16kHz (Gemini input sample rate)
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const playbackCtx = new AudioContextClass({ sampleRate: 24000 });
    const inputCtx = new AudioContextClass({ sampleRate: 16000 });
    playbackContextRef.current = playbackCtx;
    inputContextRef.current = inputCtx;

    // Set up the mixed destination for archival recording.
    // Both user mic and bot playback audio are routed here.
    const mixedDest = playbackCtx.createMediaStreamDestination();
    mixedDestRef.current = mixedDest;

    // Connect the user's mic to the mixed destination
    const userSource = playbackCtx.createMediaStreamSource(stream);
    userSource.connect(mixedDest);

    // Configure MediaRecorder for WebM/Opus at 128 kbps.
    // The timeslice parameter makes it emit data every 10 seconds,
    // enabling partial session recovery on disconnect.
    audioChunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const mediaRecorder = new MediaRecorder(mixedDest.stream, {
      mimeType,
      audioBitsPerSecond: AUDIO_BITRATE,
    });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        audioChunksRef.current.push(e.data);
      }
    };
    mediaRecorder.start(TIMESLICE_MS);
    mediaRecorderRef.current = mediaRecorder;
  }, []);

  const stop = useCallback(async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = () => {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          resolve(blob);
        };
        recorder.stop();
      } else {
        // Recorder already stopped or never started — return whatever we have
        resolve(
          audioChunksRef.current.length > 0
            ? new Blob(audioChunksRef.current, { type: 'audio/webm' })
            : null,
        );
      }

      // Stop all mic tracks
      streamRef.current?.getTracks().forEach((t) => t.stop());

      // Close AudioContexts
      playbackContextRef.current?.close();
      inputContextRef.current?.close();
    });
  }, []);

  /**
   * Flush collected audio chunks into a blob without stopping the recorder.
   * Used for partial session recovery when the Gemini connection drops
   * but we want to preserve everything captured so far.
   */
  const flush = useCallback((): Blob | null => {
    if (audioChunksRef.current.length === 0) return null;
    const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    audioChunksRef.current = [];
    return blob;
  }, []);

  return {
    get stream() {
      return streamRef.current;
    },
    get playbackContext() {
      return playbackContextRef.current;
    },
    get inputContext() {
      return inputContextRef.current;
    },
    get mixedDest() {
      return mixedDestRef.current;
    },
    start,
    stop,
    flush,
  };
}
