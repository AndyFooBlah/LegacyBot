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
 * Structural invariants of the fictional Furtado family (evals/family).
 *
 * The fixture is the ground truth for end-to-end evals, so it must be
 * internally consistent: a session that claims to mention an event must
 * mention it, ages must add up, and the planted test cases (a self-corrected
 * date, a disagreement between two storytellers, a declined topic) must be
 * where the `expect` block says they are.
 *
 * This is NOT the personal-data check. That one (evals/pii/scan.ts) needs a
 * private denylist built from production and cannot run in CI. What CI can
 * and does check here is the cheap part: only reserved example domains, and
 * the fiction notice present.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const DIR = join(process.cwd(), 'evals', 'family');
const bible = JSON.parse(readFileSync(join(DIR, 'family.json'), 'utf8'));
const sessions: any[] = readdirSync(join(DIR, 'sessions')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(DIR, 'sessions', f), 'utf8')));
const adversarial = JSON.parse(readFileSync(join(DIR, 'adversarial.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(DIR, 'audio', 'manifest.json'), 'utf8'));

const personIds = new Set<string>(bible.people.map((p: any) => p.id));
const placeIds = new Set<string>(bible.places.map((p: any) => p.id));
const eventIds = new Set<string>(bible.timeline.map((e: any) => e.id));
const person = (id: string) => bible.people.find((p: any) => p.id === id);
const year = (d: string) => Number(d.slice(0, 4));

describe('fictional family: the bible', () => {
  it('says plainly that it is fiction', () => {
    expect(bible._notice).toMatch(/ENTIRELY FICTIONAL/);
    expect(bible.family.syntheticFixture).toBe(true);
  });

  it('uses only reserved example domains for email', () => {
    for (const a of bible.accounts) expect(a.email).toMatch(/@[a-z.]+\.example$/);
    const everything = JSON.stringify([bible, sessions, adversarial]);
    const domains = [...everything.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)].map((m) => m[1]);
    for (const d of domains) expect(d.endsWith('.example')).toBe(true);
  });

  it('has no dangling references', () => {
    for (const p of bible.people) for (const r of p.relations) expect(personIds.has(r.to), `${p.id} -> ${r.to}`).toBe(true);
    for (const e of bible.timeline) {
      expect(placeIds.has(e.place), `${e.id} place`).toBe(true);
      for (const who of e.people) expect(personIds.has(who), `${e.id} person ${who}`).toBe(true);
    }
    for (const a of bible.accounts) if (a.personId) expect(personIds.has(a.personId)).toBe(true);
    for (const d of bible.dossiers) expect(personIds.has(d.personId)).toBe(true);
  });

  it('keeps reciprocal relations reciprocal', () => {
    const inverse: Record<string, string> = { parent: 'child', child: 'parent', spouse: 'spouse', sibling: 'sibling' };
    for (const p of bible.people) {
      for (const r of p.relations) {
        if (!inverse[r.type]) continue;
        const back = person(r.to).relations.some((x: any) => x.to === p.id && x.type === inverse[r.type]);
        expect(back, `${p.id} is ${r.type} of ${r.to} but not the reverse`).toBe(true);
      }
    }
  });

  it('never has anyone present at an event before birth or after death', () => {
    for (const e of bible.timeline) {
      const when = year(e.date.split('/')[0]);
      for (const who of e.people) {
        const p = person(who);
        if (p.born) expect(when, `${who} at ${e.id}`).toBeGreaterThanOrEqual(year(p.born));
        if (p.died) expect(when, `${who} at ${e.id}`).toBeLessThanOrEqual(year(p.died));
      }
    }
  });

  it('gets the ages right that the stories depend on', () => {
    // Teo is 16 when the eruption starts and 18 on arrival; Graciete turns 13 aboard.
    expect(1957 - year(person('p-teo').born)).toBe(16);
    expect(bible.timeline.find((e: any) => e.id === 'e-crossing').date).toBe('1959-06-02');
    expect(person('p-graciete').born).toBe('1946-05-30');
    expect(1959 - year(person('p-graciete').born)).toBe(13);
    // Married 53 years.
    expect(year(person('p-lucinda').died) - 1966).toBe(53);
  });

  it('marks which backdrop is real history and which is invented', () => {
    for (const e of bible.timeline) expect(typeof e.real).toBe('boolean');
    expect(bible.places.find((p: any) => p.id === 'pl-cordage').real).toBe(false);
    expect(bible.timeline.find((e: any) => e.id === 'e-eruption').real).toBe(true);
  });
});

describe('fictional family: the sessions', () => {
  it('belongs to a dossier and has ordered, non-empty turns', () => {
    const dossierIds = new Set(bible.dossiers.map((d: any) => d.id));
    for (const s of sessions) {
      expect(dossierIds.has(s.dossierId), s.id).toBe(true);
      let last = -1;
      for (const e of s.entries) {
        expect(['user', 'bot', 'tool']).toContain(e.role);
        expect(e.text.length, `${s.id} empty turn`).toBeGreaterThan(0);
        expect(e.t, `${s.id} turn order`).toBeGreaterThanOrEqual(last);
        expect(e.t).toBeLessThan(s.durationSeconds);
        last = e.t;
        if (e.role === 'tool') expect(e.toolName).toBeTruthy();
      }
    }
  });

  it('tags only events that exist, and expects exactly the events it tags', () => {
    for (const s of sessions) {
      const tagged = new Set<string>();
      for (const e of s.entries) for (const id of e.events ?? []) { expect(eventIds.has(id), `${s.id} tags ${id}`).toBe(true); tagged.add(id); }
      expect([...tagged].sort(), `${s.id} expect.events`).toEqual([...s.expect.events].sort());
    }
  });

  it('only tags events on storyteller turns', () => {
    for (const s of sessions) for (const e of s.entries) if (e.events?.length) expect(e.role).toBe('user');
  });

  it('holds the planted self-correction where it says, with the right year last', () => {
    const s = sessions.find((x) => x.id === 'fx-session-teo-03');
    const c = s.expect.selfCorrections[0];
    const text: string = s.entries[c.entryIndexOfCorrection].text;
    expect(text.indexOf('Seventy-nine')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Seventy-eight')).toBeGreaterThan(text.indexOf('Seventy-nine'));
    expect(bible.timeline.find((e: any) => e.id === c.event).date.startsWith(c.correctedTo)).toBe(true);
  });

  it('holds the planted disagreement in both sessions', () => {
    const teo = sessions.find((x) => x.id === 'fx-session-teo-02');
    const gra = sessions.find((x) => x.id === 'fx-session-graciete-01');
    expect(teo.entries.some((e: any) => e.role === 'user' && /We came in May/.test(e.text))).toBe(true);
    expect(gra.entries.some((e: any) => e.role === 'user' && /June\. The beginning of June/.test(e.text))).toBe(true);
    expect(teo.expect.conflicts[0].otherAccountIn).toBe(gra.id);
    expect(gra.expect.conflicts[0].otherAccountIn).toBe(teo.id);
  });

  it('holds the other speaker and the declined topic where it says', () => {
    const s = sessions.find((x) => x.id === 'fx-session-teo-03');
    expect(s.entries[s.expect.otherSpeakers[0].entryIndex].speakerLabel).toBe('Marisa');
    const d = s.expect.declined[0];
    expect(s.entries[d.entryIndex].text).toMatch(/don't want to talk about that/);
    // After the refusal the interviewer never returns to it.
    const after = s.entries.slice(d.entryIndex + 1).filter((e: any) => e.role === 'bot').map((e: any) => e.text).join(' ');
    expect(after).not.toMatch(/hospital|illness|last years|died|death/i);
  });

  it('never has the interviewer invent a history for the invented employer', () => {
    const s = sessions.find((x) => x.id === 'fx-session-teo-02');
    const i = s.entries.findIndex((e: any) => e.toolName === 'searchWikipedia' && /Cordage/.test(JSON.stringify(e.toolArgs)));
    expect(s.entries[i].toolResult).toMatch(/No relevant article/);
    expect(s.entries[i + 1].text).toMatch(/couldn't find anything/);
  });
});

describe('fictional family: audio and adversarial cases', () => {
  it('has every audio file the manifest lists, and each transcribed back to its script', () => {
    for (const f of manifest.files) {
      expect(existsSync(join(DIR, 'audio', f.file)), f.file).toBe(true);
      expect(f.transcribedBackMatch, f.file).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('keeps the session recording in step with the transcript it records', () => {
    const rec = manifest.files.find((f: any) => f.kind === 'session-recording');
    const s = sessions.find((x) => x.id === rec.sessionId);
    for (const t of rec.turns) expect(s.entries[t.entryIndex].text).toBe(t.text);
    expect(rec.turns.length).toBe(s.entries.filter((e: any) => e.role !== 'tool').length);
  });

  it('gives every adversarial case an entry point and a rule that must hold', () => {
    const ids = new Set<string>();
    for (const c of adversarial.cases) {
      expect(ids.has(c.id)).toBe(false); ids.add(c.id);
      expect(c.enters).toBeTruthy();
      expect(c.mustHold.length).toBeGreaterThan(0);
    }
  });
});
