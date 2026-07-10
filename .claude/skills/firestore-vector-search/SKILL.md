# Skill: Firestore Vector Search Setup

Use this skill when you need to implement, debug, or repair semantic/vector search using Firestore's `findNearest()` API.

---

## Overview

Firestore supports vector similarity search via `findNearest()`. Setting it up correctly requires getting **four independent things** right simultaneously. Each one fails silently or with a confusing error. Missing any one of them produces zero results with no clear error message.

The four things:
1. Embeddings stored as `FieldValue.vector()` (not plain arrays)
2. `findNearest()` called with the object-style API + `.get()`
3. A composite vector index created via `gcloud` (not `firebase deploy`)
4. TypeScript compiled before deploy (no stale JS)

---

## Step-by-Step Setup

### 1. Store embeddings as VectorValue

When writing embeddings to Firestore, **always** wrap the `number[]` with `admin.firestore.FieldValue.vector()`:

```typescript
// WRONG — silently stores as plain array, findNearest returns zero results
embedding: vectors[i]

// CORRECT
embedding: admin.firestore.FieldValue.vector(vectors[i])
```

The field type in your interface should be typed as `any` (VectorValue is not exported from firebase-admin types):

```typescript
export interface ContextChunk {
  // ...
  embedding: any;  // actually admin.firestore.VectorValue at runtime
}
```

**If you have existing documents with plain arrays**, they must be migrated — Firestore will not auto-convert them. Write a one-time migration script:

```typescript
import * as admin from 'firebase-admin';
admin.initializeApp();
const db = admin.firestore();

const snap = await db.collectionGroup('contextChunks').get();
const batch = db.batch();
let count = 0;
for (const doc of snap.docs) {
  const emb = doc.data().embedding;
  if (Array.isArray(emb)) {
    batch.update(doc.ref, {
      embedding: admin.firestore.FieldValue.vector(emb),
    });
    count++;
  }
}
await batch.commit();
console.log(`Migrated ${count} documents`);
```

Run with: `npx ts-node --project functions/tsconfig.json migrate.ts`

### 2. Use the object-style findNearest API

The positional API (`findNearest(field, vector, options)`) is **deprecated** and broken in firebase-admin v13+. It returns a `VectorQuery` object synchronously rather than a Promise. `await`-ing it just gives you the VectorQuery back — `.docs` is undefined, `?? []` evaluates to `[]`. Zero results, no error.

```typescript
// WRONG — deprecated positional style, returns VectorQuery not Promise
const vectorSnap = await chunksRef.findNearest('embedding', queryVector, {
  limit: 20,
  distanceMeasure: 'COSINE',
});
const hits = vectorSnap.docs ?? [];  // ALWAYS [] — docs is undefined on VectorQuery

// CORRECT — object-style + .get()
const vectorSnap = await chunksRef.findNearest({
  vectorField: 'embedding',
  queryVector: admin.firestore.FieldValue.vector(queryVector),
  limit: 20,
  distanceMeasure: 'COSINE',
}).get();
const hits = vectorSnap.docs ?? [];
```

The `queryVector` passed to `findNearest` must also be wrapped in `FieldValue.vector()`.

### 3. Create the vector index via gcloud

`firebase deploy --only firestore:indexes` does **not** create vector indexes, even if you add a `fieldOverrides` entry to `firestore.indexes.json`. It silently skips them.

You must use `gcloud` directly:

```bash
gcloud firestore indexes composite create \
  --project=YOUR_PROJECT_ID \
  --collection-group=YOUR_COLLECTION \
  --query-scope=COLLECTION \
  --field-config=vector-config='{"dimension":"768","flat":"{}"}',field-path=embedding
```

Replace:
- `YOUR_PROJECT_ID` — your Firebase project ID
- `YOUR_COLLECTION` — the collection group name (e.g. `contextChunks`)
- `768` — must match your embedding model's output dimensionality exactly

Check index status (takes 1–10 minutes to go from CREATING → READY):

```bash
gcloud firestore indexes composite list --project=YOUR_PROJECT_ID
```

When the index is CREATING, `findNearest` throws `FAILED_PRECONDITION`. The error message includes the exact `gcloud` command you need — copy it verbatim. Handle this gracefully in your function:

```typescript
try {
  const snap = await chunksRef.findNearest({ ... }).get();
  vectorHits = snap.docs ?? [];
} catch (err: any) {
  if (err?.code === 9 || String(err).includes('FAILED_PRECONDITION')) {
    logger.warn('[searchContext] Vector index not ready, falling back to keyword-only search');
    vectorHits = [];
  } else {
    throw err;
  }
}
```

### 4. Build TypeScript before deploying functions

Firebase deploys the compiled JS in `functions/lib/`, not the TypeScript source. If there's no predeploy build step, every `firebase deploy --only functions` uploads stale JS. TypeScript changes are never reflected in production.

Add to `firebase.json`:

```json
"functions": {
  "source": "functions",
  "runtime": "nodejs22",
  "predeploy": ["npm --prefix \"$RESOURCE_DIR\" run build"]
}
```

To verify your deployed code is current, compare the `lib/index.js` modification time against the TypeScript source files:

```bash
ls -la functions/lib/index.js functions/src/index.ts
```

If `lib/index.js` is older, you have stale JS. Run:

```bash
cd functions && npm run build && cd ..
firebase deploy --only functions
```

---

## Debugging Zero Results

When `findNearest` returns zero results, check in this order:

### Check 1: Is the TypeScript compiled?

```bash
ls -la functions/lib/index.js functions/src/index.ts
```

If `lib/index.js` is older than your `.ts` file → build and redeploy.

### Check 2: Are embeddings stored as VectorValue?

Fetch a sample doc and inspect the field type:

```typescript
const doc = await db.collection('families/FAMILY_ID/contextChunks').limit(1).get();
const emb = doc.docs[0].data().embedding;
console.log('is Array:', Array.isArray(emb));
console.log('constructor:', emb?.constructor?.name);
// Should print: is Array: false, constructor: VectorValue
```

If `is Array: true` → migrate (see Step 1 above).

### Check 3: Is the vector index ready?

```bash
gcloud firestore indexes composite list --project=YOUR_PROJECT_ID
```

Look for an entry with `vectorConfig` and `dimension: 768`. Status must be `READY`, not `CREATING`.

If missing → create it (see Step 3 above).

### Check 4: Are you using object-style findNearest?

Search your function code for `findNearest(` — if it's followed by a string literal (e.g. `findNearest('embedding',`), you're using the deprecated positional style. Fix to object-style + `.get()`.

---

## Viewing Function Logs

`firebase functions:log` only shows framework-level output (cold starts, request/response). Application-level `console.log` and `logger.info` are **invisible** to this CLI.

Use Cloud Logging directly:

```bash
# Recent logs from a specific function (replace service_name with lowercase function name)
gcloud logging read \
  'resource.type="cloud_run_revision" resource.labels.service_name="searchcontext"' \
  --project=YOUR_PROJECT_ID \
  --limit=50 \
  --format=json | python3 -c "
import json,sys
for entry in json.load(sys.stdin):
    ts = entry.get('timestamp','')
    msg = entry.get('jsonPayload', {}).get('message') or entry.get('textPayload','')
    if msg: print(ts[:19], msg)
"
```

Note: service name in Cloud Run is the function name lowercased with hyphens removed (e.g. `searchContext` → `searchcontext`).

---

## Embedding Model Dimensions

The dimension in the vector index must exactly match `outputDimensionality` in your embedding call:

```typescript
// embeddings.ts
ai.models.embedContent({
  model: 'gemini-embedding-001',
  contents: text,
  config: { taskType, outputDimensionality: 768 },  // must match index
});
```

If you change `outputDimensionality`, you must:
1. Delete the old vector index
2. Create a new one with the new dimension
3. Re-embed all existing documents

---

## Common Error Messages

| Error | Cause | Fix |
|---|---|---|
| `FAILED_PRECONDITION: ... vector index` | Index doesn't exist or is still CREATING | Create via gcloud, wait for READY |
| `Cannot read properties of undefined (reading 'length')` | Using deprecated positional findNearest API | Switch to object-style + `.get()` |
| Zero results, no error | Plain array stored instead of VectorValue | Migrate existing docs, fix writeChunks |
| Zero results after migration | Stale JS deployed | Build functions, redeploy |
| `Embedding response missing values` | Wrong model name or API key | Verify GEMINI_API_KEY and model ID |

---

## Quick Checklist

Before debugging "zero results from findNearest":

- [ ] `lib/index.js` is newer than `src/index.ts` (or predeploy hook exists in firebase.json)
- [ ] `writeChunks` wraps vectors with `FieldValue.vector()`
- [ ] `findNearest` uses object-style API with `.get()`
- [ ] `queryVector` in `findNearest` is wrapped with `FieldValue.vector()`
- [ ] Vector index exists and status is `READY` (`gcloud firestore indexes composite list`)
- [ ] Index dimension matches `outputDimensionality` in embedding call
- [ ] Existing documents were migrated (if embeddings were previously stored as plain arrays)
