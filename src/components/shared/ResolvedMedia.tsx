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
 * <img> / <audio> that resolve a stored media reference (Storage path or legacy
 * download URL) to a short-lived signed URL before rendering. Use these in
 * lists so each item can call the resolver hook independently.
 */

import React from 'react';
import { useMediaSrc } from '../../hooks/useMediaSrc';

interface MediaImageProps {
  src: string | undefined | null;
  alt?: string;
  className?: string;
}

export function MediaImage({ src, alt, className }: MediaImageProps) {
  const resolved = useMediaSrc(src);
  if (!resolved) {
    // Keep the layout box while the signed URL resolves.
    return <div className={className} style={{ backgroundColor: '#f1f5f9' }} aria-label={alt} role="img" />;
  }
  return <img src={resolved} alt={alt} className={className} />;
}

type MediaAudioProps = { src: string | undefined | null } & React.AudioHTMLAttributes<HTMLAudioElement>;

export function MediaAudio({ src, ...rest }: MediaAudioProps) {
  const resolved = useMediaSrc(src);
  if (!resolved) return <div className={rest.className} />;
  return <audio src={resolved} {...rest} />;
}
