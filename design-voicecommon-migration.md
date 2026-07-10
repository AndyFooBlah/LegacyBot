# LegacyBot → VoiceCommon Migration Plan

**Status:** ✅ Complete — implemented in commit c907dad (2026-04-17)  
**Scope:** Migrate LegacyBot's hand-rolled Gemini Live session management
(`useUnifiedSession.ts`) to use VoiceCommon's `useSession` hook, matching
the CarBot pattern. This is the final step to making VoiceCommon a truly
shared voice infrastructure layer.

---

## Current State

LegacyBot owns its entire Gemini Live session lifecycle directly:

- Calls `new GoogleGenAI({ apiKey })` and `ai.live.connect()` in two paths
  (initial connect + reconnect).
- Manages audio recording via AudioWorklet and `useAudioMixer`.
- Handles all `LiveServerMessage` dispatch: setup complete, audio chunks,
  tool calls, turn complete, interrupted/go-away.
- Performs auto-reconnect on unexpected disconnect (partial audio upload +
  seamless resume).
- Fires post-session analysis (event extraction, engagement, question
  suggestions) on finalize.
- Declares all 14 tool `FunctionDeclaration` objects inline via `buildTools()`.

VoiceCommon's `useSession` hook already handles most of this: audio,
LiveServerMessage dispatch, tool calls, session archival, auto-reconnect,
and the `onToolCall` callback pattern (as CarBot uses).

---

## End-State Architecture

```
useUnifiedSession.ts  (LegacyBot, ~200 lines, thin wrapper)
  └─ useSession (VoiceCommon)          ← Gemini Live, audio, archival, reconnect
       └─ onToolCall callback          ← dispatches to KC tools + LB-specific tools
  └─ post-session analysis             ← LegacyBot-specific, stays here
  └─ emotional observation side-effect ← LegacyBot-specific, stays here
```

### Tools split after migration

| Tool | Lives in | Notes |
|---|---|---|
| `searchWikipedia` | `knowledge-common` | already migrated |
| `computeTimeDifference` | `knowledge-common` | already migrated |
| `computeTimeOffset` | `knowledge-common` | already migrated |
| `searchPlace` | `knowledge-common` | needs proxy adapter (see below) |
| `getDistanceBetweenPlaces` | `knowledge-common` | needs proxy adapter |
| `getWeather` | `knowledge-common` | needs proxy adapter |
| `getJoke` | `knowledge-common` | no key needed; can use KC directly |
| `updateQuestionStatus` | LegacyBot | app-specific |
| `reportEmotionalObservation` | LegacyBot | app-specific |
| `showPhoto` | LegacyBot | app-specific |
| `setPreferredName` | LegacyBot | app-specific |
| `endSession` | LegacyBot | VC provides this via `onSessionEndRequest` |
| `recordFact` | LegacyBot | app-specific |
| `identifySpeaker` | LegacyBot | app-specific |
| `searchContext` | LegacyBot | app-specific (Firestore vector search) |

---

## Work Required

### 1. VoiceCommon: verify `useSession` covers LegacyBot's session needs

LegacyBot's session management has features not yet confirmed in VC's
`useSession`:

| Feature | LegacyBot does it | VC `useSession` status | Action |
|---|---|---|---|
| Gemini Live connect/reconnect | ✅ | ✅ (check implementation) | Verify |
| Auto-reconnect on go-away/error | ✅ | Needs verification | Audit VC source |
| AudioWorklet recording | ✅ via `useAudioMixer` | ✅ VC owns this | No action |
| Audio archive to GCS on finalize | ✅ | ✅ VC owns this | No action |
| Transcript sync to Firestore | ✅ | ✅ VC owns this | No action |
| Session creation in Firestore | ✅ | ✅ VC owns this | No action |
| `onToolCall` callback | ✅ CarBot pattern | ✅ VC owns this | No action |
| Pre-session context loading | ✅ (dossier, questions, etc.) | ❌ app must pass `systemInstruction` | Already supported — VC takes `systemInstruction` param |
| Post-session analysis trigger | ✅ on finalize | ❌ app-specific; use VC's `onSessionEnd` callback | Need `onSessionEnd` callback in VC |
| Emotional observation side-effects | ✅ on tool call | ❌ app-specific; handled in `onToolCall` | No VC change needed |
| Custom Firestore fields per session | ❌ LB doesn't do this | ✅ CarBot does via `setSessionCarbotFields` | LB can add if needed |
| `reconnectSession` (manual re-entry) | ✅ two-path connect | May differ in VC | Audit |

**Likely VC change needed:** Add `onSessionEnd?: () => void` callback to
`UseSessionOptions` so LegacyBot can trigger post-session analysis when
VoiceCommon finalizes the session.

### 2. Maps/Weather/Jokes proxy adapter

LegacyBot proxies Maps, Weather through Cloud Functions for API key security.
KC's versions call APIs directly with a key in browser config — wrong
security model for LegacyBot.

**Option A (recommended for now):** Keep LegacyBot's `externalSearch.ts`
for Maps/Weather/Jokes. Pass those tool definitions alongside `allKnowledgeTools`
in the tool list. `onToolCall` routes to the right handler based on name.

**Option B (future, cleaner):** Add `proxyUrls` to KC's config:
```ts
initializeKnowledgeCommon({
  geminiApiKey: '...',
  proxyUrls: {
    maps: 'https://.../geoProxy',
    weather: 'https://.../geoProxy',
  },
});
```
KC's Maps/Weather tools would call the proxy URL instead of the direct API.
LegacyBot could then use KC for all tools without the client-side key concern.
**This is the right long-term design** — it allows KC to be used in
security-sensitive apps without client-side key exposure.

### 3. LegacyBot-specific `useSession` wrapper

After migration, `useUnifiedSession.ts` becomes a thin wrapper:

```ts
export function useUnifiedSession(options: UseUnifiedSessionOptions) {
  const session = useSession({
    userId: options.familyId,          // or a combined key
    systemInstruction,
    tools: [...allKnowledgeTools, ...buildLBTools(options)],
    onToolCall: async (name, args) => {
      // KC tools
      if (name === 'searchWikipedia') return searchWikipedia(...);
      // Maps/Weather via local proxy (until Option B above)
      if (name === 'searchPlace') return searchPlace(args.query as string);
      // LB-specific tools
      if (name === 'updateQuestionStatus') return updateQuestionStatus(...);
      // etc.
    },
    onSessionEndRequest: options.onSessionEndRequest,
    onSessionEnd: () => runPostSessionAnalysis(),   // new VC callback
  });

  return session;
}
```

`buildLBTools()` returns the 8 LegacyBot-specific `FunctionDeclaration`
objects currently built inline in `buildTools()`.

### 4. `useSession` Firestore path conflict

VoiceCommon's `useSession` writes to a `sessions` collection. LegacyBot
also writes to a `sessions` collection but under a `families/{familyId}/`
path prefix. These must be reconciled:

- **LegacyBot path:** `families/{familyId}/dossiers/{dossierId}/sessions/{sessionId}`
- **VC path:** `sessions/{sessionId}` (flat, keyed by userId)

**Options:**
1. VC adds a `collectionPath` config option — app can override where sessions
   are stored. This is the cleanest approach.
2. LegacyBot continues to manage its own Firestore writes and only uses VC
   for audio/connection management. Less clean but lower risk.
3. LegacyBot migrates its Firestore session schema to VC's flat layout.
   Requires data migration and UI updates.

**Recommendation:** Option 1 — add `sessionsCollection?: string` to
`UseSessionOptions` in VoiceCommon. Default `'sessions'`; LegacyBot passes
`'families/${familyId}/dossiers/${dossierId}/sessions'`. This is a backward-
compatible additive change.

---

## Implementation Order

1. **Audit VoiceCommon `useSession`** — read source, confirm auto-reconnect
   behavior, identify any missing callbacks (`onSessionEnd`).

2. **Add VC changes (non-breaking):**
   - `onSessionEnd` callback to `UseSessionOptions`
   - `sessionsCollection` option for custom Firestore path
   - Bump VC to v0.4.0

3. **Extract LB's tool declarations** from `buildTools()` into a separate
   file `src/services/tools.ts` (static declarations, no hook dependency).
   This is a pure refactor, no behavior change.

4. **Implement the thin `useUnifiedSession` wrapper** around VC's `useSession`.
   Keep the existing `useUnifiedSession.ts` untouched; create a new
   `useUnifiedSessionV2.ts` and test side-by-side.

5. **Cut over** — swap `useUnifiedSession` for `useUnifiedSessionV2` in
   `SessionView.tsx` (or wherever the hook is consumed). Run full test suite.

6. **Delete** `useUnifiedSession.ts` and all now-unused session plumbing
   in LegacyBot (direct `GoogleGenAI`, `ai.live.connect`, etc.).

---

## What Will NOT Move to VoiceCommon

These are LegacyBot-specific and belong in the app forever:

- `buildSessionInstruction()` / `gemini.ts` — dossier, storyteller context,
  interviewing personality, question guidance
- Post-session analysis (event extraction, engagement assessment, question
  suggestions)
- Emotional observation logging
- `searchContext` (Firestore vector search over family stories)
- All LB-specific tool declarations
- Family/dossier data model, storage schema, Firestore rules

---

## Broader End-State: All Knowledge Tools in KC, All Voice Infra in VC

Beyond the LegacyBot migration, the full end-state for both libraries:

### KnowledgeCommon end-state
All stateless knowledge retrieval tools available to any agent:
- Wikipedia RAG ✅ (done)
- Google Maps geocoding + distance ✅ (done; proxy adapter needed for LB)
- Google Maps Weather ✅ (done; proxy adapter needed for LB)
- Jokes ✅ (done)
- Date/time parsing ✅ (done)
- *Future:* Recipe lookup, news search, currency exchange, unit conversion

### VoiceCommon end-state
All voice session infrastructure, reusable across any Gemini Live app:
- Gemini Live session lifecycle ✅ (done)
- Audio recording + mixing ✅ (done)
- Firebase session archival ✅ (done)
- GCS audio upload ✅ (done)
- Auto-reconnect ✅ (done, verify)
- `useAuth` ✅ (done)
- `buildSessionInstruction` (generic base only; apps add their own context) ✅
- `onSessionEnd` callback ❌ (add in v0.4.0)
- Custom session collection path ❌ (add in v0.4.0)
