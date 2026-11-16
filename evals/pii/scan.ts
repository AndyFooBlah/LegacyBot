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
 * Scans files for personal identifiers from the private denylist built by
 * build-denylist.ts. Exits non-zero on any hit.
 *
 *   npx tsx evals/pii/scan.ts                    # every tracked file, names + emails
 *   npx tsx evals/pii/scan.ts --tier2 evals/family   # fixtures: also proper nouns
 *   npx tsx evals/pii/scan.ts --reveal ...       # print the matched word (owner's terminal only)
 *
 * Output masks the matched word by default (first letter + length), because
 * the word is by construction something from a real family's data. The file
 * and line are enough to go and look.
 *
 * Without the denylist file this cannot run, and says so with exit code 2
 * rather than passing: a guard that silently passes when its input is missing
 * is worse than no guard.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DENYLIST = process.env.PII_DENYLIST ?? join(homedir(), '.config', 'biographybot', 'pii-denylist.json');

/**
 * Generic proper nouns allowed in fixtures even if a real transcript also
 * happens to contain them. This list is deliberately broad and was written
 * without reference to the real corpus, so nothing can be inferred from it.
 * Do NOT add a word here just because it collided; if it is specific (a town,
 * a school, an employer, a surname), change the fixture instead.
 */
const GENERIC = new Set(`
january february march april may june july august september october november december
monday tuesday wednesday thursday friday saturday sunday
christmas easter thanksgiving halloween lent advent epiphany pentecost
god lord jesus christ bible catholic protestant christian jewish muslim
english spanish french german italian portuguese latin greek irish
american british canadian european african asian
america united states usa canada mexico england britain europe africa asia
atlantic pacific
world war depression
google gemini firebase firestore wikipedia internet facebook youtube github claude chrome cloud storage api json
mom dad mama papa grandma grandpa grandmother grandfather
mrs miss sir father mother sister brother saint
`.split(/\s+/).filter(Boolean));

const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|webm|wav|mp3|ogg|opus|m4a|pdf|zip|gz|lock)$/i;
const SKIP_PATH = /(^|\/)(node_modules|dist|\.git)\/|package-lock\.json$/;

const args = process.argv.slice(2);
const reveal = args.includes('--reveal');
const useTier2 = args.includes('--tier2');
const paths = args.filter((a) => !a.startsWith('--'));

if (!existsSync(DENYLIST)) {
  console.error(`PII denylist not found at ${DENYLIST}.`);
  console.error('Build it first: GOOGLE_CLOUD_QUOTA_PROJECT=legacybot-4814e npx tsx evals/pii/build-denylist.ts');
  process.exit(2);
}
const deny = JSON.parse(readFileSync(DENYLIST, 'utf8')) as { tier1: string[]; emails: string[]; tier2: string[]; builtAt: string };

const dict = new Set<string>();
if (existsSync('/usr/share/dict/words')) {
  for (const w of readFileSync('/usr/share/dict/words', 'utf8').split('\n')) if (w && w === w.toLowerCase()) dict.add(w);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mask = (w: string) => (reveal ? w : `${w[0]}${'•'.repeat(Math.max(1, w.length - 1))}(${w.length})`);

interface Rule { re: RegExp; tier: string; word: string }
const rules: Rule[] = [];
for (const e of deny.emails) rules.push({ re: new RegExp(esc(e), 'i'), tier: 'email', word: e });
for (const t of deny.tier1) {
  // A name that is also an ordinary word only counts when it is capitalised
  // in the middle of a sentence: a sentence-initial capital is just grammar.
  const isWord = !t.includes(' ') && dict.has(t);
  const flags = isWord ? 'u' : 'iu';
  const pattern = isWord
    ? `(?<=[\\p{L},;:]\\s)${esc(t[0].toUpperCase() + t.slice(1))}`
    : t.split(' ').map(esc).join('\\s+');
  rules.push({ re: new RegExp(`(?<![\\p{L}])${pattern}(?![\\p{L}])`, flags), tier: 'name', word: t });
}
if (useTier2) {
  for (const t of deny.tier2) {
    if (GENERIC.has(t)) continue;
    const cap = esc(t[0].toUpperCase() + t.slice(1));
    rules.push({ re: new RegExp(`(?<![\\p{L}])${cap}(?![\\p{L}])`, 'u'), tier: 'proper-noun', word: t });
  }
}

function listFiles(): string[] {
  const roots = paths.length ? paths : ['.'];
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...roots], { encoding: 'utf8' });
  return out.split('\n').filter((f) => f && !SKIP_EXT.test(f) && !SKIP_PATH.test(f) && existsSync(f) && statSync(f).isFile());
}

let hits = 0;
const files = listFiles();
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (text.includes('\u0000')) continue; // binary
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const r of rules) {
      if (r.re.test(line)) {
        hits++;
        console.log(`${file}:${i + 1}  [${r.tier}] ${mask(r.word)}`);
      }
    }
  });
}

console.log(`\nscanned ${files.length} files against ${rules.length} rules (denylist built ${deny.builtAt.slice(0, 10)})`);
console.log(hits === 0 ? 'PASS — no real-family identifiers found' : `FAIL — ${hits} hit(s)`);
process.exit(hits === 0 ? 0 : 1);
