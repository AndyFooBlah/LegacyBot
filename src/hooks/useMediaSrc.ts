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

import { useEffect, useState } from 'react';
import { resolveMediaSrc } from '../services/mediaAccess';

/**
 * Resolve a stored media reference (Storage path or legacy download URL) to a
 * usable src URL. Returns `null` while resolving or if there is no reference.
 *
 * Use this wherever a media object's stored `storageUrl` / `audioUrl` /
 * `clipUrl` was previously used directly as an <img>/<audio> src.
 */
export function useMediaSrc(value: string | undefined | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (!value) return;
    resolveMediaSrc(value)
      .then((resolved) => { if (!cancelled) setUrl(resolved); })
      .catch((err) => {
        console.error('[useMediaSrc] failed to resolve media URL:', err);
        if (!cancelled) setUrl(null);
      });
    return () => { cancelled = true; };
  }, [value]);

  return url;
}
