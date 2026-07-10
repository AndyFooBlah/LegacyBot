# LegacyBot browser smoke test

Operator-driven read-only smoke test. An agent (Claude via `claude-in-chrome`)
navigates each route, runs `e2e/probe.js` to capture page shape + console
errors, and reports failures. No writes, no data modifications.

**Target**: https://<your-project>.web.app
**Precondition**: user is already signed in in the active Chrome tab, and is
an `admin` or `storyteller` of at least one family.

## Run it

1. Open the target site in a tab. Confirm you're signed in.
2. Tell the agent: "run e2e/browser-smoke.md against LegacyBot".
3. The agent opens each route, runs `probe.js`, and reports pass/fail.
4. A clean run ends with "0 console errors, N routes passed".

## Harness (what the agent does, per route)

1. `navigate` to the URL.
2. Wait ~500ms for client-side render.
3. Inject `e2e/probe.js` via `javascript_tool` — returns
   `{url, title, h1, h2s, nav, main, buttonTexts[], linkTexts[], errors[]}`.
4. Run `read_console_messages` with pattern `error|warn` — append to errors.
5. Assert the route-specific expectations below. Any failure → report and
   continue to next route. Never click destructive buttons (see "Do NOT
   click" list).

## Routes

Expectations use substring match unless noted. `$familyId` is captured from
the first family card on `/` (data-testid=`family-card` if present, else
first `<a href="/family/...">`). `$dossierId` is captured similarly from
the first dossier link on `/family/$familyId`.

### Top-level

| # | URL | Expect | Notes |
|---|-----|--------|-------|
| 1 | `/` | h1 or prominent text matches `Your families` or `Choose a family` or `Create a family` | FamilySelector. Capture `$familyId`. |
| 2 | `/create-family` | visible heading `Create a new family` and a form `<input>` | Don't submit. |
| 3 | `/invite?email=fake@example.com` | shows invite UI or "no matching invite" — never a redirect to `/login` | Read-only. |

### Family-scoped (admin)

| # | URL | Expect | Notes |
|---|-----|--------|-------|
| 4  | `/family/$familyId` | page loads; see nav buttons "Family" or "My Sessions" in header | FamilyHome |
| 5  | `/family/$familyId/tree` | heading mentions `tree` or an SVG/graph element renders | FamilyTreePage |
| 6  | `/family/$familyId/info` | heading mentions `Family information` or tabs for events/facts/profiles | FamilyInfo |
| 7  | `/family/$familyId/info/events` | list or empty-state text about events | FamilyEventsPage |
| 8  | `/family/$familyId/info/facts` | list or empty-state text about facts | FamilyFactsPage |
| 9  | `/family/$familyId/info/profiles` | list of member profiles | FamilyProfilesPage |
| 10 | `/family/$familyId/memoirs` | page loads; heading mentions `Memoirs` | MemoirLibrary |
| 11 | `/family/$familyId/storyteller` | page loads — either storyteller dashboard or "not a storyteller" | StorytellerDashboard |

### Dossier-scoped

Capture `$dossierId` from the first dossier link on `/family/$familyId`.

| # | URL | Expect | Notes |
|---|-----|--------|-------|
| 12 | `/family/$familyId/dossier/$dossierId` | DossierEditor form fields (name, bio, etc.) | Don't edit. |
| 13 | `/family/$familyId/dossier/$dossierId/history` | session list or "No sessions yet" | SessionList |
| 14 | `/family/$familyId/dossier/$dossierId/memoir` | memoir view or "No memoir yet" | MemoirViewer |
| 15 | `/family/$familyId/dossier/$dossierId/events` | events timeline or empty state | EventsTimeline |
| 16 | `/family/$familyId/dossier/$dossierId/media` | media gallery or empty state | MediaGallery |

### Session page (read-only mode)

Only visit if the dossier has ≥1 completed session (captured from #13).

| # | URL | Expect | Notes |
|---|-----|--------|-------|
| 17 | `/family/$familyId/dossier/$dossierId/history/$sessionId` | transcript text visible | TranscriptViewer |

**Skipped on purpose**: `/family/$familyId/dossier/$dossierId/session` — this
is the live interview page. It requests a mic and starts a Gemini Live
session. Read-only audit can't exercise it.

## Do NOT click

The agent must not click anything matching these patterns — they modify
data or initiate paid API calls:

- `Delete`, `Remove`, `Clear`
- `Generate memoir`, `Trigger digest`, `Backfill`
- `Reset password`, `Update email`, `Invite`
- `Start session`, `Begin interview`, `Talk`
- `Save`, `Submit`, `Confirm` on any form
- `Sign out`

## Failure triage

When a route fails, include in the report:

- The URL
- What was expected vs what was found (h1, buttonTexts, first 3 console errors)
- Whether the page redirected (final URL after navigate)
- Any `401`/`403`/`5xx` network requests captured from `read_network_requests`

## Verified routes log

Agent should append a one-liner per run to `e2e/last-run.txt`:

```
2026-04-18 14:32 UTC — 17/17 passed, 0 console errors
```

Do not commit `last-run.txt` — it's operator output, not source.
