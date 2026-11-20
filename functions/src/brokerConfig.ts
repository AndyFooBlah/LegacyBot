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
 * What a client may ask the model broker (invokeGemini) to forward. Kept in
 * its own file with no imports so that tests, including the live suite in the
 * app project, can apply exactly the filtering production applies.
 */

/**
 * The only `config` keys a client may set. Everything else is dropped,
 * silently, before the SDK sees it. Add a key here only after checking it
 * cannot change where the request goes, what credentials it carries, or what
 * the server fetches on the caller's behalf.
 */
export const ALLOWED_CONFIG_KEYS = [
  'thinkingConfig',
  'temperature',
  'topP',
  'topK',
  'seed',
  'candidateCount',
  'maxOutputTokens',
  'stopSequences',
  'responseMimeType',
  'responseSchema',
  'responseJsonSchema',
  'systemInstruction',
] as const;

const MAX_FUNCTION_DECLARATIONS = 32;
const FUNCTION_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

/**
 * A client may describe functions it will run ITSELF; the model then replies
 * with a function call for the client to execute. That costs nothing extra and
 * reaches nothing. What a client may not do is switch on a tool the SERVER or
 * the provider executes (web search, URL fetching, code execution), so this
 * does not filter the caller's array, it builds a new one containing only
 * `functionDeclarations`, each reduced to name, description and parameters.
 */
export function sanitizeFunctionTools(tools: unknown): { functionDeclarations: Record<string, unknown>[] }[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const declarations: Record<string, unknown>[] = [];
  for (const tool of tools) {
    const list = (tool as { functionDeclarations?: unknown } | null)?.functionDeclarations;
    if (!Array.isArray(list)) continue;
    for (const d of list) {
      if (declarations.length >= MAX_FUNCTION_DECLARATIONS) break;
      const decl = d as { name?: unknown; description?: unknown; parameters?: unknown } | null;
      if (typeof decl?.name !== 'string' || !FUNCTION_NAME.test(decl.name)) continue;
      declarations.push({
        name: decl.name,
        description: typeof decl.description === 'string' ? decl.description.slice(0, 4000) : '',
        ...(decl.parameters && typeof decl.parameters === 'object' && !Array.isArray(decl.parameters)
          ? { parameters: decl.parameters }
          : {}),
      });
    }
  }
  return declarations.length > 0 ? [{ functionDeclarations: declarations }] : undefined;
}
