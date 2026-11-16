# Testing and monitoring plan

Written 2026-11-15. Status of each item is marked **done**, **partly**, or **to do** as of that date.

## The question this plan answers

*Can a storyteller sit down right now, talk, and have their story recorded, kept, and shared with their
family?*

That is what "up and running" means for BiographyBot. A page that loads is not it. Today the hourly
uptime probe and the post-deploy smoke test confirm the page loads and renders; neither signs in, and
nothing checks that a conversation works, that the recording is kept, or that the family's email links
go anywhere. The link in every invitation email pointed at a dead address until 2026-11-15 and no check
noticed, because no check follows the path a person takes.

So the plan is organised around the journeys a person takes, and every journey gets a test that runs
before release and a monitor that runs after.

## The journeys

| # | Journey | What must be true |
|---|---|---|
| J1 | Sign in | An invited person can sign in and lands on their family. |
| J2 | Start a session | Pressing Start gets a live interviewer speaking within a few seconds. |
| J3 | Have a conversation | The interviewer hears the storyteller, waits through pauses, answers sensibly, uses their name, and drops a topic when asked. |
| J4 | Keep the recording | When the session ends, the whole recording is in storage and plays back. No session continues unrecorded. |
| J5 | Keep the transcript | Every turn is saved in order, with the right speaker. |
| J6 | Understand it afterwards | Events, engagement, story-queue updates and the refined transcript appear, and are true to what was said. |
| J7 | Tell the family | Notification and invitation emails arrive, and their links open the right page. |
| J8 | Write the memoir | A memoir is generated whose every quotation is something the storyteller said. |
| J9 | Read it | A family member sees what their role allows, and nothing else. An outsider sees nothing. |
| J10 | Leave | Export, deletion, restore and purge do what the privacy statement says. |

## The material to test with

Tests need families. There are two, and they are never mixed.

- **The fictional Furtado family** (`evals/family/`). Invented, public, committed. It has a ground-truth
  timeline, seven transcripts with planted cases and known answers, synthetic audio, and hostile inputs.
  Anything that needs content a person can read, quote in a bug report, or commit uses this.
- **The private corpus.** Real sessions in production. Used only by evals that print numbers and never
  content (`evals/groundedness.ts`, `evals/family/corpus-shape.ts --real`). Nothing from it enters this
  repository; `evals/pii/scan.ts` enforces that.

The fictional family is tidier than real speech, by a measured amount (see its README). Where mess
matters, the private corpus is the judge.

## Tests, by layer

Each layer catches what the one below cannot. Cost and run time rise as you go down, so the cheap layers
run on every push and the expensive ones on a schedule.

### T0. Static checks: on every push. **Done.**

Type-check (app, functions, evals), lint, the bundle secret scan, the model-id drift test, and the
fixture's 17 structural invariants. Add: `npm run typecheck:evals` to CI (**to do**, one line).

Not in CI and cannot be: the personal-data scan needs a denylist that CI must not hold. It is a
pre-commit step for anything touching `evals/` or fixtures, and it is run over the whole tree during
every audit.

### T1. Unit tests: on every push. **Done, with a known hole.**

418 app tests and 49 function tests. The hole: the main functions file, which holds every callable and
trigger, is exercised by none of them, and component tests mock the session library wholesale, so no
unit test can see a broken live-session configuration.

### T2. Access rules: on every push. **To do. Highest value item in this plan.**

There are no tests of the Firestore or Storage rules. Build a role-by-path matrix on the emulator from
the fixture's five accounts, which were chosen for exactly this:

| Account | Role | Must be able to | Must not be able to |
|---|---|---|---|
| `fx-marisa` | admin | read and manage everything in the family | touch another family |
| `fx-teo` | storyteller | read and write his own dossier and sessions | read his sister's recordings or transcripts |
| `fx-graciete` | storyteller | the same, for hers | the same, for his |
| `fx-noah` | member, no role | read what members may | write sessions, edit dossiers, see admin notes |
| `fx-outsider` | signed in, no family | nothing | read anything under the family, by any route |
| (nobody) | signed out | nothing | anything |

One test per cell, for every collection and every Storage prefix, for get, list, create, update and
delete. Add the lifecycle cases: a soft-deleted dossier, a removed member, a server-only field. Needs
`firebase.json` emulator config and `@firebase/rules-unit-testing`. About a day. A change to the rules
then fails CI if it opens a cell that was closed.

### T3. Callable contracts: on every push. **To do.**

For each of the 19 callables: called signed out, called by the outsider, called by the wrong role,
called with another family's ids, called with a hostile argument. The expected answer in each case is a
refusal. `adversarial.json` holds the hostile arguments. Start with the ones that spend money or return
data: the three model brokers, `getMediaUrl`, `searchContext`, `exportDossier`, `generateMemoir`.

Do this by splitting handlers out of the main file into builder functions (the brokers already are),
which is what makes them testable without the emulator.

### T4. Pipeline evals on the fictional family: nightly and before release. **To do; fixture done.**

Run the real post-session pipeline over the seven transcripts and score against the bible. All of this
is deterministic scoring; no judge.

| Check | Scored how |
|---|---|
| Events found | Recall against `expect.events`; every event's date, people and place against the timeline |
| Nothing invented | Precision: any event with no counterpart in the timeline is a failure |
| Self-correction | `teo-03` yields 1978 and never 1979 |
| Disagreement kept | The crossing appears with both accounts, flagged, not merged to one |
| Fuzzy date | "The winter after the volcano started" resolves to early 1958 |
| Speaker | Marisa's line is attributed to Marisa |
| Declined topic | Nothing is extracted about the illness; no suggested question pushes on it |
| Invented place | No history is asserted for the cordage works |
| Tired session | `teo-04` produces no events and a low-engagement assessment |
| Memoir | Every citation is verbatim from a transcript; no dated claim contradicts the timeline |
| Refinement | `audio/teo-04.webm` transcribes to its script; word error rate reported |

Run each three times and report the spread, not one number: a single pass of a sampled model is a
measurement without an error bar. Record model ids, cost and latency with each run and keep the runs,
so a model change is a comparison and not an impression. Estimated cost per full pass: under a dollar.

Then the subjective remainder (is the memoir prose good, are the suggested questions good), with a
rubric judge calibrated once against the owner's own ratings of about twenty chapters. Design is in
`evals/README.md`. This comes last because it is the least certain to pay.

### T5. Live session canary: after every deploy and daily. **To do. Second-highest value.**

A headless driver that takes the same path the browser does: sign in as a fixture storyteller, mint a
live token through the callable, open the live connection with the production configuration, and play
the probe clips into it.

| Probe | Pass means |
|---|---|
| connect | Setup completes and the interviewer speaks first, within 5 seconds |
| `probe-name.ogg` | The preferred-name tool is called with "Teo"; the next turn uses it |
| `probe-date.ogg` | The transcript carries 18 June 1966 |
| `probe-decline.ogg` | The next three interviewer turns do not mention the hospital or the illness |
| `probe-invented-place.ogg` | The reply says it has no information; no founding date or owner is offered |
| latency | End of speech to first reply under 2 seconds (measured 0.76 to 0.94 in September) |
| session end | The session document is completed, the transcript has every turn, the recording exists and has the session's duration |

A working template exists in the sibling weather app's eval driver. This is the test that would have
caught a live-model configuration error before a storyteller did, and it is the only layer that can.
Cost: a one-minute session is a few cents; daily plus per-deploy is a few dollars a month.

A lighter version, hourly: mint a token and complete setup, no audio. It costs nothing and catches an
expired key, a retired model and a broken broker.

### T6. Browser end-to-end: before release. **To do.**

Playwright against a preview channel, signed in as a fixture account, with Chromium's fake microphone
fed from a probe clip. Covers what the headless canary cannot: the buttons, the recording indicator, the
transcript appearing on screen, the session ending cleanly when the person navigates away, and what each
role sees on the family and memoir pages (J9). Add one check for every page that it renders hostile
names from `adversarial.json` as text.

### T7. Email: before release and weekly. **To do.**

Send each kind of email to a test inbox and assert: it arrived, the sender passes SPF and DKIM, every
link resolves to the production site and returns the app, and hostile names are escaped. The fixture
uses `.example` addresses, which cannot receive mail, so the sender must refuse `.example` recipients
outright and the email test must use a real test inbox. Both are small changes.

### T8. Lifecycle drills: quarterly. **To do.**

On a seeded copy of the fictional family: export, soft-delete, restore, soft-delete again, purge, and
confirm that nothing remains in the database, storage or the search index, and that the audit record
does. Once a quarter, restore the database from backup into a scratch project and confirm the family is
there. A backup that has never been restored is a hope.

## Monitoring, once it is released

### M1. Outside-in: is the journey working? **Partly.**

- **Done:** hourly HTTP probe and daily headless page load from the uptime repository; a failing check
  opens an issue and assigns it.
- **To do:** report the hourly light canary and the daily full canary (T5) the same way, under the same
  issue convention. This is the single most useful addition: it turns "the page loads" into "a session
  works".
- **To do:** a weekly email canary (T7).

### M2. Inside-out: what is failing right now? **To do.**

The project has no alert policies at all. Add, in Cloud Monitoring, routed to email:

| Alert | Condition |
|---|---|
| Function errors | Any function over 5% errors in 15 minutes, or any error at all in the session-completion, memoir, export or purge functions |
| Session pipeline stalled | A session completed more than 30 minutes ago with no analysis and no error |
| Email failures | Any failed send |
| Broker refusals | A spike in permission-denied or rate-limited calls to the model brokers |
| Slow sessions | Token minting over 3 seconds at the 95th percentile |
| Scheduled jobs | The daily digest or the purge did not run |

And one thing the server cannot see: failures in the browser. A session that halts because the
connection dropped, or a microphone that never opened, is invisible today. Add a small client error
report (kind of failure, app version, no content) so that "sessions are halting" becomes a number.

### M3. Is the data still whole? **Partly.**

- **Done:** `evals/groundedness.ts` checks every stored citation resolves (206 of 206 and 83 of 83 when
  first run).
- **To do, nightly:** run it on a schedule; add orphan checks (a completed session with no recording or
  no transcript; a recording with no session); alert on any failure.
- **To do:** the backup drill in T8.

### M4. Is it costing what it should? **To do.**

Budget alerts on the project at 50, 90 and 100 percent of a monthly figure; a daily count of model calls
and live minutes per account (issue #160); an alert on any day that is several times the trailing
average. The product has eight accounts. A day with unusual volume is either a relative's long weekend
of storytelling or a problem, and both are worth knowing.

### M5. Will something expire under us? **Partly.**

- **Done:** the daily audit compares every model id in the code against the provider's deprecation page
  and checks dependency alerts.
- **To do:** the same for the function runtime and for the speech model the audio generator names.

### M6. Is anyone where they should not be? **To do.**

Specifics are in the private security audit, not in this public document. In outline: turn on access
logs for the database and storage; alert on every new account (there have been eight in nine months,
so each one is news), on any change to access rules or project permissions, and on any deploy that did
not come from the pipeline.

## The fictional family in production

T5, T6 and M1 need the Furtado family to exist somewhere they can sign in. Two ways to do it.

**Option A: a second Firebase project for testing.** Seed the family there. Everything destructive (T2,
T3, T6, T8) runs there or on the emulator and can never touch a real family. Costs an afternoon to set
up and little to run. It does not tell you production works.

**Option B: the family lives in production too**, marked `syntheticFixture: true`. The canary signs in
as Teo against the real system, which is the only way to know the real system works. It needs care:
real sign-in accounts whose credentials are held as secrets; canary sessions cleaned up after each run;
the family excluded from digests, real-corpus statistics and the personal-data denylist (the last two
are already done); and no mail ever sent to its `.example` addresses.

**Recommendation: both.** A for everything that writes or destroys, B for a small read-mostly canary
(one short session a day, deleted afterwards). B is the part that answers the question at the top of
this page.

Neither is set up yet. Seeding production and creating sign-in accounts are decisions for the owner;
`evals/family/seed.ts` is ready and refuses to write to a real project without an explicit flag.

## Order of work

| Step | What | Effort | Why this order |
|---|---|---|---|
| 1 | Access-rule tests on the emulator (T2) | 1 day | Guards the most sensitive boundary; nothing else can |
| 2 | Alert policies and budget alerts (M2, M4) | half a day | Zero alerting today; cheap |
| 3 | Test project, seeded (Option A) | half a day | Unblocks 4 to 7 |
| 4 | Live session canary, headless (T5), reporting to the uptime issues (M1) | 2 days | The test that answers "does a session work" |
| 5 | Pipeline evals on the fixture (T4), nightly | 2 days | Makes a model or prompt change measurable |
| 6 | Callable contract tests (T3) | 2 days | Needs the handlers split out; pays for itself in the audit |
| 7 | Browser end-to-end (T6) and email test (T7) | 2 days | Covers what the canary cannot see |
| 8 | Production canary (Option B), nightly integrity checks (M3) | 1 day | Needs steps 3 and 4 proven first |
| 9 | Client error reporting; lifecycle and restore drills (T8) | 2 days | Slower-moving risks |
| 10 | Judge-based evals for prose | open | Least certain; do last |

## What "healthy" looks like

A short list to check any morning. If all of these hold, the answer to the question at the top is yes.

- The last deploy's smoke test and canary passed.
- The hourly probe and light canary have passed for 24 hours.
- Yesterday's full canary passed all seven probes, with reply latency under 2 seconds.
- No alert is open. No function error rate is above its line.
- Last night's integrity check found every citation and no orphans.
- Spend is within the budget's curve for the day of the month.
- No model id or runtime in use is within 60 days of retirement.
- No new account, rule change or out-of-pipeline deploy that nobody can explain.

## Decisions needed from the owner

1. A test Firebase project (Option A): create it, or name an existing one to use.
2. The fictional family in production (Option B): yes or no, and if yes, where its sign-in credentials
   live.
3. A monthly budget figure for the alerts.
4. A test inbox for the email checks.
5. Where alerts go beyond email, if anywhere.
