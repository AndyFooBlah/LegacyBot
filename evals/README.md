# BiographyBot evals

## What is here (updated 2026-11-15)

| Path | What it is |
|---|---|
| `family/` | **The fictional Furtado family**: ground-truth timeline, 7 transcripts, synthetic audio, adversarial cases, a typed seed script. Public and safe to commit. Start with `family/README.md`. |
| `pii/` | The guard that keeps real families out of this repo: a private denylist built from production, and a scanner for fixtures and for the whole tree. |
| `groundedness.ts` | Deterministic check that every stored citation resolves. Runs against real data, prints counts only. |

Real recordings, transcripts and memoir text never enter this repository (owner decision, 2026-10-18,
recorded in `JOURNAL.md`). Evals that need real content run against production or a private corpus and
print numbers only. Evals that need content you can read, quote and commit use the fictional family.

The overall plan for testing and monitoring is in `docs/testing-and-monitoring-plan.md`.

## Status of the real-data evals (written 2026-09-19)

One eval exists: `groundedness.ts`. It is deterministic, needs no LLM judge,
and needs no corpus — it checks artifacts the app has already stored.

A full end-to-end corpus is **not** built yet, for two reasons found on
2026-09-19:

1. **The data is too thin.** 99 sessions, but the median is 45–63 seconds and
   only 3 sessions are 10 minutes or longer. Gap analysis and memoir
   generation run over whole interviews; a one-minute session does not
   exercise them. There are 2 memoirs in total.
2. **Consent.** 57 of 99 sessions are the owner's own dossier, which is
   self-consent. The other 42 belong to three named relatives, and **no
   dossier has a consent record** even though `Dossier.consent` and the
   editor UI both exist. Building a corpus from third-party family stories
   is a decision for the owner, not a default.

Suggested corpus basis when that is settled: the owner's own dossier, plus
synthetic long-form dossiers for the cases real data lacks.

## Design for the rest

Three tiers, cheapest first, so the judge handles as little as possible.

**Tier 1 — deterministic.** Anything the schema can settle. This is unusually
powerful here because the data model already carries citations:
`StoryEvent.sources[].entryIndices` point into the transcript array, and
`ChapterCitation.quote` is a verbatim span. That makes memoir fabrication
directly checkable. `computeEngagementMetrics` also yields `speakingRatio`
and `avgResponseLength` with no model, which can cross-check the model's
`comfortScore`.

**Tier 2 — decomposition.** `SessionEngagement` is a typed judgment
(4-way sentiment enum, 0–100 score, flags), not prose. Ask it standalone
against transcript-derived ground truth rather than scoring it as part of a
combined prompt. Wind Spirit found an apparent model-quality gap disappeared
under decomposition: the ceiling was the prompt.

**Tier 3 — rubric judge.** Only memoir prose and question quality. Facts in
context, 1–5, anchored at 5/3/1 with "generic" as the explicit 3, schema
constrained, temperature 0, judge failure never fails the case.

Two additions the existing harnesses in this account do not have:

- **Repeat runs.** Wind Spirit measured the same 45 observations seven times
  and got 45, 37, 41, 44, 45, 45, 40. A single pass is an error bar nobody
  printed.
- **A human calibration set.** Rate ~20 chapters by hand once and score the
  judge against those, rather than trusting it blind. Judge bias is the thing
  none of the three existing harnesses solved.

## Running

```
GOOGLE_CLOUD_QUOTA_PROJECT=legacybot-4814e npm run eval:groundedness
```

Reads production Firestore with application-default credentials and prints
counts only. It never echoes transcript text.
