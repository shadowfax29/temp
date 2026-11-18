import { AppError } from './AppError';

export type NameKind = 'role' | 'team' | 'category' | 'person';

const RULES: Record<NameKind, { label: string; min: number; max: number; chars: RegExp; allowed: string }> = {
  role: { label: 'role name', min: 3, max: 60, chars: /^[\p{L}\p{N} &\-_/.,|()']+$/u, allowed: 'letters, numbers, spaces and & - _ / . , | ( )' },
  team: { label: 'team name', min: 3, max: 60, chars: /^[\p{L}\p{N} &\-_/.,|()']+$/u, allowed: 'letters, numbers, spaces and & - _ / . , | ( )' },
  category: { label: 'category name', min: 3, max: 60, chars: /^[\p{L}\p{N} &\-_/.,|()']+$/u, allowed: 'letters, numbers, spaces and & - _ / . , | ( )' },
  person: { label: 'name', min: 2, max: 80, chars: /^[\p{L} .'\-]+$/u, allowed: 'letters, spaces and . \' -' },
};

/** Words nobody means as a real name */
const PLACEHOLDERS = new Set(['new', 'test', 'tests', 'testing', 'tmp', 'temp', 'untitled', 'none', 'null', 'undefined', 'asdf', 'qwerty', 'xxx', 'abc', 'name', 'team', 'role', 'category', 'sample', 'dummy']);

/** The problem with a name, or null when it is fine. The same rules run in the forms (frontend/src/lib/names.ts). */
export function nameProblem(kind: NameKind, raw: string): string | null {
  const r = RULES[kind];
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < r.min) return `The ${r.label} needs at least ${r.min} characters.`;
  if (name.length > r.max) return `The ${r.label} can be at most ${r.max} characters.`;
  if (!/^\p{L}/u.test(name)) return `The ${r.label} must start with a letter.`;
  if (!r.chars.test(name)) return `The ${r.label} can use ${r.allowed} only.`;
  if (/(.)\1{3,}/u.test(name)) return `The ${r.label} has the same character repeated too many times.`;
  if (kind !== 'person' && PLACEHOLDERS.has(name.toLowerCase())) return `"${name}" is too vague to be a ${r.label}. Say what it is for, for example "IT Support".`;
  if (kind !== 'person' && !/\p{L}{2,}/u.test(name)) return `The ${r.label} needs a real word in it.`;
  return null;
}

/** Cleaned name (spaces tidied) or a clear error */
export function cleanName(kind: NameKind, raw: string): string {
  const problem = nameProblem(kind, raw);
  if (problem) throw AppError.badRequest(problem);
  return raw.replace(/\s+/g, ' ').trim();
}
