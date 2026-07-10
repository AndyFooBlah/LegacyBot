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
 * Client-side wrappers for admin Cloud Functions.
 * These call Firebase callable functions for operations that
 * require the Admin SDK (email changes, password resets).
 */

import { getFunctions, httpsCallable, Functions } from 'firebase/functions';

let _functions: Functions | null = null;
function functions(): Functions {
  if (!_functions) _functions = getFunctions();
  return _functions;
}

/**
 * Update a family member's email address.
 * Requires the caller to be a family admin.
 */
export async function updateMemberEmail(
  familyId: string,
  targetUid: string,
  newEmail: string,
): Promise<void> {
  const fn = httpsCallable(functions(), 'updateMemberEmail');
  await fn({ familyId, targetUid, newEmail });
}

/**
 * Generate a password reset link for a family member.
 * Returns the reset link URL.
 */
export async function resetMemberPassword(
  familyId: string,
  targetUid: string,
): Promise<string> {
  const fn = httpsCallable<{ familyId: string; targetUid: string }, { resetLink: string }>(
    functions(),
    'resetMemberPassword',
  );
  const result = await fn({ familyId, targetUid });
  return result.data.resetLink;
}
