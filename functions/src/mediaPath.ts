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

import { HttpsError } from 'firebase-functions/v2/https';

/**
 * Validate a media object path and return the familyId it belongs to.
 * Rejects absolute/traversal paths and anything shallower than
 * `{familyId}/{dossierId}/{name}`.
 */
export function parseMediaPathFamilyId(path: unknown): string {
  if (typeof path !== 'string' || !path) {
    throw new HttpsError('invalid-argument', 'path is required.');
  }
  if (path.startsWith('/') || path.includes('..') || path.includes('//')) {
    throw new HttpsError('invalid-argument', 'Invalid path.');
  }
  const segments = path.split('/');
  if (segments.length < 3 || segments.some((s) => s.length === 0)) {
    throw new HttpsError('invalid-argument', 'Invalid media path.');
  }
  return segments[0];
}

/**
 * Canonical Storage object path for a session's audio recording. Mirrors the
 * client upload path in useUnifiedSession and the depth-3 rule in
 * storage.rules (`{familyId}/{dossierId}/{sessionId}.webm`).
 */
export function sessionAudioPath(familyId: string, dossierId: string, sessionId: string): string {
  return `${familyId}/${dossierId}/${sessionId}.webm`;
}

/**
 * True only if `audioPath` is exactly the canonical recording path for this
 * session. `session.audioUrl` is client-written (storytellers may update
 * their own sessions), so before the refinement pipeline downloads and
 * transcribes whatever it points at we must check it names this session's
 * own object — otherwise a caller could point it at another family's
 * recording and have it transcribed into their transcript (#166).
 */
export function isSessionAudioPath(
  audioPath: unknown,
  familyId: string,
  dossierId: string,
  sessionId: string,
): audioPath is string {
  return typeof audioPath === 'string' && audioPath === sessionAudioPath(familyId, dossierId, sessionId);
}
