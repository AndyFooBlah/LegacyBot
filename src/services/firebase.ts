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
 * Firebase SDK initialization.
 *
 * This module initializes the Firebase app and exports the core service
 * instances used throughout LegacyBot:
 *   - auth:    Firebase Authentication (Google + Email/Password sign-in)
 *   - db:      Cloud Firestore (Dossiers, sessions, transcripts, questions)
 *   - storage: Cloud Storage for Firebase (archived session audio)
 *
 * All Firebase config values are read from Vite environment variables
 * (prefixed with VITE_) defined in .env.local. See the project README
 * for required environment variable setup.
 *
 * References: design.md §1.1, §3.1 | GitHub Issue #1
 */

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

/**
 * Validates that all required Firebase config values are present.
 * Fails fast at startup rather than producing cryptic errors later.
 */
const REQUIRED_ENV_VARS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_APP_ID',
] as const;

const missing = REQUIRED_ENV_VARS.filter((key) => !import.meta.env[key]);
if (missing.length > 0) {
  throw new Error(
    `Missing required Firebase environment variables: ${missing.join(', ')}. ` +
      'Copy .env.example to .env.local and fill in your Firebase config values.',
  );
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** The root Firebase application instance. */
const app = initializeApp(firebaseConfig);

/** Firebase Authentication — used for Google & Email/Password sign-in. */
export const auth = getAuth(app);

/** Cloud Firestore — stores Dossiers, questions, sessions, and transcripts. */
export const db = getFirestore(app);

/** Cloud Storage for Firebase — stores archived session audio (WebM/Opus). */
export const storage = getStorage(app);

/** Cloud Functions for Firebase — used for server-side callables (memoir generation, etc.). */
export const functions = getFunctions(app);

export default app;
