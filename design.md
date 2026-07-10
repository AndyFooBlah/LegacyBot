# Technical Design Document: LegacyBot

> **Public name:** This app is publicly branded as **BiographyBot** ([biographybot.com](https://biographybot.com)). The GitHub repository and codebase use "LegacyBot" for historical continuity.

## 1. System Architecture

LegacyBot (publicly: BiographyBot) is a React SPA using the Google Gemini Live API for real-time voice interaction and Firebase for auth, persistence, and backend functions.

### 1.1 Core Components

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite 6, React Router v7 — deployed to Firebase Hosting at **https://biographybot.com**
- **AI Core**: `@google/genai`. All models are Gemini 3.1 or newer — no earlier models are used anywhere.
  - Live session: `gemini-3.1-flash-live-preview` (`thinkingLevel: MINIMAL` for lowest latency)
  - Batch analysis (post-session, gap analysis, memoir): `gemini-3.1-pro-preview` (`thinkingLevel: HIGH`)
- **Auth**: Firebase Authentication (Google and Email/Password sign-in)
- **Persistence**:
  - **Firestore**: Families, dossiers, session metadata, transcripts, questions, events, memoirs, media, invitations
  - **Cloud Storage**: Session audio (WebM/Opus 128 kbps), media uploads, memoir exports
- **Backend**: Firebase Cloud Functions v1 (Node.js 20) — Firestore triggers, HTTPS callables, Pub/Sub schedule
- **Audio Pipeline**: `AudioWorkletNode` (`pcm-processor.js`) captures PCM for streaming; `AudioContext` + `MediaRecorder` mix bot/user audio for archival
- **Email**: Nodemailer via Gmail SMTP (`SMTP_PASS` Cloud Function secret)
- **License**: Apache 2.0 — Copyright 2026 Andrew Brook

### 1.2 High-Level Data Flow

```
Archivist (Auth) → Select Family → Select Dossier → Start Session → Gemini Live API
                                                                          ↕
                                                        Storyteller ←→ Voice I/O
                                                                          ↓
                                            Mixed Audio → Cloud Storage (WebM/Opus 128kbps)
                                            Transcripts → Firestore (real-time)
                                        Question State → Firestore (via function calling)
                                                Events → Firestore (post-session, client)
                                             Analysis → Firestore (Cloud Functions, server)
```

---

## 2. Data Model (Firestore)

### 2.1 Collections

```
users/{uid}
  - email: string
  - displayName: string
  - familyIds: string[]          # denormalized for client queries
  - timezone: string             # IANA e.g. "America/Los_Angeles", written on every login
  - createdAt: timestamp

families/{familyId}
  - name: string
  - createdAt: timestamp
  - createdBy: uid

families/{familyId}/members/{uid}
  - uid: string
  - email: string
  - displayName: string
  - roles: ('admin' | 'storyteller')[]
  - dossierId: string | null     # for storyteller role: their linked dossier
  - joinedAt: timestamp

families/{familyId}/dossiers/{dossierId}
  - storytellerName: string
  - storytellerContext: string
  - historicalContext: string
  - familyTree: FamilyMember[]
  - selectedVoice: string
  - personality: 'empathetic' | 'investigative' | 'casual'
  - interviewerNotes: string
  - lastSessionAt: timestamp | null
  - lastDigestSentAt: timestamp | null
  - createdAt: timestamp
  - updatedAt: timestamp

families/{familyId}/dossiers/{dossierId}/questions/{questionId}
  - text: string
  - status: 'Unasked' | 'InProgress' | 'Completed'
  - findings: string
  - order: number
  - source: 'manual' | 'gapAnalysis'   # origin of the question
  - priority: 'high' | 'medium' | 'low' | null
  - rationale: string | null            # AI explanation for why this gap exists
  - createdAt: timestamp
  - updatedAt: timestamp

families/{familyId}/dossiers/{dossierId}/sessions/{sessionId}
  - startTime: timestamp
  - endTime: timestamp | null
  - audioUrl: string             # Cloud Storage path
  - status: 'active' | 'completed' | 'interrupted'
  - durationSeconds: number

families/{familyId}/dossiers/{dossierId}/sessions/{sessionId}/transcriptEntries/{entryId}
  - role: 'user' | 'model'
  - text: string
  - originalText: string | null  # set if user edits; original preserved
  - editHistory: { text, editedAt, editedBy }[]
  - timestamp: timestamp
  - order: number

families/{familyId}/dossiers/{dossierId}/sessions/{sessionId}/analysis/engagement
  - engagementLevel: 'high' | 'medium' | 'low'
  - comfortLevel: 'comfortable' | 'neutral' | 'uncomfortable'
  - notableThemes: string[]
  - suggestedFollowUps: { text, rationale }[]
  - analyzedAt: timestamp

families/{familyId}/dossiers/{dossierId}/analysis/gapAnalysis
  - questions: { text, priority, rationale }[]
  - gaps: { timeline: string[], themes: string[], implied: string[] }
  - narrativeSummary: string     # used as email intro paragraph
  - analyzedAt: timestamp
  - sessionId: string            # session that triggered this analysis

families/{familyId}/dossiers/{dossierId}/events/{eventId}
  - title: string
  - date: string                 # ISO or partial e.g. "1952" or "1952-06"
  - description: string
  - sourceSessionId: string
  - sourceEntryIds: string[]
  - createdAt: timestamp

families/{familyId}/dossiers/{dossierId}/memoirs/{memoirId}
  - title: string
  - content: string              # Markdown
  - storageUrl: string | null    # Cloud Storage path if exported
  - createdAt: timestamp
  - updatedAt: timestamp

families/{familyId}/dossiers/{dossierId}/media/{fileId}
  - filename: string
  - mimeType: string
  - storageUrl: string
  - uploadedAt: timestamp

families/{familyId}/dossiers/{dossierId}/miscFacts/{factId}   # from Talk mode (#95)
  - text: string                 # the fact or correction
  - isCorrection: boolean
  - correctionNote?: string      # what it corrects (when isCorrection is true)
  - source: 'talk'
  - createdAt: timestamp

families/{familyId}/invitations/{invitationId}
  - email: string
  - roles: ('admin' | 'storyteller')[]
  - dossierId: string | null
  - status: 'pending' | 'accepted'
  - token: string                # UUID, included in invite link
  - createdAt: timestamp
  - acceptedAt: timestamp | null
```

### 2.2 Cloud Storage Structure

```
{familyId}/{dossierId}/{sessionId}.webm          # session audio (mixed)
{familyId}/{dossierId}/media/{fileId}             # uploaded photos/documents
{familyId}/{dossierId}/clips/{clipId}.webm        # user-created audio clips
{familyId}/{dossierId}/promptPhotos/{photoId}     # photos shown during session
{familyId}/{dossierId}/memoirs/{filename}         # exported memoir files
```

### 2.3 Security Model

#### Firestore Rules

Access requires the requesting user to be a member of the family. Firestore rules enforce family membership via the `familyIds` array on the user's profile doc. Cloud Functions use the Admin SDK and are not subject to client-facing rules.

Key principles:
- `families/{familyId}` and subcollections: read/write requires the user's `familyIds` array to contain `familyId`
- `users/{uid}` docs: readable/writable only by the owning user (Cloud Functions use Admin SDK)
- `invitations/{id}`: readable by the invitee email or family admins; not publicly enumerable

#### Storage Rules

Storage rules cannot query Firestore, so family membership is propagated into the Firebase Auth token as a custom claim (`familyIds: string[]`). The rule checks:
```
familyId in request.auth.token.get('familyIds', [])
```

#### Client-side API key exposure

The browser bundle contains only the Firebase web config (intentionally public — see §5.1). The Gemini API key is **not** bundled into the client; all Gemini calls go through server-side Cloud Functions (see §5.3). Google Maps / Weather keys are also server-side only (see §5.2).

This is a deliberate departure from the prior design, which embedded `VITE_GEMINI_API_KEY` in the bundle. A previous incident in which a key embedded in the client bundle was extracted and abused motivated this design. Even with HTTP-referrer restrictions, a key shipped to the browser is treated here as compromised by default.

**Defence-in-depth on what does ship:** Firebase web config is constrained by Firestore + Storage Security Rules and by HTTP-referrer + API restrictions on the GCP key. Billing alerts catch unexpected spend.

#### Custom Claims Sync (`onMemberWritten`)

The `onMemberWritten` Cloud Function (Firestore trigger on `families/{familyId}/members/{memberId}`) fires on every member write. It reads `users/{uid}.familyIds` and calls `admin.auth().setCustomUserClaims()` to sync the array into the Auth token. Clients must call `user.getIdToken(true)` after joining a family to pick up the new claim before accessing Cloud Storage.

---

## 3. Implementation Details

### 3.1 Authentication and Family Flow

1. User lands on `LoginScreen` (Google sign-in or email/password form).
2. On first login, a `users/{uid}` profile is created if it does not exist.
3. `FamilySelector` reads `users/{uid}.familyIds`:
   - Empty → show "Create a Family" / "I Have an Invite Link"
   - One family → auto-navigate to `/family/:familyId`
   - Multiple → show family list picker
4. `FamilyHome` subscribes to `families/{familyId}/members/{uid}` via `useCurrentRoles` and routes by role:
   - **admin** → `FamilyPage` (full management interface)
   - **storyteller** → `StorytellerDashboard` (history + start session)
   - **not a member** → redirect back to `FamilySelector`
5. Dual-role users (both admin and storyteller) are treated as admin.

**Important implementation note — `useCurrentRoles` loading**: `loading` is derived
synchronously from a `loadedFor` state (the `{familyId, uid}` pair for which a snapshot
has been received), rather than from a boolean state flag set in effects. This prevents
a race where the uid arrives in the same React batch that sets `loading=false` (from a
prior null-uid effect run), which would cause `FamilyHome` to render a redirect before
the Firestore snapshot can confirm the user's role.

### 3.2 Invitation Workflow

1. Admin opens `InviteMember`, fills in email, role(s), and optionally a dossier link.
2. Client writes `families/{familyId}/invitations/{id}` with a UUID token.
3. `onInvitationCreated` Cloud Function (Firestore trigger) sends an email with `https://app/accept-invite?token={uuid}`.
4. Invitee opens link → `AcceptInvite` reads invitation details (public token lookup).
5. Invitee signs in or creates an account, clicks Accept.
6. `acceptInvitation` callable: validates token, creates member doc, updates `users/{uid}.familyIds`, marks invitation accepted.
7. Client calls `user.getIdToken(true)` to force-refresh the token with the new `familyIds` claim, then navigates to the family.

### 3.3 The Interviewer Engine (Function Calling)

The AI is given tools via `buildSystemInstruction()` in `src/services/gemini.ts`:

- **`updateQuestionStatus(id, status, findings)`** — updates question progress in Firestore as the storyteller speaks. The `id` is validated against the loaded Story Queue first: the model occasionally invents IDs, so an unknown `id` is not written (which would throw `No document to update` and create a phantom doc) — instead the tool returns an informative result telling the model to only use real IDs.
- **`reportEmotionalObservation(observation)`** — logs significant emotional moments to the session.
- **`showPhoto(photoId)`** — displays a prompt photo to the storyteller mid-session.
- **`endSession()`** — ends the session programmatically. The AI speaks closing remarks before calling this; `useSession` polls for audio drain before invoking `stopSession()`.

**External search tools** (`src/services/externalSearch.ts` + `@andyfooblah/voicecommon`, #101, #102, #105, #106, #108, #115):
- **`searchWikipedia({question, maxChunks?, maxAgeDays?})`** — provided by `@andyfooblah/knowledge-common`. Performs RAG over full Wikipedia articles: OpenSearch finds 5 candidates → Gemini Flash Lite filters to ≤3 relevant ones → full article text is chunked and batch-embedded with `gemini-embedding-001` → chunks cached in Firestore `wikipedia_cache/{articleId}/chunks/` → cosine similarity returns the most relevant passages. All Gemini calls route through the server-side broker callables (`invokeGemini` / `embedGemini` — see §2 "Client-side API key exposure"), and cache writes go through the `cacheWikipediaArticle` Cloud Function. KnowledgeCommon is initialized via `initializeKnowledgeCommon()` in `index.tsx`.
- **`searchPlace(query)` / `getDistanceBetweenPlaces(a, b)`** — Google Maps Geocoding, proxied server-side via `geoProxy` Cloud Function.
- **`getWeather(location)`** — current conditions + 3-day forecast via Google Maps Platform Weather API, also proxied (API does not send CORS headers).
- **`getJoke()`** — random joke from JokeAPI v2.
- **`searchContext(query, topK, familyId)`** — semantic vector search across the family's accumulated knowledge (biographies, transcripts, events, misc facts, questions) via `searchContext` Cloud Function; uses 768-dim `gemini-embedding-001` embeddings stored in `families/{familyId}/contextChunks`.

**Date/time utilities** (`src/services/dateTimeUtils.ts`, #112, #114):

LLM-assisted helpers for computing and formatting intervals involving vague or natural-language temporal expressions that standard date-parsing cannot handle.

- **`computeTimeDifference(dateA, dateB, currentDateTime, apiKey)`** — normalizes both expressions via Gemini (returning a `NormalizedDate` with `best_estimate`, `confidence`, and `resolution`), then computes and formats the signed difference. Supports resolution from `decade` down to `second`; output is qualified with "about" / "roughly" based on confidence.
- **`computeTimeOffset(date, offset, currentDateTime, apiKey)`** — adds or subtracts a natural-language offset ("30 minutes later", "2 years earlier") from a base date, returning a human-readable result.

`DateResolution` values (coarsest → finest): `decade | year | month | day | hour | minute | second`

`DateTimePoint` is the parsed internal representation: `{ year, month, day, hour, minute, second }`. Sub-day fields default to midpoints (noon) for coarse-resolution expressions so arithmetic is always well-defined.

The system instruction is kept deliberately small to reduce latency and avoid a native-audio failure mode where large prompts trigger greeting restarts/repeats (google-gemini/cookbook#1197). It carries the storyteller's name, a **short rolling profile summary** (regenerated after each session by `generateProfileSummary` and stored on the dossier — not the full biography), the **Story Queue** (topics + status, without accumulated findings), the family tree, and the personality. Prior detail is fetched **on demand** rather than inlined: `searchContext` (biography, prior transcripts, events, facts), `getBiography` (full background), and `getQuestionFindings` (accumulated learnings for one question). In-session text messages use `sendRealtimeInput({ text })`. `serverContent` messages may contain multiple parts; the audio playback loop iterates all parts.

Turn-taking is selected by the `TURN_MODE` constant in `useUnifiedSession`: `auto` uses Gemini's server VAD with LOW end-of-speech sensitivity; `manual` uses VoiceCommon's client-side voice-activity detection, which holds the turn until a configurable silence has elapsed (see the VoiceCommon design doc).

**Personality modes:**
- `empathetic`: warm, attentive biographer — brief responses, one question at a time, gentle encouragement
- `investigative`: oral historian — precise, focused on dates and facts
- `casual`: informal grandchild — enthusiastic and conversational

### 3.4 Audio Pipeline

**Recording and streaming:**
1. `getUserMedia` provides the microphone stream.
2. `AudioWorkletNode` (`pcm-processor.js`) runs on the audio thread, capturing Float32 frames and posting them to the main thread via `MessagePort`. This replaced the deprecated `ScriptProcessorNode`.
3. Main thread converts each frame to Int16 PCM (16 kHz) and streams to Gemini Live API.
4. Bot audio (decoded `AudioBuffer`) is played back via `AudioContext`.

**Mixed archival:**
1. User mic node and bot audio node both connect to a `MediaStreamDestination`.
2. `MediaRecorder` records the mixed stream as WebM/Opus at 128 kbps.
3. `timeslice` emits chunks every ~10s. Chunks are buffered locally and flushed to Cloud Storage on stop or on connection error (partial session recovery).

### 3.5 Transcript Editing

Both admins and storytellers can edit transcript entries. Each edit stores new text in `text`, moves the previous text to `originalText`, and appends a record to `editHistory[]`. The original content is never deleted.

### 3.6 Error Recovery and Reconnection

On Gemini API disconnect (`onclose`/`onerror`):
1. Flushes buffered audio chunks to Cloud Storage.
2. Syncs latest transcript state to Firestore.
3. Updates session status to `'interrupted'`.
4. Displays a reassuring, non-technical message to the storyteller.
5. Attempts one automatic reconnect (500ms delay). On failure, shows "Try Again" / "End Session" dialog.

**Reconnect** (`reconnectSession`): reuses the existing Firestore session doc and transcript. Stops/restarts the audio mixer, opens a new Gemini WebSocket, injects the last 20 transcript entries as a resume prompt.

**Connectivity check**: before starting a session, a lightweight latency probe warns the archivist if round-trip time exceeds 500ms.

### 3.7 Post-Session Analysis Pipeline

Two tiers of AI analysis run after each session:

**Tier 1 — Client-side (immediate, current session only)**

Runs in `useSession.ts` as a background async block after `stopSession`. Uses the Gemini text API to:
- Extract discrete life events → `dossiers/{id}/events`
- Assess storyteller engagement and comfort → `sessions/{id}/analysis/engagement`
- Suggest 3–5 new Story Queue questions → `sessions/{id}/analysis/suggestions`

**Tier 2 — Server-side Cloud Functions (holistic, all sessions)**

*`onSessionCompleted` (Firestore trigger)* — fires when `sessions/{id}.status` → `completed`. Runs in parallel:
1. Admin notification email (opted-in admins).
2. **Deep gap analysis** (`functions/src/analysis.ts`): reads all transcripts, events, and questions across every session for the dossier. Identifies timeline gaps, theme gaps, and implied-but-unexplored threads. Writes results to `dossiers/{id}/analysis/gapAnalysis`.

**`saveGapAnalysis()` — Story Queue sync**: gap analysis questions are written directly into the `questions` subcollection (with `source: 'gapAnalysis'`). Before writing, stale Unasked gap questions are deleted to prevent accumulation. This makes the Story Queue the single source of truth for what to ask next.

*`sendDailyDigest` (scheduled hourly)* — checks per dossier whether it is currently 7am in the storyteller's timezone (IANA string stored in `users/{uid}.timezone`, written on every login). If so, and if the day-range gate (2–7 days since last session) and idempotency gate (`lastDigestSentAt` 2-day window) pass, sends a warm re-engagement email. Uses `narrativeSummary` from gapAnalysis as the intro paragraph, followed by Story Queue topics. Runs gap analysis on-the-fly if no gapAnalysis doc exists and there are no Unasked questions.

*`triggerDigestForDossier` (HTTPS callable)* — admin-only. Sends the digest immediately for a specific dossier, bypassing timing gates. Invoked by the "Send nudge email" button in `DossierEditor`.

**Required Cloud Function secrets** (set via `firebase functions:secrets:set`):
- `SMTP_PASS` — Gmail app password
- `GEMINI_API_KEY` — server-side key for gap analysis and memoir Gemini calls

**Required Cloud Function env strings** (set via `firebase functions:config:set` or `.env`):
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` — email server config
- `APP_URL` — base URL for invite links and email links

### 3.7 Talk About My Family (Conversational Mode)

A second conversational mode alongside the structured interview. The storyteller can have an unrecorded, free-form voice conversation with the AI about their family.

**Key differences from interview mode:**
- No audio upload to Cloud Storage (blob is discarded on stop)
- No Firestore session document created
- No transcript sync to Firestore
- No Story Queue — the AI has no question agenda
- No post-session analysis pipeline

**AI context:** Before connecting, `getTalkContext()` fetches the last 3 completed session transcripts plus dossier-level events, building a `TalkContext` object. This is injected into `buildTalkSystemInstruction()` so the AI can reference what the storyteller has already shared.

**Tools registered:**
- **`recordFact(text, isCorrection, correctionNote?)`** — saves a `MiscFact` document to Firestore when the AI learns something new or hears a correction to prior sessions.
- **`setPreferredName(name)`** — identical to interview mode.
- **`endTalk()`** — analog of `endSession`; AI speaks closing words first.

**Data model — MiscFact:**
```
families/{familyId}/dossiers/{dossierId}/miscFacts/{factId}
  text: string            — the fact or correction
  isCorrection: boolean
  correctionNote?: string — what it corrects (when isCorrection is true)
  source: 'talk'
  createdAt: timestamp
```

MiscFacts are visible (read-only) in the DossierEditor under "Additional Notes." They are also injected back into the talk context on subsequent Talk conversations so the AI doesn't record the same fact twice.

**Entry point:** "Talk About My Family" button on `StorytellerDashboard` → `/family/:familyId/dossier/:dossierId/talk` → `TalkView`.

**Reconnect:** Talk sessions do not auto-reconnect. On error, the user is shown a "Start New Conversation" button (the prior talk context is not preserved in memory).

### 3.8 GEDCOM Import

`src/services/gedcomParser.ts` parses GEDCOM 5.5 files into `FamilyMember[]` for import into the dossier's family tree. Supports name, relationship, birth year, and death year.

### 3.9 Events Timeline

Life events extracted from transcripts by Tier 1 analysis are stored in `dossiers/{id}/events`. `EventsTimeline` renders them chronologically with links back to the source session.

### 3.10 Memoir Generation and Export

`memoirGeneration.ts` uses the Gemini text API to synthesize a readable life-story narrative from all session transcripts. The result is Markdown, stored in `dossiers/{id}/memoirs/{id}`. `memoirExport.ts` handles PDF export (via browser print) and Markdown download.

### 3.11 Audio Clips

Archivists and storytellers can create named audio clips from any session. Clips are stored in Cloud Storage under `{familyId}/{dossierId}/clips/{clipId}.webm`.

---

## 4. App Structure

```
src/
├── components/
│   ├── auth/
│   │   ├── LoginScreen.tsx
│   │   └── AcceptInvite.tsx
│   ├── dossier/
│   │   ├── DossierList.tsx
│   │   ├── DossierEditor.tsx
│   │   └── StorytellerProfile.tsx
│   ├── family/
│   │   ├── FamilyHome.tsx           # Post-login router: redirects by role
│   │   ├── FamilyPage.tsx           # Loads member/role, routes admin vs storyteller
│   │   ├── FamilySelector.tsx       # Multi-family picker
│   │   ├── FamilyEventDetail.tsx
│   │   ├── InviteMember.tsx
│   │   ├── MemberManagement.tsx
│   │   └── CreateFamily.tsx
│   ├── session/
│   │   ├── SessionView.tsx
│   │   ├── Visualizer.tsx
│   │   └── TranscriptFeed.tsx
│   ├── history/
│   │   ├── SessionList.tsx
│   │   ├── TranscriptViewer.tsx
│   │   ├── AudioPlayer.tsx
│   │   ├── QuestionDashboard.tsx
│   │   └── EventsTimeline.tsx
│   ├── media/
│   │   └── MediaGallery.tsx
│   ├── memoir/
│   │   └── MemoirViewer.tsx
│   ├── storyteller/
│   │   └── StorytellerDashboard.tsx
│   └── shared/
│       ├── Layout.tsx
│       ├── ErrorBoundary.tsx
│       └── Logo.tsx
├── hooks/
│   ├── useAuth.ts
│   ├── useFamily.ts
│   ├── useDossier.ts
│   ├── useSession.ts               # Live session lifecycle (~600 lines)
│   ├── useAudioMixer.ts
│   ├── useEvents.ts
│   └── useInvitations.ts
├── services/
│   ├── firebase.ts
│   ├── gemini.ts                   # System instructions + Gemini Live session
│   ├── storage.ts                  # Cloud Storage + Firestore CRUD
│   ├── audioUtils.ts
│   ├── invitations.ts
│   ├── adminActions.ts
│   ├── postSessionAnalysis.ts      # Tier 1 client-side analysis
│   ├── gedcomParser.ts
│   ├── memoirGeneration.ts
│   └── memoirExport.ts
├── types.ts
├── App.tsx                         # Router (11 routes)
└── index.tsx
```

**Cloud Functions (`functions/src/`):**

```
index.ts       — onInvitationCreated, onSessionCompleted, onMemberWritten,
                 sendDailyDigest, triggerDigestForDossier, acceptInvitation
analysis.ts    — runGapAnalysis(), saveGapAnalysis()
                 (writes to gapAnalysis doc AND questions subcollection)
```

---

## 5. API Key Policy

### 5.1 Overview

| Key | Where stored | Why |
|-----|-------------|-----|
| `VITE_FIREBASE_*` | `.env.local` (client bundle) | Firebase config is **by design public** — it only identifies the project; security is enforced by Firebase Auth + Security Rules |
| `GEMINI_API_KEY` | Firebase Secret Manager (server only) | All Gemini calls go through Cloud Functions — see §5.3 |
| `GOOGLE_MAPS_API_KEY` | `functions/.env` (server only) | **Never in the client bundle** — see §5.2 |

### 5.2 Google Maps / Weather — Server-Side Proxy

The Google Maps Geocoding API and Google Maps Platform Weather API keys are stored exclusively in `functions/.env` and accessed only by the `geoProxy` Cloud Function (`functions/src/index.ts`).

**Why server-side:**
- The key would otherwise be trivially extractable from the JS bundle
- `weather.googleapis.com` does not send CORS headers, so browser-direct calls are blocked regardless
- Latency overhead measured at ~10ms (geocode) / ~26ms (distance) / ~160ms (weather) vs direct — acceptable for conversational use

**Architecture:**
```
Client (session tool call)
  → httpsCallable('geoProxy', { type, query })
    → Cloud Function reads GOOGLE_MAPS_API_KEY from process.env
    → Calls maps.googleapis.com / weather.googleapis.com
    → Returns { result: string }
  → AI receives answer string
```

The `geoProxy` function handles three operation types:
- `geocode` — `maps.googleapis.com/maps/api/geocode/json`
- `distance` — two geocode calls + Haversine calculation
- `weather` — geocode + `weather.googleapis.com/v1/currentConditions:lookup` + `forecast/days:lookup`

### 5.3 Gemini — Server-Side Broker

`GEMINI_API_KEY` lives only in Firebase Secret Manager. The browser never holds the long-lived key. Two callables broker every Gemini call:

| Callable | Purpose | Rate limit (per user, per day) |
|---|---|---|
| `mintGeminiLiveToken` | Issues a single-use ephemeral token (~30 min TTL, ~60 s window to open the Live session) for browser-direct WebSocket connection to Gemini Live | 200 |
| `invokeGemini` | Generic proxy for `ai.models.generateContent` — used for all non-realtime text generation (event extraction, engagement scoring, question suggestion, transcript cleanup, …) | 1 000 |

**Why ephemeral tokens for Live, not a full proxy?** A persistent bidirectional WebSocket (`BidiGenerateContent`) cannot be tunnelled through a stateless Cloud Function without unacceptable RTT. Ephemeral tokens preserve the browser-direct WebSocket while bounding the blast radius of any leak: a harvested token is single-use and dies in 30 minutes, versus a long-lived API key that an attacker can replay indefinitely. (This is the post-incident replacement for the prior "ship the bundled key" design.)

**Why a generic `invokeGemini` proxy for batch calls?** Non-realtime text generation has no latency reason to bypass the server. A single callable with a model allow-list and `maxOutputTokens` ceiling caps the worst-case cost of any single call, and per-user rate limits cap the worst-case cost of a compromised account.

**Architecture (Live):**
```
Client                                Cloud Function                     Google
  ──── mintGeminiLiveToken() ─────►  liveToken.ts
                                      └─ enforceRateLimit(uid)
                                      └─ ai.authTokens.create(...)  ───► Gemini
                                                                     ◄── { name, expireTime }
  ◄──── { token, expireTime } ──────
  ──── live.connect(token) ───────────────────────────────────────────► Gemini Live WS
```

**Architecture (batch text):**
```
Client                                Cloud Function                     Google
  ──── invokeGemini({ model, … }) ─►  invokeGemini.ts
                                      └─ enforceRateLimit(uid)
                                      └─ allowedModels.has(model) ?
                                      └─ cap maxOutputTokens
                                      └─ ai.models.generateContent  ──► Gemini
                                                                    ◄── response
  ◄──── { text, candidates, usage } ─
```

Source: `functions/src/liveToken.ts`, `functions/src/invokeGemini.ts`. Rate-limit buckets in `functions/src/rateLimit.ts`.

---

## 6. Testing


### 5.1 Tooling

- **Test runner**: Vitest (Vite-native, ESM-compatible)
- **Component testing**: React Testing Library
- **DOM environment**: jsdom
- **Browser API mocks**: `src/__mocks__/webAudioApi.ts`
- **Firebase mocks**: `src/__mocks__/firebase.ts`
- **Linting**: ESLint flat config (`eslint.config.js`) with `@typescript-eslint` and `eslint-plugin-react-hooks`
- **Current test count**: 334 passing

### 5.2 Test Coverage

```
src/__tests__/
├── services/   audioUtils, gemini, storage, postSessionAnalysis
├── hooks/      useAuth, useDossier, useFamily, useEvents, useInvitations,
│               useSession, useAudioMixer
└── components/ AcceptInvite, LoginScreen, DossierList, FamilySelector,
                MemberManagement, QuestionDashboard, SessionView,
                TranscriptFeed, ErrorBoundary, StorytellerDashboard
```

### 5.3 Mocking Strategy

- **Firebase**: All Firestore/Auth/Storage imports mocked at module level via `vi.mock()`. Tests use in-memory state.
- **Browser APIs**: `AudioContext`, `MediaRecorder`, `getUserMedia` mocked in `src/__mocks__/webAudioApi.ts`.
- **Gemini API**: `@google/genai` mocked to provide controllable `onopen`, `onmessage`, `onerror`, `onclose` callbacks.

### 5.4 Known Issues

1. **Orphaned sessions on start failure**: If `mixer.start()` succeeds but Gemini connection fails, the Firestore session doc is created but never finalized. Should be marked `interrupted` in cleanup.
2. **`encode()` RangeError on large buffers**: Byte-to-char loop may hit string length limits on very large audio buffers.
3. **`syncTranscriptToFirestore` full overwrite**: Uses `setDoc(..., { merge: false })`. Acceptable for v1 but worth monitoring.

---

## 7. Composite Firestore Indexes

Defined in `firestore.indexes.json`:

| Collection | Fields | Purpose |
|---|---|---|
| `sessions` | `status ASC`, `startTime ASC` | Gap analysis `getAllTranscripts` |
| `sessions` | `status ASC`, `startTime DESC` | Digest `recentSessionSnap` |
| `questions` | `status ASC`, `order ASC` | Digest Unasked questions query |

---

## 8. User Navigation Flows

### 7.1 Admin User Flow

**Login → FamilySelector (if multiple) → DossierList**

1. **DossierList** (`/family/:familyId`) — view/create storyteller cards
2. **DossierEditor** (`/family/:familyId/dossier/:dossierId`) — edit profile, story queue, family tree, prompt photos, notes; navigate to history, events, memoir, media
3. **MemberManagement** (`/family/:familyId/members`) — invite members, edit roles, cancel invites
4. **SessionList** → **TranscriptViewer** — full editing, engagement analysis, AI suggestions, audio clips

### 7.2 Storyteller User Flow

**Login → FamilyHome → SessionView (auto-redirect)**

1. **SessionView** — a compact control bar pinned at the top (back, identity + live status, recording indicator with an elapsed recorded-time readout, and a Start/Stop call button) above a full-height live transcript feed. The recorded-time clock is driven from a single start timestamp so it counts continuously across reconnections and resets only when a brand-new session begins. While the bot is idle the transcript shows an animated **"Listening…" placeholder** on the user's side: the native-audio model (`gemini-3.1-flash-live-preview`) only emits the user's transcription once, at end-of-turn (it no longer streams input transcription incrementally the way it streams the bot's output text), so the user's words cannot appear word-by-word — the placeholder signals the mic is open until their bubble lands.
2. **SessionList** — past sessions (read-only)
3. **TranscriptViewer** — read-only transcript and audio; no editing tab, no analysis
4. **Memoir / Events / Media** — read-only access

### 7.3 Access Control Summary

| Feature | Admin | Storyteller |
|---|---|---|
| DossierList / DossierEditor | Full | Denied |
| SessionView | Optional | Primary interface |
| SessionList | All sessions | Own sessions |
| TranscriptViewer | Read + Edit | Read only |
| MemberManagement | Full | Denied |
| Memoir / Events / Media | Full | Read only |

### 7.4 Navigation Principles

1. Storytellers are auto-redirected from FamilyHome to SessionView
2. Back buttons are role-aware
3. DossierEditor has a hard access check against direct URL access by storytellers
4. Dual-role users (admin + storyteller) default to admin interface

---

## 9. Future Roadmap

- **Firebase App Check** — protect callable endpoints from abuse
- **Firestore security rules audit** — tighten `questions` write scope (Cloud Functions only for `source=gapAnalysis`), `invitations` read scope, storyteller scope (issue #87)
- **Vector Search** — Vertex AI on transcripts for semantic search
- **Sharing** — read-only share links for family members outside the app
- **E2E tests** — Playwright with mock microphone input
- **Bundle code splitting** — main JS chunk is 1.6 MB; split heavy routes and vendor libs (issue #96)
