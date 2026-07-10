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
 * Resolve a stored media reference to a usable URL.
 *
 * Session audio, media, clips, and prompt photos now store the Storage object
 * PATH (e.g. `{familyId}/{dossierId}/file.webm`) rather than a persisted, never-
 * expiring getDownloadURL() token. This module exchanges a path for a short-
 * lived signed URL via the `getMediaUrl` callable, which re-checks family
 * membership on every call.
 *
 * Legacy documents created before this change stored a full `https://` download
 * URL; those are returned unchanged so old media keeps working.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

// Constructed lazily (inside resolveMediaSrc) rather than at module load so
// importing this module has no side effects — component tests that mock
// `./firebase` without a `functions` export don't break just by rendering.
function callGetMediaUrl(path: string): Promise<{ data: { url: string } }> {
  return httpsCallable<{ path: string }, { url: string }>(functions, 'getMediaUrl')({ path });
}

// Signed URLs are valid ~2h; cache them a little more conservatively so we
// never hand back one that's about to expire mid-render.
const CACHE_TTL_MS = 90 * 60 * 1000; // 90 minutes
const cache = new Map<string, { url: string; expiresAt: number }>();

/** A stored reference is a legacy download URL if it's absolute http(s). */
export function isLegacyUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Resolve a stored media reference (path or legacy URL) to a fetchable URL.
 * Returns null for empty input. Throws if the callable fails (caller decides
 * how to surface it).
 */
export async function resolveMediaSrc(value: string | undefined | null): Promise<string | null> {
  if (!value) return null;
  if (isLegacyUrl(value)) return value;

  const cached = cache.get(value);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.url;

  const { data } = await callGetMediaUrl(value);
  cache.set(value, { url: data.url, expiresAt: now + CACHE_TTL_MS });
  return data.url;
}
