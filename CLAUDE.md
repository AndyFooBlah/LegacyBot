# LegacyBot — Claude Code Instructions

## 🔑 Sensitive API keys — read first

`GEMINI_API_KEY` and `GOOGLE_MAPS_API_KEY` are **server-side only**. They live in Firebase Secret Manager and are accessed only by Cloud Functions. They must NEVER appear in:

- A `VITE_*` env var (Vite bakes the entire `import.meta.env` object into the bundle, so even an unreferenced `.env.local` entry leaks)
- Any file under `src/` — directly, in fallbacks, in comments-as-examples, or in test fixtures that touch real values
- Any committed file (including `.env.example`, `dist/`, docs)

The browser reaches Gemini exclusively via the broker callables in `services/geminiBroker.ts`:

| Need | Use |
|---|---|
| Gemini Live WebSocket session | `mintGeminiLiveToken()` → ephemeral token (~30 min, single-use) |
| `ai.models.generateContent` | `invokeGemini({ model, contents, config? })` |
| `ai.models.embedContent` | `embedGemini({ model, contents })` |

**Two automated guards stop accidental regressions:**

1. **ESLint** (`eslint.config.js`) — `no-restricted-syntax` errors on any read of `import.meta.env.VITE_GEMINI_*`, `VITE_GOOGLE_MAPS_*`, or `VITE_*_(SECRET|TOKEN)`. Each rule fires with a message naming the broker callable to use instead.
2. **Post-build bundle scan** (`scripts/check-bundle-for-secrets.mjs`, run as part of `npm run build`) — greps `dist/` for `AIza...`, `sk-...`, `ya29...`, `xox*-...`, `gh*_...`, GCP service-account JSON shapes. The Firebase web `apiKey` is auto-allowlisted from `.env.local`. Anything else fails the build.

If either guard fires, **fix the leak**; do not weaken the rule. If you find yourself wanting to add `BUNDLE_KEY_ALLOWLIST=...` to bypass the scan for something that isn't the Firebase web key, stop and reconsider — that's almost always the wrong move.

To rotate the server-side Gemini key: `firebase functions:secrets:set GEMINI_API_KEY`, then redeploy functions.

## After any material change

Before considering a task complete, ensure all of the following are done:

1. **Tests** — verify tests exist for the changed behavior and all tests pass:
   ```bash
   npm test -- --run
   ```
2. **Docs** — update `design.md` if architecture, data model, or data flow changed
3. **Commit** — commit all changed files with a descriptive message
4. **Push** — push to `origin/main`
5. **Issues** — close the relevant GitHub issue(s) with a comment referencing the commit

## Dev commands

```bash
npm test -- --run          # run all tests once
npm run test:watch         # watch mode
npx tsc --noEmit           # type-check only
npx eslint src --ext .ts,.tsx   # lint

cd functions && npm run build && cd ..   # REQUIRED before deploying functions
firebase deploy --only functions
firebase deploy --only firestore:rules,storage
```

## Agent Skills

### Firestore vector search
If you need to create, debug, or modify Firestore vector indexes or `findNearest()` calls, **consult the skill first**:

```
/firestore-vector-search
```

Or read it directly: `.claude/skills/firestore-vector-search/SKILL.md`

It documents every failure mode encountered during the original implementation: plain arrays vs VectorValue, deprecated positional API, index creation via gcloud (not firebase deploy), stale compiled JS, migration of existing documents, and how to read Cloud Function application logs.

## Architecture notes

### Firebase Auth custom claims (`familyIds`)
Storage security rules cannot query Firestore. Family membership is propagated into the Firebase Auth token as a `familyIds: string[]` custom claim, set by the `onMemberWritten` Cloud Function (Firestore trigger on `families/{familyId}/members/{memberId}`). Clients must call `user.getIdToken(true)` after joining a family before accessing Cloud Storage.

### Story Queue is the source of truth for questions
`saveGapAnalysis()` in `functions/src/analysis.ts` writes AI-generated questions directly into the `questions` subcollection (with `source: 'gapAnalysis'`). The Story Queue UI reads from `questions`, not from `analysis/gapAnalysis`. Stale Unasked gap questions are deleted before new ones are written.

### ESLint config
Flat config (`eslint.config.js`). Notable intentional rule overrides:
- `no-console: 'off'` — used throughout for logging
- `react-hooks/set-state-in-effect: 'off'` — intentional pattern in this codebase
- `@typescript-eslint/no-explicit-any: 'off'` — scoped to test/mock files only

### License headers
All source files carry an Apache 2.0 header (Copyright 2026 Andrew Brook). Add the header to any new `.ts`, `.tsx`, or `.js` file:
```
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
```
