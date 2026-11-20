# LegacyBot Deployment Checklist

## Architecture: server-side key broker (no Gemini key in the client)

The browser bundle contains **no Gemini or Maps API key**. All sensitive keys
live in Firebase Secret Manager and are used only by Cloud Functions:

- **Gemini Live (voice sessions)** — the client calls the
  `mintGeminiLiveToken` callable (`functions/src/liveToken.ts`), which mints
  a single-use ephemeral token with a ~30-minute expiry. The client opens the
  Live WebSocket with that token; the long-lived `GEMINI_API_KEY` never
  leaves the server. Token minting is per-user rate limited.
- **Gemini text / embeddings** — brokered through the `invokeGemini` and
  `embedGemini` callables (`src/services/geminiBroker.ts` on the client).
- **Maps / Weather** — brokered through the `geoProxy` callable using
  `GOOGLE_MAPS_API_KEY` from Secret Manager.

Two automated guards prevent key-leak regressions (see `CLAUDE.md`):
an ESLint rule that errors on `import.meta.env.VITE_GEMINI_*` reads, and a
post-build bundle scan (`scripts/check-bundle-for-secrets.mjs`, run
automatically by `npm run build`) that fails the build if anything shaped
like a secret appears in `dist/`.

Only the public Firebase web config (`VITE_FIREBASE_*` from `.env.local`) is
embedded in the bundle; it is constrained by Firestore/Storage security rules.

## Secrets setup (one-time, and on rotation)

```bash
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set GOOGLE_MAPS_API_KEY
firebase functions:secrets:set SMTP_PASS
# then redeploy functions to pick up new secret versions
firebase deploy --only functions
```

Because keys are server-side only, they need **no HTTP-referrer
restrictions**. Restrict them by API instead (Generative Language API for
Gemini; Geocoding + Weather for Maps) and keep per-day quotas low enough that
abuse is bounded.

## Local development

```bash
npm install
npm run dev        # Vite dev server on http://localhost:3003 (vite.config.ts)
```

Cloud Functions changes must be compiled before deploying:

```bash
cd functions && npm run build && cd ..
```

## Deploying

Always deploy from this app directory — `firebase deploy` uses the
`firebase.json` in the current working directory, not the `--project` flag,
so running it from a sibling checkout will deploy the wrong site.

```bash
# Everything (hosting predeploy runs `npm run build`, which includes the bundle secret scan):
firebase deploy

# Targeted:
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules,storage

# Preview channel:
npm run deploy:preview
```

## Post-deploy smoke test

After a hosting deploy:

1. `curl -s https://<your-project>.web.app/ | head` — confirm the app shell
   (not an error page) is served at the root.
2. Open the hosting URL, sign in.
3. Start a voice session; verify it connects (ephemeral Live token minted and
   accepted).
4. Open the in-app diagnostics page (`/diagnostics`); verify all tools
   report OK.
5. Spot-check the deployed bundle for secrets:
   `curl -s https://<your-project>.web.app/assets/<main>.js | grep -c AIza`
   should find only the public Firebase web key, nothing else.

## Rotating the Gemini key

If the server-side key is suspected compromised:

1. Mint a new key in GCP Console (API-restricted as above).
2. `firebase functions:secrets:set GEMINI_API_KEY` and paste the new key.
3. `firebase deploy --only functions`.
4. Delete the old key in GCP Console.
5. Watch functions logs for 403s (indicates a function still bound to the
   old secret version — redeploy it).

No client rebuild is needed: the browser never held the key.

## Recovering recordings

Recordings are the one thing here that cannot be regenerated, so they are protected in four layers.
Work down the list until you find the file.

| Layer | Protects against | Kept for |
|---|---|---|
| Rules: no client can delete anything in the bucket | A member, or a compromised account, deleting from the browser | n/a |
| Object versioning on the recordings bucket | A recording overwritten by a later upload | 90 days after it stops being current |
| Bucket soft delete | An object deleted outright, including by the purge | 30 days |
| Daily copy to `gs://legacybot-backup-us/recordings/` (separate project, multi-region) | Anything that goes wrong inside this project | 90 days per copy; re-copied while the original exists |

The backup function can create objects in the backup bucket and do nothing else there: it cannot
overwrite, delete or list. Each copy is named `<original path>.g<generation>`, so an overwritten recording
gets a new backup object and the old one stays.

```bash
B=gs://legacybot-4814e.firebasestorage.app
OBJ=<familyId>/<dossierId>/<sessionId>.webm

# 1. Overwritten: list every version, then copy the one you want back over the current one.
gcloud storage ls --all-versions "$B/$OBJ"
gcloud storage cp "$B/$OBJ#<generation>" "$B/$OBJ"

# 2. Deleted within the last 30 days: list soft-deleted objects, then restore.
gcloud storage ls --soft-deleted "$B/<familyId>/<dossierId>/"
gcloud storage restore "$B/$OBJ#<generation>"

# 3. From the off-project backup (needs access to the legacybot-backups project).
gcloud storage ls "gs://legacybot-backup-us/recordings/$OBJ*"
gcloud storage cp "gs://legacybot-backup-us/recordings/$OBJ.g<generation>" "$B/$OBJ"
```

The backup runs daily at 11:30 UTC (`dailyRecordingsBackup`). It throws if any object fails to copy, so a
failed run is visible in the scheduler and the logs. To run it by hand:

```bash
gcloud scheduler jobs run firebase-schedule-dailyRecordingsBackup-us-central1 --project legacybot-4814e --location us-central1
```

Transcripts, events and memoirs live in Firestore, which has point-in-time recovery (7 days), scheduled
backups (98 days) and a daily export to the same backup bucket. Within the app, only a family admin can
delete a transcript, an event or a session, and a dossier is soft-deleted with a 30-day restore window.

**What deletion means for privacy.** When a dossier is purged, every version of its files is removed from
the recordings bucket. Soft-deleted copies remain recoverable for 30 days and backup copies expire within
90 days of their last copy. Until then the data still exists, and the in-app privacy text says so.

