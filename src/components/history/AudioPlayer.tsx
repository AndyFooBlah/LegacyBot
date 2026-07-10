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
 * AudioPlayer — playback controls for archived session audio.
 *
 * Uses a custom progress bar driven by the session's known duration
 * (from Firestore) because WebM files from MediaRecorder don't include
 * duration in the file header, causing the native <audio> slider to
 * behave erratically.
 *
 * References: product_requirements.md §3.6 | GitHub Issue #15
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';

interface AudioPlayerProps {
  audioUrl: string;
  durationSeconds?: number;
  onCreateClip?: (startSeconds: number, endSeconds: number) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioUrl, durationSeconds, onCreateClip }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [clipping, setClipping] = useState(false);
  const [clipStart, setClipStart] = useState<number | null>(null);
  const [clipEnd, setClipEnd] = useState<number | null>(null);

  // Update duration from metadata if we don't have it from props,
  // but only if it's a finite value (WebM files often report Infinity)
  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (audio && isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => { setPlaying(false); setCurrentTime(0); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [handleLoadedMetadata]);

  function togglePlayPause() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = fraction * duration;
    setCurrentTime(audio.currentTime);
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (!audioUrl) return null;

  return (
    <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 space-y-3">
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
        Session Audio
      </label>

      <audio ref={audioRef} src={audioUrl} preload="auto" />

      <div className="flex items-center gap-3">
        {/* Play/Pause button */}
        <button
          onClick={togglePlayPause}
          className="w-10 h-10 flex items-center justify-center bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition-colors shrink-0"
        >
          {playing ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Progress bar */}
        <div
          className="flex-1 h-2 bg-slate-200 rounded-full cursor-pointer relative"
          onClick={handleSeek}
        >
          <div
            className="h-full bg-indigo-500 rounded-full transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Time display */}
        <span className="text-xs text-slate-500 font-mono tabular-nums shrink-0">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      {/* Clip controls */}
      {onCreateClip && (
        <div className="flex items-center gap-3">
          {!clipping ? (
            <button
              onClick={() => { setClipping(true); setClipStart(null); setClipEnd(null); }}
              className="text-xs text-indigo-600 font-medium hover:underline"
            >
              Create clip
            </button>
          ) : (
            <>
              <button
                onClick={() => setClipStart(currentTime)}
                className="text-xs px-3 py-1 rounded-full font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
              >
                {clipStart !== null ? `Start: ${formatTime(clipStart)}` : 'Set start'}
              </button>
              <button
                onClick={() => setClipEnd(currentTime)}
                className="text-xs px-3 py-1 rounded-full font-medium bg-amber-50 text-amber-600 hover:bg-amber-100"
              >
                {clipEnd !== null ? `End: ${formatTime(clipEnd)}` : 'Set end'}
              </button>
              {clipStart !== null && clipEnd !== null && clipEnd > clipStart && (
                <button
                  onClick={() => {
                    onCreateClip(clipStart, clipEnd);
                    setClipping(false);
                    setClipStart(null);
                    setClipEnd(null);
                  }}
                  className="text-xs px-3 py-1.5 rounded-full font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  Save clip ({formatTime(clipEnd - clipStart)})
                </button>
              )}
              <button
                onClick={() => { setClipping(false); setClipStart(null); setClipEnd(null); }}
                className="text-xs text-slate-400 hover:underline"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
