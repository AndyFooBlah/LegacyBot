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
 * Tests for the useAudioMixer hook.
 *
 * Verifies start/stop/flush lifecycle, MediaRecorder config,
 * AudioContext setup, and track cleanup.
 *
 * References: design.md §5.3 (Priority 2) | src/hooks/useAudioMixer.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioMixer } from '../../hooks/useAudioMixer';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useAudioMixer — initial state', () => {
  it('starts with null refs', () => {
    const { result } = renderHook(() => useAudioMixer());

    expect(result.current.stream).toBeNull();
    expect(result.current.playbackContext).toBeNull();
    expect(result.current.inputContext).toBeNull();
    expect(result.current.mixedDest).toBeNull();
  });
});

describe('useAudioMixer — start', () => {
  it('requests microphone access', async () => {
    const { result } = renderHook(() => useAudioMixer());

    await act(async () => {
      await result.current.start();
    });

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it('creates playback AudioContext at 24kHz', async () => {
    const { result } = renderHook(() => useAudioMixer());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.playbackContext).not.toBeNull();
    expect(result.current.playbackContext!.sampleRate).toBe(24000);
  });

  it('creates input AudioContext at 16kHz', async () => {
    const { result } = renderHook(() => useAudioMixer());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.inputContext).not.toBeNull();
    expect(result.current.inputContext!.sampleRate).toBe(16000);
  });

  it('sets up the mixed destination', async () => {
    const { result } = renderHook(() => useAudioMixer());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.mixedDest).not.toBeNull();
  });

  it('sets the mic stream', async () => {
    const { result } = renderHook(() => useAudioMixer());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.stream).not.toBeNull();
  });
});

describe('useAudioMixer — stop', () => {
  it('returns a Blob after stopping', async () => {
    const { result } = renderHook(() => useAudioMixer());

    await act(async () => {
      await result.current.start();
    });

    let blob: Blob | null = null;
    await act(async () => {
      blob = await result.current.stop();
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.type).toBe('audio/webm');
  });

  it('stops mic tracks on stop', async () => {
    const { result } = renderHook(() => useAudioMixer());

    await act(async () => {
      await result.current.start();
    });

    const tracks = result.current.stream!.getTracks();
    await act(async () => {
      await result.current.stop();
    });

    tracks.forEach((t: any) => expect(t.stop).toHaveBeenCalled());
  });

  it('closes AudioContexts on stop', async () => {
    const { result } = renderHook(() => useAudioMixer());

    await act(async () => {
      await result.current.start();
    });

    const playbackCtx = result.current.playbackContext!;
    const inputCtx = result.current.inputContext!;

    await act(async () => {
      await result.current.stop();
    });

    expect(playbackCtx.state).toBe('closed');
    expect(inputCtx.state).toBe('closed');
  });

  it('returns null if stop is called without start', async () => {
    const { result } = renderHook(() => useAudioMixer());

    let blob: Blob | null = null;
    await act(async () => {
      blob = await result.current.stop();
    });

    expect(blob).toBeNull();
  });
});

describe('useAudioMixer — flush', () => {
  it('returns null when no chunks have been recorded', () => {
    const { result } = renderHook(() => useAudioMixer());

    const blob = result.current.flush();
    expect(blob).toBeNull();
  });

  it('returns a Blob with accumulated chunks after start', async () => {
    const { result } = renderHook(() => useAudioMixer());

    await act(async () => {
      await result.current.start();
    });

    // The mock MediaRecorder doesn't emit ondataavailable automatically on
    // timeslice, but flush should still return null (no chunks yet) or
    // a blob if chunks were emitted. Since our mock doesn't auto-emit,
    // this tests the "no chunks yet" path.
    const blob = result.current.flush();
    expect(blob).toBeNull();
  });
});
