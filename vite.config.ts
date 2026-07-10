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

import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  server: {
    port: 3003,
    host: '0.0.0.0',
  },
  plugins: [tailwindcss(), react()],
  resolve: {
    // Treat symlinked packages (e.g. file: npm deps like @andyfooblah/voicecommon)
    // as their canonical node_modules path so Rollup deduplicates them into a
    // single chunk instead of inlining separate copies into each lazy chunk.
    preserveSymlinks: true,
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Force a single copy of these singletons even when VoiceCommon/KnowledgeCommon
    // each have their own node_modules (they're installed as symlinks to source dirs).
    // Without this, React and Firebase end up with two instances — one initialized
    // by LegacyBot's root render, one in VC's bundle with a null dispatcher —
    // causing "Cannot read properties of null (reading 'useRef')" crashes.
    dedupe: ['react', 'react-dom', 'firebase', 'firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage', 'firebase/functions', '@google/genai'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Firebase — split auth/functions (small, needed at startup) from
          // firestore (large) and storage so they cache independently
          if (id.includes('node_modules/firebase/auth') || id.includes('node_modules/@firebase/auth')) {
            return 'vendor-firebase-auth';
          }
          if (id.includes('node_modules/firebase/functions') || id.includes('node_modules/@firebase/functions')) {
            return 'vendor-firebase-functions';
          }
          if (id.includes('node_modules/firebase/storage') || id.includes('node_modules/@firebase/storage')) {
            return 'vendor-firebase-storage';
          }
          if (
            id.includes('node_modules/firebase') ||
            id.includes('node_modules/@firebase')
          ) {
            return 'vendor-firebase';
          }
          // Google AI / Gemini SDK
          if (id.includes('node_modules/@google/genai') || id.includes('node_modules/@google-ai')) {
            return 'vendor-google-ai';
          }
          // html2canvas + jsPDF (PDF export) — heavy, rarely needed
          if (id.includes('node_modules/html2canvas')) {
            return 'vendor-html2canvas';
          }
          if (id.includes('node_modules/jspdf') || id.includes('node_modules/jsPDF')) {
            return 'vendor-jspdf';
          }
          // DOMPurify
          if (id.includes('node_modules/dompurify')) {
            return 'vendor-dompurify';
          }
          // React runtime — needed on every page, very stable cache target
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'vendor-react';
          }
          // React Router
          if (id.includes('node_modules/react-router') || id.includes('node_modules/@remix-run')) {
            return 'vendor-router';
          }
          // All other node_modules together
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
  },
});
