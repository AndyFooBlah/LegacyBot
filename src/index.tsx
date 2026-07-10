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
 * Application entry point.
 * Mounts the React app to the #root DOM element.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { initializeVoiceCommon } from '@andyfooblah/voice-common';
import { initializeKnowledgeCommon } from '@andyfooblah/knowledge-common';
import { db } from './services/firebase';
import {
  getJoke,
  searchPlace,
  getDistanceBetweenPlaces,
  getWeather,
  cacheWikipediaArticle,
} from './services/externalSearch';
import { mintGeminiLiveToken, invokeGemini, embedGemini } from './services/geminiBroker';

// LegacyBot initializes Firebase directly in src/services/firebase.ts.
// VoiceCommon must also be initialized so its internal `db` binding is set
// before any useSession call invokes createSession → collection(db, ...).
// _initFirebase() detects the existing Firebase app and reuses it.
initializeVoiceCommon({
  firebase: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  },
  // VoiceCommon's useSession calls tokenProvider() to obtain a single-use
  // ephemeral Gemini Live token from our server-side broker — the long-lived
  // GEMINI_API_KEY never reaches the browser.
  tokenProvider: mintGeminiLiveToken,
});

// KnowledgeCommon must be initialized before any direct import of its tools
// (e.g. searchWikipedia in useSession / SystemDiagnostics). Every Gemini call
// the library makes is routed through our server-side broker (the same
// invokeGemini + embedGemini callables used elsewhere in the app), so the
// long-lived GEMINI_API_KEY never reaches the browser. Maps/Weather/Jokes
// route through other Firebase callables; Wikipedia cache fills go through
// the admin-SDK callable so clients can never write (and thus poison) the
// shared wikipedia_cache collection directly.
initializeKnowledgeCommon({
  gemini: { invokeGemini, embedContent: embedGemini },
  firestore: db,
  toolOverrides: {
    searchPlace,
    getDistanceBetweenPlaces,
    getWeather,
    getJoke,
  },
  cacheWikipediaArticle,
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
