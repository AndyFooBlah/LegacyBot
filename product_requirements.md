# Product Requirements Document: LegacyBot

> **Public name:** This product is publicly branded as **BiographyBot** and served at [biographybot.com](https://biographybot.com). The GitHub repository and internal codebase use the name "LegacyBot" for historical continuity.

## 1. Executive Summary

LegacyBot (publicly: BiographyBot) is a voice-first life story preservation application that helps families capture and archive the oral histories of their loved ones. An AI interviewer powered by Google Gemini Live conducts empathetic, real-time voice conversations with storytellers, guided by context and questions set up by a family administrator ("Archivist"). The resulting audio, transcripts, timelines, and AI-generated memoirs form a permanent, searchable family archive.

---

## 2. Target Audience

- **The Storyteller**: Seniors (often non-technical) who want to share their life experiences in a natural, conversational way. They need a minimal interface — one button to start, and nothing to learn.
- **The Archivist**: Family members or biographers who set up the "Dossier," define the "Story Queue," manage family access, and review archived results. They are comfortable with a more complex interface.

---

## 3. Key Requirements

### 3.1 Conversational Interviewing

- **Active Listening**: The system must use high-fidelity, low-latency voice interaction (Gemini Live).
- **Interviewer Logic**: The bot acts as an active interviewer — it asks follow-up questions, seeks clarifications, and bridges related topics. It does not simply play back pre-written questions.
- **Brevity and Pacing**: The interviewer keeps its own responses brief (1–3 sentences). It does not recap what was just said, does not over-empathize, and gives the storyteller room to speak.
- **Non-Interruptive**: The bot waits for natural pauses before prompting. The storyteller may interrupt the bot at any time; the bot gracefully yields.
- **Warm-up Protocol**: Every session begins with a warm greeting that addresses the storyteller by name to build rapport before archival work begins.
- **Personality Modes**: Archivists choose one of three interviewer styles:
  - *Empathetic Biographer*: warm, attentive, brief encouragement
  - *Oral Historian (Investigative)*: precise, focused on dates and facts
  - *Casual Grandchild*: informal, enthusiastic

### 3.2 Archival and Persistence

- **"Never Delete" Policy**: Every word spoken and every audio recording must be preserved permanently.
- **Audio Format**: Sessions are recorded as mixed audio (storyteller + interviewer) and stored in Google Cloud Storage as WebM/Opus at 128 kbps (~58 MB/hour). Both sides of the conversation are captured.
- **Real-time Transcripts**: Transcripts are streamed to Firestore entry-by-entry during the session, not batched at the end.
- **Partial Session Recovery**: If the connection drops, all audio chunks and transcript entries captured up to that point are saved. No data is lost on ungraceful disconnection.
- **Transcript Editing**: Both archivists and storytellers may edit transcript entries after the session. The original text is always preserved in `editHistory`. The edit is displayed in place; the original remains accessible.

### 3.3 The Dossier and Story Queue

- **Dossier Persistence**: The Dossier is stored in Firestore and persists across all sessions. It is created once by the Archivist and refined over time.
- **Storyteller Profile**: Each Dossier has a required storyteller name, plus optional free-text context (background, era, location).
- **Family Tree Context**: A list of relatives (names and relations) so the bot can acknowledge people when mentioned. Importable from GEDCOM 5.5 files.
- **Historical Context**: General background on the storyteller's life (e.g., "Grew up in rural Ohio in the 1950s").
- **Story Queue (Questions)**: The core question list. Each question tracks:
  - **Unasked**: not yet raised
  - **InProgress**: raised but not fully explored
  - **Completed**: richly covered and summarized
- **Archivist Override**: Archivists may manually reset question status and edit findings at any time.
- **Gap Analysis Auto-population**: After each session, a server-side Cloud Function runs a deep analysis of all transcripts and auto-generates new Story Queue questions (marked `source: 'gapAnalysis'`) to fill gaps in the storyteller's life history. These appear in the Story Queue alongside manual questions.
- **Interviewer Notes**: A free-text field for the archivist to leave private notes for the AI (e.g., "Ralph has trouble hearing — speak slowly").

### 3.4 Family-Based Access Control

- **Families**: The top-level organizational unit. A family contains members (with roles) and dossiers.
- **Two Roles**:
  - **Admin/Archivist**: creates and manages dossiers, invites members, reviews sessions and analysis, exports memoirs. Has full read/write access.
  - **Storyteller**: records sessions only. Auto-redirected to their linked dossier's session view on login. Cannot access DossierEditor, MemberManagement, or other admin UI.
- **Invitation Workflow**: Admins invite new members by email. Invitees receive a link with a UUID token. After signing in or creating an account, they click Accept. The system creates their member record and grants access.
- **Multiple Families**: A user may belong to more than one family. On login, if multiple families exist, they see a family picker.
- **Data Isolation**: Firestore security rules and Cloud Storage rules (via custom claims) enforce that users can only access families they belong to.

### 3.5 Session History and Review

- **Session List**: Browse all past sessions for a storyteller, sorted by date.
- **Transcript Review**: Full transcript with speaker labels and timestamps, editable by both roles.
- **Audio Playback**: Stream archived WebM audio for any session directly in the app.
- **Audio Clips**: Create named clips from any point in a session's audio; stored in Cloud Storage.
- **Question Progress Dashboard**: Cross-session view of Story Queue status (Unasked / InProgress / Completed) with accumulated findings.

### 3.6 AI-Generated Insights

**Client-side (immediate, after each session):**
- Life events extracted from the transcript → Events Timeline
- Storyteller engagement and comfort assessment
- 3–5 suggested follow-up questions for the next session

**Server-side (holistic, across all sessions):**
- **Gap Analysis**: Cloud Function identifies timeline gaps (decades with no events), theme gaps (career, travel, hardship, etc.), and implied-but-unexplored threads (people or places mentioned in passing but never followed up). Results feed directly into the Story Queue as new questions.

### 3.7 Engagement and Re-engagement

- **Digest Email**: If 2–7 days have passed since the last session, the system sends a warm re-engagement email to the storyteller at 7am their local time. The email includes a narrative summary and the top Story Queue questions. Sent at most once every 2 days.
- **Admin Nudge**: Admins can manually trigger the digest email at any time from the DossierEditor, bypassing the timing gate.
- **Email Setup**: Uses Gmail SMTP with an app password. Configuration is stored as a Firebase Cloud Function secret (`SMTP_PASS`).

### 3.8 Memoir Generation

- The system can synthesize a readable life-story narrative from all session transcripts using Gemini.
- Output: Markdown document, viewable in the app and exportable as PDF or Markdown file.
- Stored in Firestore (content) and Cloud Storage (exported file).

### 3.9 Events Timeline

- Life events extracted by AI are stored per dossier with date, description, and a link back to the source session.
- Displayed as a chronological timeline. Dates may be approximate (e.g., "1952" or "1952–1958").

### 3.10 Media Gallery

- Archivists can upload photos and documents to a dossier's media gallery.
- Uploaded files are stored in Cloud Storage and linked to the dossier.
- Prompt photos can be shown to the storyteller by the AI mid-session to spark memories.

### 3.11 Talk About My Family

A low-stakes, unstructured conversational mode distinct from the formal interview.

- **Storyteller experience**: Press a green "Talk About My Family" button on the dashboard. The AI greets them and invites open-ended conversation — no agenda, no question list.
- **Not recorded**: Audio is not archived. No session document is created. The conversation is not preserved as a transcript.
- **Informed AI**: Before connecting, the system fetches recent interview transcripts and life events so the AI can reference what the storyteller has already shared, making the conversation feel continuous and connected.
- **Fact capture**: If the AI learns something new or hears a correction to prior sessions, it calls `recordFact` to save a lightweight **Miscellaneous Fact** to Firestore. Facts are not visible to the storyteller but appear in the DossierEditor as "Additional Notes" for the archivist.
- **Corrections**: If a fact corrects something from a prior session, `isCorrection` is flagged and `correctionNote` explains what it amends. This creates a basis for future reconciliation.
- **Archivist visibility**: MiscFacts appear in the DossierEditor's "Additional Notes" panel, ordered by date. Corrections are visually distinguished with an amber "Correction" badge.
- **Future work**: A reconciliation pass will detect inconsistencies across transcripts and MiscFacts and surface them in subsequent interview sessions or as Story Queue questions.

---

## 4. User Experience Goals

- **Storyteller simplicity**: One large Start/Stop button. The archivist management panel is never visible to storytellers. They should feel like they are having a conversation, not using software.
- **Archivist power**: The DossierEditor is the archivist's hub. All setup, review, and management happens there.
- **Feedback**: Visual waveform animation shows the bot is listening or speaking.
- **Error recovery**: If a connection drops, the app shows a reassuring message (not a technical error), preserves all captured data, and offers a simple Reconnect button. The storyteller should never feel they've "lost" their story.
- **Connectivity awareness**: A pre-session latency probe warns the archivist if the connection may be unreliable, before starting.
- **Accessibility**: Minimal decisions for the storyteller. Gemini handles the conversation flow; the storyteller just talks.

---

## 5. Non-Functional Requirements

### 5.1 Security

- All data is encrypted at rest (AES-256) and in transit (TLS) by Firebase/GCP defaults.
- Firebase Auth custom claims (`familyIds`) enforce family-scoped Cloud Storage access without Firestore lookups.
- No credentials or project IDs are committed to version control. `.env.local` and `.firebaserc` are gitignored; contributors use `.env.example` and `.firebaserc.example`.

### 5.2 Privacy

- On the paid Gemini tier (billing enabled), conversation data is not used to train Google models and is not retained long-term. **This is a critical configuration requirement for production** — see Privacy & Security in the README.
- Firebase Auth always processes data in the United States. Firebase Firestore and Storage regions are set at project creation time.

### 5.3 Performance

- Live session latency must be acceptable for natural voice conversation (Gemini Flash model, `thinkingLevel: MINIMAL`).
- Audio chunks are flushed every ~10 seconds to Cloud Storage so session data is never more than ~10s behind.
- Firestore composite indexes are defined for all compound queries (status + time, status + order).

### 5.4 Reliability

- Session data is durable: Firestore transcripts persist in real-time; audio chunks are buffered and flushed on any disconnect.
- Cloud Functions use `maxInstances` limits on expensive functions (`onSessionCompleted`, `sendDailyDigest`) to control costs.

### 5.5 Hosting

- The app is deployed to Firebase Hosting at **https://biographybot.com** (also accessible at `https://<your-project>.web.app`).
- Production builds are generated with `npm run build` (Vite) and deployed with `firebase deploy --only hosting`.
- CI runs lint, type-check, and tests on every push to `main` but does not auto-deploy; hosting deploys are currently manual.
- A single-page app rewrite rule routes all paths to `index.html`.

### 5.6 License

Apache 2.0 — Copyright 2026 Andrew Brook. All source files carry the standard Apache 2.0 header.

---

## 6. Out of Scope (Future)

- Vector/semantic search across transcripts (planned: Vertex AI)
- Read-only sharing links for family members outside the app
- E2E automated tests (planned: Playwright)
- Bundle code splitting / chunk optimization (issue #96)
- Firebase App Check (endpoint abuse protection)
- TTS-based chapterized session summaries
