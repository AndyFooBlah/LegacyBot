# LegacyBot (BiographyBot) — Project Journal

Append-only project journal (per the global policy in `~/.claude/CLAUDE.md`).

- Every entry starts with a UTC timestamp and a tag, newest at the bottom:
  `- 2026-10-17T04:42Z [decision] …`
- Tags: `[step]` `[decision]` `[friction]` `[learning]` `[surprise]` `[incident]` `[idea]` `[milestone]`.
- **Append-only.** Never edit or delete a past entry; to correct one, append a new entry naming the earlier one's timestamp.

> Established 2026-10-17 per the new journal policy. Entries below the
> "Live journal" line are written as work happens. The "Reconstructed backfill"
> section was recreated from git history and session records; its timestamps are
> the relevant commit times (UTC) and are approximate for anything that predates
> establishment.

---

## Reconstructed backfill (from git history + session records)

- 2026-07-10T17:09Z [milestone] Repository baseline (`f3e6c32`), publicly branded **BiographyBot** (biographybot.com); the GitHub repo and codebase keep the name "LegacyBot". History before this point was squashed into the baseline — it already folds in the voice-first interview flow, the manual-VAD "response patience" work, the double-greeting echo-mute fix, robust reconnection, the ~36K→~14K system-prompt reduction, and the session-UI work (compact top control bar, elapsed recorded-time readout, animated "Listening…" placeholder for the user's turn, and tool-name + truncated-arguments rows in the live transcript). Firebase project `legacybot-4814e`.
- 2026-07-10T17:42Z–18:47Z [milestone] Security remediation pass (from the 2026-07-09 review): fixed critical claim-flow privilege escalations (#154); withheld adminNotes chunks from non-admin `searchContext` callers; capped `invokeGemini` input size + lowered the daily quota (#156); moved media to short-lived signed URLs instead of persisted download tokens (#155); pointed SECURITY.md at GitHub private vulnerability reporting.
- 2026-08-30T01:31Z [step] Security hardening batch (`a3d348e`): reject SVG image uploads in `storage.rules` (#157 — sandboxed XSS on direct-open); email the password-reset link to the member instead of returning it to the admin caller, failing closed when SMTP is unconfigured (#158); drop the raw user query from `searchContext` logs, keeping only its length (#138). Verified #159 (set/merge on possibly-absent docs) and #140 (ephemeral-token security docs) were already resolved — no code change needed.
- 2026-08-31T04:34Z [milestone] Post-session transcript refinement pipeline shipped (#123, `e742ebc`): `onSessionCompleted` runs a higher-quality offline STT pass over the archived mixed audio and replaces the low-latency real-time transcript, preserving the original in `editHistory`. Also fixed a latent bug found in passing where the transcript-embedding step read `transcript` as a collection and silently embedded nothing. (STT model at the time: `gemini-3.1-pro-preview` — later migrated; see 2026-09-19.)
- 2026-09-11T05:02Z–05:14Z [milestone] Data-governance + housekeeping pass: dossier data lifecycle (soft-delete + 30-day restore, audited purge, export, consent, refinement opt-out); refuse refinement when `session.audioUrl` is not the session's own recording; dropped the shut-down `gemini-3.1-flash-lite-preview` date/time path; verbatim Apache-2.0 LICENSE; dep bumps; moved deps to `@andyfooblah/knowledge-common@^1.3.1` and `voice-common@0.14.1`.
- 2026-09-12T05:44Z–06:01Z [step] Functions platform work: memoirs collection-group index required by `cleanErrorMemoirs`; firebase-admin / firebase-functions version alignment; dependency-group bump (#172).
- 2026-09-18T23:14Z–2026-09-19T18:39Z [decision] Model migration to the Sept-2026 stable line — live sessions → `gemini-3.8-live`, all batch Flash → `gemini-3.8-flash`, replacing `gemini-3.1-pro-preview` **everywhere** (including the #123 refinement pass); dropped a non-existent model from the `invokeGemini` allow-list; added CI to compile+test `functions/` on every push/PR; added a deterministic groundedness eval. Rationale (global model policy): 3.8-live / 3.8-flash are the newest stable in their class at the same price, and Pro (Feb 2026) is no longer worth defaulting to for these tasks. Current published deps: `voice-common@^0.15.0`, `knowledge-common@^1.3.1`.

---

## Live journal

- 2026-10-17T04:42Z [milestone] Journal established per the new global policy; backfilled above from git history + session records.
- 2026-10-17T04:42Z [learning] Model research for transcription, verified against ai.google.dev (both models public preview): **`gemini-3.5-transcribe`** is ASR-only (~2.6% WER, 85+ languages, native diarization + word timestamps, custom-vocabulary biasing, ~$0.005/min) — a stronger, cheaper fit for the #123 batch refinement than a general Pro/Flash model, but NOT a drop-in: no custom `responseSchema`, generic "speaker 1/2" labels, and our archived audio is a mixed stream, so it needs a parse/role-map adapter (or per-track recording). **`gemini-3.5-transcribe-live`** is also ASR-only (no voice output, no tool calling, no session resumption), so it **cannot** replace the conversational interviewer (`gemini-3.8-live`); it could only serve as an auxiliary side channel streaming word-by-word user captions (fixes the end-of-turn-only input-transcription limitation) at ~$0.009/min extra.
- 2026-10-17T04:42Z [idea] Follow-ups from the model research, pending owner go-ahead: (1) migrate the #123 refinement STT to `gemini-3.5-transcribe` with a native-output parse/role-map adapter (prefer per-track recording to sidestep diarization ambiguity); (2) optional auxiliary `gemini-3.5-transcribe-live` channel for live user captions, replacing the "Listening…" placeholder (extra cost + preview-status risk).

<!-- Appended by the "BiographyBot Gemini live voice upgrade" session, which did the
     2026-09-18/19 model work. Append-only: nothing above this line was altered. The
     entries above record WHAT changed; these record why it was hard and what was
     measured, which would otherwise be lost. -->

- 2026-09-18T22:30Z [surprise] The thing that nearly broke every session, and the reason the
  `gemini-3.8-live` move was not a one-line change: the three Live models **disagree about
  `thinkingConfig`**. Measured directly against the API — `gemini-3.8-live` rejects the field
  (`1007 Thinking level is not supported for this model`); `gemini-3.8-live-extended-thinking`
  requires one but rejects `MINIMAL`; `gemini-3.1-flash-live-preview` required one. voice-common
  0.14.x sent `MINIMAL` unconditionally, so swapping only the model id would have closed every
  session at setup. The failure presents as a WebSocket close, i.e. a connection fault, not a
  config error — the same disguise as the April 2026 auto-greet `1007`.
- 2026-09-18T22:35Z [decision] Rather than hardcode the new id in the library, voice-common 0.15.0
  added `liveModel` and `thinkingLevel` options with **defaults unchanged**, so each app opts in
  separately. This is why CarBot and weatherbot-app could stay on the old model for a day without
  being broken by the library bump.
- 2026-09-18T22:40Z [learning] Measured before switching, three trials each, end-of-turn to first
  speech: 3.1-flash-live-preview `MINIMAL` 0.78/0.75/0.75s; `gemini-3.8-live` 0.87/0.94/0.76s;
  `gemini-3.8-live-extended-thinking` `HIGH` 1.13/1.09/0.95s. 3.8-live costs ~100ms over the
  preview; extended thinking ~300ms. Plain 3.8-live is the right default for an interviewer.
- 2026-09-18T22:45Z [learning] The upgrade bought **no new capability**. Input transcription still
  arrives as a single event at end of turn on 3.8-live, in both automatic and manual VAD modes, so
  the "Listening…" placeholder stays. The case for the move was preview-to-stable at identical
  price, not a feature.
- 2026-09-18T22:50Z [surprise] `silenceDurationMs=10000` **was** honoured, by the 3.1 preview as
  well as 3.8-live — neither barged into an 8s mid-sentence gap. That contradicts the July 2026
  conclusion that the native-audio model ignores large values. The July test was a real room with a
  live mic; mine used digital silence. Most likely the server honours the value and **background
  noise retriggers the VAD**, which is the same failure voice-common 0.9.1 fixed client-side. If so,
  issue #142 is a noise problem, not a turn-control problem. Not acted on: deciding it needs a
  real-mic test, which an agent cannot run.
- 2026-09-19T17:30Z [decision] Owner: *"I expect 3.8 Flash to outperform 3.5 Pro on most tasks that
  BiographyBot uses. Please replace it."* All seven `gemini-3.1-pro-preview` call sites moved to
  `gemini-3.8-flash` (f9c936c, #182), so the app now runs one batch model. (The owner said "3.5
  Pro"; the code was on 3.1 Pro, and no 3.5 Pro exists.) A session had recommended holding the two
  memoir call sites pending a side-by-side read; the owner's instruction superseded that and all
  seven moved together.
- 2026-09-19T17:35Z [learning] Evidence behind that swap, since there is no BiographyBot eval
  corpus to measure it: Wind Spirit's 102-case study found the Pro reference scored the same as 3.8
  Flash on rule checks and on the LLM judge at three times cost and latency, and Pro resisted false
  input **worse** (obeyed bad advice 6/10 vs Flash 2/10). Measured here on the audio refinement
  path: Pro, 3.8 Flash and 3.7 Flash returned identical transcripts, Flash ~3x faster (1.8s vs
  5.9s). Verified separately that 3.8 Flash accepts the same `thinkingLevel: HIGH` and genuinely
  spends thinking tokens — the Live-model thinking rejection does **not** apply to `generateContent`.
- 2026-09-19T17:40Z [friction] `functions/` cannot import from `src/`, so `REASONING_MODEL` has to
  be declared twice. Added a drift test that reads the frontend copy off disk and fails if they
  disagree, or if either becomes a preview id — and deliberately broke it to confirm it actually
  fails, rather than trusting an untested guard.
- 2026-09-19T18:39Z [milestone] First eval: a deterministic groundedness check (1f7930d). Both
  generative outputs cite their sources, so fabrication is checkable without a judge —
  `StoryEvent.sources[].entryIndices` must index real transcript entries, and each
  `ChapterCitation.quote` must appear verbatim in the entry it cites. Baseline on production data:
  **206/206 event indices resolved, 83/83 memoir quotes verbatim**, across 66 events and 11 chapters.
- 2026-09-19T18:40Z [learning] That baseline was generated **by Pro, before the switch** in the same
  day's f9c936c. It is therefore the regression test for that switch: re-run it once memoirs have
  been generated on 3.8 Flash. Nobody has done that yet.
- 2026-09-19T18:45Z [incident] Counting the Firestore data to build an eval corpus turned up a
  product gap, not a data problem: **no dossier has a consent record**, though `Dossier.consent` and
  its editor UI both ship. 42 of 99 sessions belong to three named relatives; the other 57 are the
  owner's own dossier. Building an eval corpus from third-party family stories was therefore left as
  an owner decision rather than assumed, and nothing was built from the relatives' sessions.
- 2026-09-19T18:45Z [surprise] The session data is far thinner than it looks for eval purposes: 99
  sessions but a median of 45–63 seconds, only **3** sessions of 10 minutes or longer, and 2 memoirs
  in total. Gap analysis and memoir generation run over whole interviews, so the existing corpus
  cannot exercise them. A real corpus needs synthetic long-form dossiers regardless of the consent
  question.
- 2026-09-19T18:50Z [idea] For the subjective half of the evals: shrink the subjective set first
  (the citation checks above), then decompose — `SessionEngagement` is already a typed judgment, not
  prose — and only then a 1–5 rubric judge for memoir prose and question quality. Two things no
  harness in this account has yet: repeat runs (Wind Spirit scored the same 45 observations seven
  times and got 45/37/41/44/45/45/40) and a human calibration set so the judge is scored against the
  owner rather than trusted blind. Design written up in `evals/README.md`.
