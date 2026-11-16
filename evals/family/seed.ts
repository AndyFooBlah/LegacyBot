// Copyright 2026 Andrew Brook
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Turns the fictional Furtado family (family.json + sessions/*.json) into the
 * Firestore documents the app expects, typed against src/types.ts so that a
 * change to the data model breaks this file at compile time rather than
 * leaving a stale fixture.
 *
 *   npx tsx evals/family/seed.ts                 # dry run: build, validate, print paths
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx evals/family/seed.ts --write
 *   npx tsx evals/family/seed.ts --write --project <id> --yes-this-is-a-real-project
 *
 * Every document carries `syntheticFixture: true`. evals/pii/build-denylist.ts
 * and evals/family/corpus-shape.ts skip anything so marked, so a seeded
 * synthetic family can live beside real ones without polluting either.
 *
 * It does NOT create sign-in accounts. A canary that signs in as the family
 * needs Auth users whose uids match `accounts[].uid`; creating those, and
 * holding their credentials, is a deliberate separate step (see
 * docs/testing-and-monitoring-plan.md, "Synthetic family in production").
 */

import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { Timestamp } from 'firebase/firestore';
import type {
  Dossier, Family, FamilyMember, FamilyMemberRecord, InterviewQuestion, RelationType,
  SessionMetadata, TranscriptEntry, UserProfile, UserRole,
} from '../../src/types';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_MARK = { syntheticFixture: true } as const;

interface Bible {
  family: { id: string; name: string };
  accounts: { uid: string; email: string; displayName: string; roles: string[]; personId: string | null }[];
  people: { id: string; firstName: string; lastName: string; preferredName?: string; memberType?: string; notes?: string; relations: { type: string; to: string }[] }[];
  dossiers: {
    id: string; personId: string; storytellerUid: string; selectedVoice: Dossier['selectedVoice']; personality: Dossier['personality'];
    responseWaitSeconds: number; storytellerContext: string; historicalContext: string; interviewerNotes: string;
    consent: { method: 'spoken' | 'written'; note: string };
    questions: { id: string; text: string; status: InterviewQuestion['status'] }[];
  }[];
}
interface FixtureSession {
  id: string; dossierId: string; title: string; startTime: string; durationSeconds: number;
  entries: { role: TranscriptEntry['role']; t: number; text: string; speakerLabel?: string; toolName?: string; toolArgs?: Record<string, unknown>; toolResult?: string }[];
}

export const loadBible = (): Bible => JSON.parse(readFileSync(join(HERE, 'family.json'), 'utf8'));
export const loadSessions = (): FixtureSession[] =>
  readdirSync(join(HERE, 'sessions')).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(join(HERE, 'sessions', f), 'utf8')));

const RELATION: Record<string, RelationType> = {
  parent: 'Parent', child: 'Child', spouse: 'Spouse', sibling: 'Sibling', friend: 'Friend', pet: 'Pet Owner',
};

export interface Doc { path: string; data: Record<string, unknown> }

/** Build every document. `ts` converts a Date into the store's timestamp type. */
export function buildDocs(ts: (d: Date) => Timestamp): Doc[] {
  const bible = loadBible();
  const sessions = loadSessions();
  const docs: Doc[] = [];
  const created = ts(new Date('2026-03-01T12:00:00Z'));
  const fam = `families/${bible.family.id}`;
  const admin = bible.accounts.find((a) => a.roles.includes('admin'))!;

  const tree: FamilyMember[] = bible.people.map((p) => ({
    id: p.id,
    name: `${p.firstName} ${p.lastName}`.trim(),
    firstName: p.firstName,
    lastName: p.lastName,
    ...(bible.accounts.find((a) => a.personId === p.id) ? { linkedMemberUid: bible.accounts.find((a) => a.personId === p.id)!.uid } : {}),
    relations: p.relations.map((r) => ({ type: RELATION[r.type], toMemberId: r.to })),
    ...(p.notes ? { notes: p.notes } : {}),
    memberType: p.memberType === 'pet' ? 'pet' : 'person',
  }));

  const family: Family = { name: bible.family.name, familyTree: tree, createdAt: created, createdBy: admin.uid };
  docs.push({ path: fam, data: { ...family, ...FIXTURE_MARK } });

  for (const a of bible.accounts) {
    const member = a.personId !== null;
    const profile: UserProfile = { email: a.email, displayName: a.displayName, createdAt: created, familyIds: member ? [bible.family.id] : [] };
    docs.push({ path: `users/${a.uid}`, data: { ...profile, ...FIXTURE_MARK } });
    if (!member) continue; // the outsider account belongs to no family, on purpose
    const record: FamilyMemberRecord = { roles: a.roles as UserRole[], email: a.email, displayName: a.displayName, joinedAt: created, invitedBy: admin.uid };
    docs.push({ path: `${fam}/members/${a.uid}`, data: { ...record, ...FIXTURE_MARK } });
  }

  for (const d of bible.dossiers) {
    const person = bible.people.find((p) => p.id === d.personId)!;
    const dossier: Dossier = {
      storytellerUid: d.storytellerUid,
      storytellerName: `${person.firstName} ${person.lastName}`,
      ...(person.preferredName ? { preferredName: person.preferredName } : {}),
      storytellerContext: d.storytellerContext,
      historicalContext: d.historicalContext,
      familyTree: tree,
      selectedVoice: d.selectedVoice,
      personality: d.personality,
      interviewerNotes: d.interviewerNotes,
      responseWaitSeconds: d.responseWaitSeconds,
      consent: { byUid: admin.uid, at: created, method: d.consent.method, note: d.consent.note },
      createdAt: created,
      updatedAt: created,
    };
    const base = `${fam}/dossiers/${d.id}`;
    docs.push({ path: base, data: { ...dossier, ...FIXTURE_MARK } });

    d.questions.forEach((q, order) => {
      const question: InterviewQuestion = { text: q.text, status: q.status, findings: '', order, createdAt: created, updatedAt: created };
      docs.push({ path: `${base}/questions/${q.id}`, data: { ...question } });
    });

    for (const s of sessions.filter((x) => x.dossierId === d.id)) {
      const start = new Date(s.startTime);
      const meta: SessionMetadata = {
        storytellerUid: d.storytellerUid,
        startTime: ts(start),
        endTime: ts(new Date(start.getTime() + s.durationSeconds * 1000)),
        audioUrl: `${bible.family.id}/${d.id}/${s.id}.webm`,
        status: 'completed',
        durationSeconds: s.durationSeconds,
      };
      docs.push({ path: `${base}/sessions/${s.id}`, data: { ...meta, ...FIXTURE_MARK } });
      const entries: TranscriptEntry[] = s.entries.map((e, i) => ({
        role: e.role,
        text: e.text,
        timestamp: ts(new Date(start.getTime() + e.t * 1000)),
        messageIndex: i,
        ...(e.speakerLabel ? { speakerLabel: e.speakerLabel } : {}),
        ...(e.toolName ? { toolName: e.toolName, toolArgs: e.toolArgs ?? {}, toolResult: e.toolResult ?? '' } : {}),
      }));
      docs.push({ path: `${base}/sessions/${s.id}/transcript/entries`, data: { entries } });
    }
  }
  return docs;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const project = args.includes('--project') ? args[args.indexOf('--project') + 1] : undefined;

  if (!write) {
    const docs = buildDocs((d) => d as unknown as Timestamp);
    const byKind = new Map<string, number>();
    for (const d of docs) { const k = d.path.split('/').filter((_, i) => i % 2 === 0).join('/'); byKind.set(k, (byKind.get(k) ?? 0) + 1); }
    for (const [k, n] of byKind) console.log(`${String(n).padStart(3)}  ${k}`);
    console.log(`\n${docs.length} documents built (dry run; nothing written). Add --write to seed.`);
    return;
  }

  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (!emulator && !(project && args.includes('--yes-this-is-a-real-project'))) {
    console.error('Refusing to write: set FIRESTORE_EMULATOR_HOST for the emulator, or pass --project <id> --yes-this-is-a-real-project.');
    process.exit(2);
  }
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp: AdminTimestamp } = await import('firebase-admin/firestore');
  initializeApp({ projectId: project ?? 'demo-biographybot' });
  const db = getFirestore();
  const docs = buildDocs((d) => AdminTimestamp.fromDate(d) as unknown as Timestamp);
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + 400)) batch.set(db.doc(d.path), d.data);
    await batch.commit();
  }
  console.log(`${docs.length} documents written to ${emulator ? `emulator ${emulator}` : `project ${project}`}.`);
}

if (process.argv[1]?.endsWith('seed.ts')) void main().catch((e) => { console.error(e); process.exit(1); });
