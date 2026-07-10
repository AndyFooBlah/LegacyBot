# LegacyBot

> **Public name:** This app is publicly branded as **BiographyBot** and hosted at [biographybot.com](https://biographybot.com). The GitHub repository and internal codebase retain the name "LegacyBot" for historical continuity.

A voice-first life story preservation app that helps families capture and archive the stories of their loved ones. BiographyBot uses the Google Gemini Live API to conduct empathetic, real-time voice interviews with storytellers, automatically transcribing and organizing their narratives.

## How It Works

1. **Create a Dossier** — Set up a storyteller profile with their name, background context, family tree, and a queue of interview questions.
2. **Start a Session** — BiographyBot greets the storyteller by name and guides the conversation using the question queue, adapting naturally to wherever the story leads.
3. **Review History** — Browse past sessions, read transcripts, listen to archived audio, and track question progress across interviews.

## Key Features

- Real-time voice conversation powered by Google Gemini Live API
- Two user roles: **Archivist** (sets up dossiers, reviews sessions) and **Storyteller** (voice-only interview access)
- Three interviewer personalities: empathetic, investigative, casual
- Automatic question tracking with status updates via Gemini function calling
- Audio archival in WebM/Opus format to Firebase Cloud Storage
- Live transcript display during sessions
- Per-message transcript editing with full edit history for both Archivists and Storytellers
- Session history with audio playback, transcript review, and audio clip creation
- Relational family tree with friends and pets, GEDCOM import
- Events timeline — life events extracted from transcripts and linked to source messages
- AI-generated memoirs from session transcripts, exported as PDF
- Post-session engagement analysis and suggested follow-up questions
- Media gallery for photos and documents
- Family-based access control via Firebase Auth with invitation workflow
- Partial session recovery (audio chunks saved every 10 seconds)

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 6, Tailwind CSS v4, React Router v7
- **AI**: Google Gemini Live API via [`@andyfooblah/voice-common`](https://github.com/AndyFooBlah/VoiceCommon)
- **Knowledge tools**: [`@andyfooblah/knowledge-common`](https://github.com/AndyFooBlah/KnowledgeCommon) (Wikipedia RAG, date/time, maps/weather/jokes proxied through Firebase callable functions)
- **Backend**: Firebase (Authentication, Firestore, Cloud Storage, Cloud Functions)
- **Audio**: Web Audio API, MediaRecorder API
- **Testing**: Vitest, React Testing Library, jsdom

### Shared libraries

Both shared libraries are published to npmjs.org and consumed as normal versioned dependencies.

| Package | Source | Role |
|---------|--------|------|
| `@andyfooblah/voice-common` | `^0.14.0` ([VoiceCommon](https://github.com/AndyFooBlah/VoiceCommon)) | Gemini Live session lifecycle, audio mixing, archival, session resumption, Firestore session management |
| `@andyfooblah/knowledge-common` | `^1.2.0` ([KnowledgeCommon](https://github.com/AndyFooBlah/KnowledgeCommon)) | Knowledge tool declarations and handlers (Wikipedia, date/time, maps, weather, jokes) |

## Project Structure

```
src/
├── components/
│   ├── auth/          # LoginScreen, AcceptInvite
│   ├── dossier/       # DossierList, DossierEditor, StorytellerProfile
│   ├── family/        # FamilyHome, FamilyPage, FamilySelector, FamilyEventDetail, InviteMember, MemberManagement
│   ├── history/       # SessionList, TranscriptViewer, AudioPlayer, QuestionDashboard, EventsTimeline
│   ├── media/         # MediaGallery
│   ├── memoir/        # MemoirViewer
│   ├── session/       # SessionView, TranscriptFeed, Visualizer
│   ├── shared/        # Layout, ErrorBoundary, Logo
│   └── storyteller/   # StorytellerDashboard
├── hooks/             # useAuth, useFamily, useDossier, useUnifiedSession, useEvents, useInvitations
├── services/          # firebase, gemini, storage, audioUtils, memoirExport, postSessionAnalysis, gedcomParser, invitations, adminActions
├── types.ts           # TypeScript interfaces
└── App.tsx            # Router setup (11 routes)
```

## Session management

`useUnifiedSession` (`src/hooks/useUnifiedSession.ts`) is a thin wrapper around VoiceCommon's `useSession`. VoiceCommon handles all voice infrastructure — Gemini Live WebSocket lifecycle, audio mixing, session resumption, repetition detection, Firestore session creation and finalization, and GCS audio archival.

`useUnifiedSession` adds LegacyBot-specific concerns:

- Async context loading before `startSession` (completed session count, previous session summary, recent dates, talk context)
- System instruction assembly via `buildSessionInstruction`
- 13 LegacyBot-specific tool declarations (`endSession` is injected by VoiceCommon automatically)
- Tool call dispatch for both LB-specific tools and KC knowledge tools
- Post-session analysis: `extractEvents`, `assessEngagement`, `suggestQuestions`
- Speaker tracking for `recordFact` attribution

### Family-scoped Firestore session path

Sessions are stored under the dossier they belong to, not in a flat top-level collection:

```
families/{familyId}/dossiers/{dossierId}/sessions/{sessionId}
families/{familyId}/dossiers/{dossierId}/sessions/{sessionId}/transcript/entries
```

This is passed to VoiceCommon via the `sessionsCollection` option:

```typescript
sessionsCollection: `families/${familyId}/dossiers/${dossierId}/sessions`
```

VoiceCommon's create, finalize, and transcript sync calls all use this prefix automatically.

---

## Documentation

- [Product Requirements](product_requirements.md) — functional requirements, user stories, and UX goals
- [Design Document](design.md) — architecture, data model, security rules, testing strategy, and roadmap

## Getting Started

### Prerequisites

- Node.js 24 (the version CI runs; Cloud Functions use the Node 22 runtime)
- A Firebase project with Authentication, Firestore, and Cloud Storage enabled
- A Google Gemini API key

### Setup

1. Clone and install (the shared libraries [`@andyfooblah/voice-common`](https://github.com/AndyFooBlah/VoiceCommon) and [`@andyfooblah/knowledge-common`](https://github.com/AndyFooBlah/KnowledgeCommon) resolve from npmjs.org like any other dependency):
   ```bash
   git clone https://github.com/AndyFooBlah/LegacyBot.git
   cd LegacyBot
   npm install
   ```

   > To iterate on a shared library locally, `npm link` it: run `npm link` in your library checkout, then `npm link @andyfooblah/voice-common` (or `.../knowledge-common`) here.

2. Create your environment and Firebase config files:
   ```bash
   cp .env.example .env.local
   cp .firebaserc.example .firebaserc
   ```

3. Fill in your Firebase configuration in `.env.local`, and your Firebase project ID in `.firebaserc`:
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```
   *Note: `GEMINI_API_KEY` and `GOOGLE_MAPS_API_KEY` are not configured on the client. They are stored in Firebase Secret Manager and accessed via server-side callables. See the "Security" section below for details.*

4. Deploy Firestore and Storage security rules to your Firebase project:
   ```bash
   firebase deploy --only firestore:rules,storage
   ```

5. Start the dev server:
   ```bash
   npm run dev
   ```

### Cloud Functions setup (email features)

Invitation emails, session-complete notifications, and re-engagement digest emails are sent by Firebase Cloud Functions. The frontend works without this, but invitations and email nudges will be silent no-ops until it's configured.

#### 1. Set SMTP environment variables

Copy the example file and fill in your provider's details:

```bash
cp functions/.env.example functions/.env
# edit functions/.env with your SMTP_HOST, SMTP_PORT, SMTP_USER, and APP_URL
```

Three providers are supported out of the box — pick one:

| Provider | `SMTP_HOST` | `SMTP_PORT` | `SMTP_USER` | Notes |
|----------|------------|------------|------------|-------|
| **Gmail** | `smtp.gmail.com` | `587` | `you@gmail.com` | Requires an [App Password](https://myaccount.google.com/apppasswords) (2-Step Verification must be on) |
| **Resend** *(recommended)* | `smtp.resend.com` | `587` | `resend` | Free tier covers most solo/team use; verify your sending domain at resend.com |
| **iCloud Mail** | `smtp.mail.me.com` | `587` | `you@icloud.com` | Requires an [app-specific password](https://appleid.apple.com) |

#### 2. Store the password as a Firebase secret

`SMTP_PASS` must be stored as a Firebase secret, **not** in `functions/.env`:

```bash
firebase functions:secrets:set SMTP_PASS
# paste your App Password / API key / app-specific password when prompted
```

#### 3. Deploy the functions

```bash
firebase deploy --only functions
```

> **Development note:** If SMTP is not configured, functions that send email log a warning and return without error — no crash, no data loss. You can develop and test locally without email configured.

### Running Tests

```bash
npm test            # single run
npm run test:watch  # watch mode
```

## Designating a superadmin

Signup is gated by an invitation code so that new users can't create their own families without authorization. Codes are generated by **superadmins** — users with a custom claim that unlocks the admin page at `/admin/invitation-codes`.

There is no self-serve way to become a superadmin. The bootstrap flow is:

1. Have the user sign in at least once so their profile document exists at `users/{uid}`.
2. In the Firebase Console → Firestore, open that user's document.
3. Add a boolean field `isSuperadmin` set to `true` and save.
4. A Cloud Function (`onUserProfileWritten`) picks up the change and mirrors it into the user's Auth token as an `isSuperadmin` custom claim.
5. The user must sign out and back in (or wait for the ID token to refresh) for their app session to pick up the new claim.

Once signed back in:

- The `/admin/invitation-codes` route becomes accessible.
- A small "Superadmin: Invitation codes" link appears on the FamilySelector screen as a convenience entry point.
- The superadmin can generate new 6-character alphanumeric codes, attach an optional description, deactivate or reactivate existing codes, and expand each code to see who redeemed it and when.

Codes are **multi-use** by default — the same code can unlock multiple family creations. Redemption history is retained even after deactivation so you can audit usage.

**Invitations to existing families do not require a code.** A family admin inviting a new member via email bypasses the code check entirely; the code is only required when a signed-in user with zero families tries to create a new family.

To revoke superadmin privilege: delete the `isSuperadmin` field (or set it to `false`) on the user's profile doc. The claim removal propagates on the next token refresh.

## Continuous Integration

GitHub Actions runs automatically on every push to `main` and on every pull request targeting `main`. The workflow is defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

### What CI checks

| Step | Command | Purpose |
|------|---------|---------|
| Install | `npm ci` | Clean install from lockfile |
| Type check | `npx tsc --noEmit` | Catch type errors without emitting files |
| Tests | `npm test` | Run the full test suite |

Linting (`npm run lint`) is available locally but is not yet part of CI.

CI uses Node 24 on Ubuntu with npm caching enabled for fast installs; the shared libraries install from npmjs.org like any other dependency. A concurrency group ensures that only one run per branch is active at a time — pushing again cancels the previous in-progress run.

### Contributing workflow

1. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feature/my-change
   ```

2. **Make changes and run checks locally** before pushing:
   ```bash
   npx tsc --noEmit && npm test
   ```

3. **Push and open a pull request** against `main`. CI runs automatically and reports pass/fail status on the PR.

4. **Merge when CI is green.** If you have GitHub Pro (or the repo is public), enable the "Require status checks to pass" branch protection rule for the `Type Check & Test` check to enforce this.

### Adding new tests

- Place test files in `src/__tests__/` mirroring the source structure (e.g. `src/__tests__/hooks/useAuth.test.ts` tests `src/hooks/useAuth.ts`)
- Firebase and Web Audio API mocks are set up globally in `src/__tests__/setup.ts` — no per-test boilerplate needed
- See [design.md §5](design.md) for the full testing strategy, priority tiers, and mocking approach

## Privacy & Security

BiographyBot stores deeply personal information — life stories, family histories, health details, and childhood memories. Deploying it responsibly requires understanding exactly where that data goes, who can access it, and under what conditions it may be used by third-party services.

### Keeping credentials out of your repository

All secret values must be kept in `.env.local`, which is listed in `.gitignore` and must **never be committed**. The `.env.example` file shows the required variable names with empty values — it is safe to commit, but contains no secrets.

**Before each commit, verify no credentials are staged:**
```bash
git diff --cached | grep -i "VITE_\|apiKey\|secret"
```

Additional safeguards:
- Enable [GitHub secret scanning](https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning) on the repository — it will alert you if a key is accidentally pushed.
- Restrict each Firebase API key in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) to only the HTTP referrers and APIs it needs.
- Never log environment variables or pass them to client-side error reporters.
- Rotate any key that you suspect was exposed; Firebase and Gemini keys can both be regenerated in their respective consoles without data loss.

### Where user data is stored

#### Firebase Cloud Firestore
Firestore holds all structured application data: family records, dossiers, session metadata, transcripts, events, memoirs, and question progress. Data is **encrypted at rest (AES-256) and in transit (TLS)** by default. You control retention — there is no automatic expiry unless you configure TTL policies. After account deletion, Google removes data within 180 days.

The region your Firestore database is hosted in is set at creation time. If you want data to stay in a specific geography (e.g., the EU), you must select that region when creating the database — it cannot be changed later. See [available locations](https://cloud.google.com/about/locations/).

#### Firebase Cloud Storage
Cloud Storage holds audio recordings (WebM/Opus) and uploaded media files. The same encryption-at-rest and in-transit protections apply. Recordings persist until explicitly deleted; there is no automatic expiry. As with Firestore, the storage bucket's region is fixed at creation.

#### Firebase Authentication
Auth stores user account records (email, hashed password, sign-in history). Unlike Firestore and Cloud Storage, **Firebase Auth always processes data in the United States** — there is no regional configuration option. If strict EU data residency is a requirement, this is a material constraint.

#### Google Gemini Live API
This is the most important service to understand from a privacy standpoint.

During a session, the real-time audio stream and conversation turns are sent to Google's Gemini Live API. **What Google does with that data depends on which pricing tier you are on:**

| Tier | Used to train Gemini? | Human review of conversations? |
|------|-----------------------|--------------------------------|
| **Free (no billing enabled)** | **Yes** — Google explicitly reserves the right to use prompts and responses to improve and develop its products | **Yes** — de-identified conversations can be reviewed by human annotators |
| **Paid (billing enabled, pay-as-you-go)** | **No** — Google acts only as a data processor under its Cloud Data Processing Addendum | Only for abuse/safety violation investigation |

> **This is the most critical configuration decision for a production deployment.** If your GCP project has no billing account attached, your users' voice conversations and transcripts may be used to train future versions of Gemini. Enable billing and use the pay-as-you-go tier to opt out of this. At typical usage volumes the cost is low, and the privacy protection is significant given the sensitive nature of the content.

To check your current tier: visit the [Google AI Studio](https://aistudio.google.com) and confirm that your project has an active billing account in the [GCP Console](https://console.cloud.google.com/billing).

On the paid tier, conversation data is retained only transiently for abuse detection purposes and is not stored long-term by Google.

### Data residency and the Cloud Data Processing Addendum

When billing is enabled, Google's [Cloud Data Processing Addendum (CDPA)](https://cloud.google.com/terms/data-processing-terms) applies. Under the CDPA, Google acts as a data processor rather than a data controller — it processes data only on your documented instructions. This is the contractual basis for GDPR compliance.

If you are operating in the EU or processing data from EU residents, confirm that your Firestore and Cloud Storage regions are set to an EU location. Firebase Auth's US-only processing should be reviewed against your applicable data protection obligations.

### Summary of data flows

```
Storyteller voice → Gemini Live API (transient, paid tier = not retained or used for training)
                  → useAudioMixer → WebM/Opus file → Firebase Cloud Storage (persists until deleted)

Gemini transcription → useSession → Firestore transcript/entries (persists until deleted)

Family data, dossiers, events, memoirs → Firestore (persists until deleted)

User accounts → Firebase Authentication (US only)
```

### Client-side API keys and Secret Management

The browser never holds long-lived sensitive keys like `GEMINI_API_KEY` or `GOOGLE_MAPS_API_KEY`. These are stored exclusively in **Firebase Secret Manager** and accessed by Cloud Functions.

#### Keys embedded in the bundle

Only the public Firebase configuration is embedded in the browser bundle at build time:

| Variable | Used for | Risk if leaked |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase client SDK initialisation | Low — this key only identifies the project; access is gated by Firebase security rules and Auth |

#### Server-side Broker Architecture

To protect sensitive credentials, all expensive or restricted API calls are proxied through server-side Firebase Callable functions:

1.  **Gemini Live (Voice):** The client calls `mintGeminiLiveToken()` to obtain a single-use, ephemeral token with a 30-minute expiry. This token is used to open the WebSocket session and is useless once expired or used.
2.  **Gemini Text/Embeddings:** All non-realtime AI calls use the `invokeGemini()` and `embedGemini()` callables.
3.  **Maps & Weather:** Geocoding, distance, and weather lookups route through the `geoProxy` (or `externalSearch`) callable.

This architecture provides several security benefits:
- **Zero long-lived keys in the browser:** Even if a user inspects the bundle, they will not find usable Gemini or Maps keys.
- **Per-user rate limiting:** The server enforces daily caps on expensive AI and Maps calls to prevent billing abuse.
- **CORS compliance:** APIs that don't support browser-based calls (like some Maps endpoints) are handled naturally on the server.

### Relevant terms of service and privacy documentation

| Service | Link |
|---------|------|
| Gemini API Terms of Service | [ai.google.dev/gemini-api/terms](https://ai.google.dev/gemini-api/terms) |
| Google Cloud Data Processing Addendum | [cloud.google.com/terms/data-processing-terms](https://cloud.google.com/terms/data-processing-terms) |
| Firebase Privacy and Security | [firebase.google.com/support/privacy](https://firebase.google.com/support/privacy) |
| Firebase Data Processing Terms | [firebase.google.com/terms/data-processing-terms](https://firebase.google.com/terms/data-processing-terms) |
| Google Privacy Policy | [policies.google.com/privacy](https://policies.google.com/privacy) |
| Google Cloud compliance certifications | [cloud.google.com/security/compliance/services-in-scope](https://cloud.google.com/security/compliance/services-in-scope) |

---

## Built With AI

BiographyBot was developed collaboratively with several AI coding assistants across different phases of the project.

| AI | Model | Role |
|----|-------|------|
| Google AI Studio | Gemini 3.0 | Built the initial UI and application scaffold |
| Claude Code | Opus 4.5, Opus 4.6, Sonnet 4.6 | Feature development, architecture, testing, and ongoing iteration |
| Gemini CLI | Gemini 3.1 Pro | Feature development and iteration |

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.
