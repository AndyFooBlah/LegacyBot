# Testing BiographyBot (LegacyBot)

Three levels. Only the first runs in normal CI.

| Level | Command | Network / key | What it proves |
|---|---|---|---|
| Offline tests | `npm test`, and `npx vitest run` in `functions/` | none | The app's logic, and that every Gemini Live code path uses the one model constant with the exact setup we expect |
| Live suite | `npm run test:live` | real Gemini Live API, `GEMINI_API_KEY` | That setup is accepted and behaves correctly against the real service, today |
| Live canary | `.github/workflows/live-contract.yml` | same, weekly in CI, **off by default** | It still works next week, without waiting for a storyteller to find out |

For the wider plan (access rules, pipeline evals, monitoring) see
[docs/testing-and-monitoring-plan.md](docs/testing-and-monitoring-plan.md). This file covers the voice
session.

## Where the Live configuration lives

| What | Where |
|---|---|
| The Live model id | `LIVE_MODEL` in `src/services/gemini.ts`. The only place it is written. |
| Thinking level | `LIVE_THINKING_LEVEL = 'auto'`, same file. VoiceCommon's model registry turns it into the `thinkingConfig` the model accepts (none for the current model, which rejects the field). |
| Voice, patience, turn-taking mode, tool declarations, opening cue | `src/services/liveSession.ts` (pure: no React, DOM or Firebase) |
| The system instruction | `buildSessionInstruction` in `src/services/gemini.ts` |
| The token the session connects with | `functions/src/liveToken.ts`, minting the request in `functions/src/liveTokenConfig.ts` |

Every Live code path in the app:

| Path | What it does | Model and config |
|---|---|---|
| `src/hooks/useUnifiedSession.ts` | The interview. Calls VoiceCommon's `useSession`, which builds the connect config with `buildLiveConnectConfig`. | `buildSessionLiveOptions()` + `buildSessionTools()` from `liveSession.ts` |
| `src/components/shared/SystemDiagnostics.tsx` | The diagnostics page's "Gemini Live" probe: a raw WebSocket. | `probeLiveSetup()` in `src/services/liveProbe.ts`: `LIVE_MODEL`, the thinking config from VoiceCommon's `resolveThinkingConfig`, the constrained endpoint the SDK uses for ephemeral tokens; green only on `setupComplete` |
| `functions/src/liveToken.ts` | Mints the single-use ephemeral token. | No model: the token is not tied to one (`LIVE_TOKEN_MODEL_CONSTRAINT` is null). Mints on `v1alpha`; the client connects on `v1alpha`. |

There is no other path. The old "Talk About My Family" view, a second direct connection with its own
configuration, was unreachable and was deleted (#213).

## 1. Offline tests

No network, no key; every push and pull request.

| File | Covers |
|---|---|
| `src/__tests__/services/liveSession.test.ts` | The exact setup message a session sends, built by VoiceCommon's real `buildLiveConnectConfig` from the app's real inputs for the fictional family: no `thinkingConfig`, LOW end sensitivity, `silenceDurationMs` from the dossier, the voice, sixteen tools in order, resumption and compression on. `'auto'` thinking equals the old hand-set `'none'`. The default wait, a long wait, and `'manual'` turn mode. |
| `src/__tests__/hooks/useUnifiedSessionLiveConfig.test.tsx` | The hook itself: renders `useUnifiedSession` with VoiceCommon real except for a spy on `useSession`, and checks the options, tools, instruction and opening cue it passes produce that setup. |
| `src/__tests__/services/liveProbe.test.ts` | The diagnostics probe: URL, setup message, success only on `setupComplete`, the close code and reason on rejection, the token never in an error, and that `SystemDiagnostics` opens no WebSocket of its own. |
| `src/__tests__/services/liveTokenContract.test.ts` | Client and broker cannot drift: the mint API version against the connect version, a model lock (if ever added) against `LIVE_MODEL`, and that the callable mints with the shared request. |
| `src/__tests__/liveModelGuard.test.ts` | Scans `src/`, `functions/src/`, `scripts/`, `evals/`, `e2e/` and fails on a Live model id outside the constant file, a legacy or shut-down Live id anywhere, or an unverified Live-looking id. Requires `LIVE_MODEL` to be `current` in VoiceCommon's registry. |
| `functions/src/__tests__/liveToken.test.ts` | The callable mints with exactly the shared request (single use, 30-minute expiry, 1-minute window) on the shared API version, with the server-side key and nothing else. |

A history comment that must name an old model carries the marker `model-history:` on the same line.

## 2. The live suite

```bash
# The key exists only in this process's environment. Never write it to a
# file, and never give it a VITE_ prefix (that would build it into the bundle).
GEMINI_API_KEY="$(gcloud secrets versions access latest --secret=GEMINI_API_KEY --project=legacybot-4814e)" \
  npm run test:live

# Optional: a results table.
LIVE_RESULTS_FILE=/tmp/live.jsonl GEMINI_API_KEY=... npm run test:live
node scripts/summarize-live-results.mjs /tmp/live.jsonl
```

Without `GEMINI_API_KEY` every live test is skipped and the command exits green. The files are
`src/__tests__/live/*.live.test.ts`, run by `vitest.live.config.ts` (Node, one file at a time, one retry)
and excluded from `npm test`.

**What goes over the wire is the production configuration.** `src/__tests__/live/furtadoSession.ts`
builds it with the production builders for the fictional Furtado family in `evals/family/`: the real
`buildSessionInstruction`, the real tool declarations, the dossier's voice and wait, and the connect
config from `buildLiveConnectConfig`, the function `useSession` calls. No real family's data is used,
ever. The checks come from `@andyfooblah/voice-common/testing`; its TESTING.md describes each one.

| File | Runs |
|---|---|
| `interviewSession.live.test.ts` | A returning session under server VAD with the dossier's 3 s wait: setup accepted; all sixteen tool declarations accepted; the opening cue yields a spoken greeting; a spoken turn is transcribed and answered; tool round trips with `recordFact` and with `searchContext` (stubbed result, which the bot must use); barge-in; session resumption across a reconnect; context compression; the model is listed; the ephemeral-token path; latency. Also setup and greeting for a first session. |
| `turnTaking.live.test.ts` | Patience at the default wait (1.5 s) and at a long one (5 s): a pause of 60% of the wait is one turn and the bot stays silent through it. Then `TURN_MODE = 'manual'`: setup, a manual turn, a tool round trip, barge-in, latency. |
| `greeting.live.test.ts` | The greeting arrives exactly once, for the largest instruction production builds (a full biography inlined, about 29,000 characters), the usual lean one, and a first session. After the greeting the microphone "opens" onto ten seconds of silence; the bot must not start over. A doubled greeting is a known historical defect, so this one fails loudly with the trace. |
| `tokenBroker.live.test.ts` | Mints a token exactly as the callable does (same request, same API version, the Cloud Functions package's own SDK when installed), opens a production session with it and gets the greeting; confirms the token is refused on a second use; runs the diagnostics probe with a real token; confirms the probe fails for a made-up token; confirms the URL form the probe used to use is refused. |

### Results, 2026-11-15

30 of 30 passed on the first attempt, in 5 minutes 17 seconds, against `gemini-3.8-live`. No warnings, no retries.

| Preset | Check | Result | Measured |
|---|---|---|---|
| greeting / returning-full-biography | greeting-once | pass | 29,116 char instruction; 1 greeting, 0 bytes of audio in the 10 s after |
| greeting / returning | greeting-once | pass | 12,356 char instruction; 1 greeting, 0 bytes of audio in the 10 s after |
| greeting / first-session | greeting-once | pass | 11,328 char instruction; 1 greeting, 0 bytes of audio in the 10 s after |
| interview / returning | setup | pass | setup in 292 ms, 16 tools, thinkingConfig omitted |
| interview / returning | tool-declarations | pass | 16 declarations accepted |
| interview / returning | text-turn | pass | first audio 819 ms, 9.26 s of speech |
| interview / returning | audio-turn | pass | transcribed 100%, first audio 3359 ms after speech |
| interview / returning / recordFact | tool-round-trip | pass | tool called in 616 ms, reply 783 ms after the result |
| interview / returning / searchContext | tool-round-trip | pass | tool called in 1415 ms, reply 2863 ms after the result |
| interview / returning | barge-in | pass | interrupted in 223 ms |
| interview / returning | session-resumption | pass | code word recalled after reconnect |
| interview / returning | context-compression | pass | accepted |
| interview / returning | model-listed | pass | listed, registry status current |
| interview / returning | ephemeral-token | pass | mint v1alpha, connect v1alpha, turn ran |
| interview / returning | latency | pass | median 3306 ms (min 3207, max 3325) |
| interview / first-session | setup | pass | setup in 243 ms, 16 tools, thinkingConfig omitted |
| interview / first-session | text-turn | pass | first audio 856 ms, 8.23 s of speech |
| token broker | broker-token-session | pass | minted with functions 1.47.0 SDK on v1alpha, connected on v1alpha, greeted |
| token broker | broker-token-single-use | pass | second use refused (close 1011) |
| diagnostics probe | probe-setup | pass | setupComplete in 320 ms |
| diagnostics probe | probe-rejects-bad-token | pass | made-up token rejected (close 1007) |
| diagnostics probe | legacy-url-refused | pass | old URL form refused (close 1007, API key not valid) |
| auto / wait=1.5s (default) | patience | pass | silent through a 900 ms pause, one turn, answered 1804 ms after speech |
| auto / wait=5s | patience | pass | silent through a 3000 ms pause, one turn, answered 5330 ms after speech |
| auto / wait=5s | audio-turn | pass | transcribed 100%, first audio 5322 ms after speech |
| manual | setup | pass | setup in 215 ms, 16 tools, thinkingConfig omitted |
| manual | manual-turn-control | pass | first audio 1086 ms after activityEnd |
| manual / recordFact | tool-round-trip | pass | tool called in 679 ms, reply 824 ms after the result |
| manual | barge-in | pass | interrupted in 76 ms |
| manual | latency | pass | median 1180 ms (min 889, max 1491) |

Things worth knowing from that run:

- **No doubled greeting**, at 29,116 characters or at the usual 12,356. One greeting, one `turnComplete`, then silence for ten seconds.
- **Patience is honoured.** With a 1.5 s wait the bot stayed silent through a 0.9 s pause and answered 1.8 s after speech ended; with 5 s, silent through 3 s and answered after 5.3 s. So under server VAD the time to first audio is the configured wait plus about 0.3 s.
- **Tool calls are asynchronous** on this model: the turn that issues a call ends at once (`turnComplete` arrives before the spoken reply to the result), and call ids start `call_`. The bot spoke a bridging phrase before `searchContext`, as the instruction asks.
- **Manual turn control** answers about 0.9 to 1.5 s after `activityEnd` and reports barge-in in under 0.1 s (0.2 s under server VAD).
- **The token is single use**: a second session with the same token is closed with 1011 "Token has been used too many times".
- **The old diagnostics probe could not fail.** The server accepts the WebSocket handshake for any token and validates only at setup; the URL form the probe used is refused for an ephemeral token the moment a setup is sent.
- With the production instruction the bot greets first whatever it hears: asked an unrelated general-knowledge question as its first input, it replied with its greeting. That is the instruction working, and in the app the opening cue always comes first.

### What it costs

A full run opens about forty short sessions and takes about five minutes. Each carries the 12,000 to
29,000 character instruction as text input, plus roughly three minutes of audio in and four out. At the
model's prices on 2026-11-15 that is an estimated 20 to 40 US cents a run, and under $1 in any case. A
weekly canary is on the order of $15 a year.

## 3. The canary

`.github/workflows/live-contract.yml` runs `npm run test:live` on `workflow_dispatch` and every Monday at
14:41 UTC.

- **Off by default.** The first step looks for the repository secret `LIVE_TEST_GEMINI_API_KEY`. Without
  it the job ends green with a notice and nothing is sent to the API. Paid-API tests stay off in CI unless
  the owner opts in.
- To turn it on (owner only), create a Gemini API key for this purpose, with a quota or budget alert of
  its own so a runaway cannot spend much, and store it:

  ```bash
  gh secret set LIVE_TEST_GEMINI_API_KEY --repo AndyFooBlah/LegacyBot
  ```

  Do not reuse the production key from Secret Manager: a key in GitHub is a second copy to rotate.
- Dependencies are installed with `npm ci --ignore-scripts` before the key is in scope. The job that
  holds the key has read-only permissions; a separate job, which runs no repository code, has
  `issues: write`.
- On failure it opens one issue titled "Live contract canary is failing", assigned to the owner, or
  comments on the open one. A later pass comments and closes it. The job summary has the results table.
- Actions are pinned by commit SHA.

## Changing the Live model

1. Check the provider's model and deprecation pages for the new id (do not go from memory; Live models
   are retired with little warning).
2. Make sure the installed `@andyfooblah/voice-common` knows it (`getLiveModelInfo(id)`); if not, that
   library's registry is updated and released first, with its own live suite.
3. Change `LIVE_MODEL` in `src/services/gemini.ts`. Nothing else names the model.
4. `npm test`: the guard and the pinned setup tell you what the change did to the setup message.
5. `npm run test:live`, and read the patience, greeting and latency lines, not just pass or fail.
6. Deploy, then open the diagnostics page: "Gemini Live" must be green.

## What is not covered

- **Sign-in and the callable.** The live suite mints its token directly with the API key, using the
  callable's own request. It does not sign in to Firebase, so it does not exercise the deployed
  `mintGeminiLiveToken` function: its auth check, its rate limit, its secret binding, or the deployed
  copy of the code. The diagnostics page does exercise all of that, for a signed-in person. An automated
  check needs a dedicated test account for the fictional family (see the plan, "The fictional family in
  production"); creating one, and holding its credentials, is the owner's decision.
- **The browser audio path.** The microphone, the AudioWorklet, playback, the recorder, the greeting
  mute and the client-side VAD used in `'manual'` mode run only in a browser. VoiceCommon tests them
  offline with mocks. Nothing here proves a recording was made and stored.
- **A real room.** The fixture audio is clean synthetic speech with digital silence. It shows the
  patience setting reaches the server and is obeyed. A real room has noise that can retrigger the
  server's VAD, which is why `'manual'` mode exists.
- **Firestore and Storage.** Session documents, transcripts and the stored recording are outside this
  suite.
- **Determinism.** Model output varies. Checks assert on structure (events, fuzzy word matches, a stub
  result being used), and a failed live test is retried once. A real break fails twice.
