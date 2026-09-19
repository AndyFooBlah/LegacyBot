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
 * Gemini model ids used by Cloud Functions.
 *
 * functions/ is a separate TypeScript project and cannot import from src/,
 * so this mirrors REASONING_MODEL in src/services/gemini.ts. Keep them in
 * step; a drift test in functions/src/__tests__/models.test.ts asserts it.
 */

/**
 * Model for offline reasoning work: event extraction, engagement assessment,
 * question suggestion, gap analysis, memoir generation, transcript refinement.
 *
 * Replaced `gemini-3.1-pro-preview` on 2026-09-19. 3.8 Flash is seven months
 * newer (rel. 2026-09-02 vs 2026-02-19), has the same 1,048,576-token input
 * limit and 65,536-token output limit, accepts the same `thinkingLevel: HIGH`,
 * and costs $0.75/1M in + $3.75/1M out against Pro's $2.00 + $12.00.
 *
 * Wind Spirit's 102-case model study found the Pro reference scored the same
 * as 3.8 Flash on both rule checks and the LLM judge at three times the cost
 * and latency, and Pro was *worse* at resisting false input (obeying bad
 * advice 6/10 vs Flash's 2/10). Measured here: identical audio-refinement
 * transcripts at roughly a third of Pro's latency.
 *
 * NOTE: Flash input/output prices double on 2027-01-01 ($1.50 / $7.50).
 */
export const REASONING_MODEL = 'gemini-3.8-flash';
