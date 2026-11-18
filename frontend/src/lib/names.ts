export type NameKind = "role" | "team" | "category" | "person";

const RULES = {
    role: { label: "role name", min: 3, max: 60, chars: /^[\p{L}\p{N} &\-_/.,|()']+$/u, allowed: "letters, numbers, spaces and & - _ / . , | ( )" },
    team: { label: "team name", min: 3, max: 60, chars: /^[\p{L}\p{N} &\-_/.,|()']+$/u, allowed: "letters, numbers, spaces and & - _ / . , | ( )" },
    category: { label: "category name", min: 3, max: 60, chars: /^[\p{L}\p{N} &\-_/.,|()']+$/u, allowed: "letters, numbers, spaces and & - _ / . , | ( )" },
    person: { label: "name", min: 2, max: 80, chars: /^[\p{L} .'\-]+$/u, allowed: "letters, spaces and . ' -" },
} as const;

const PLACEHOLDERS = new Set(["new", "test", "tests", "testing", "tmp", "temp", "untitled", "none", "null", "undefined", "asdf", "qwerty", "xxx", "abc", "name", "team", "role", "category", "sample", "dummy"]);

/** Same rules as the server (backend/src/utils/names.ts), so a form can say what is wrong while the person types. Empty text gives no message. */
export function nameProblem(kind: NameKind, raw: string): string | null {
    if (!raw.trim()) return null;
    const r = RULES[kind];
    const name = raw.replace(/\s+/g, " ").trim();
    if (name.length < r.min) return `Needs at least ${r.min} characters.`;
    if (name.length > r.max) return `At most ${r.max} characters.`;
    if (!/^\p{L}/u.test(name)) return "Must start with a letter.";
    if (!r.chars.test(name)) return `Use ${r.allowed} only.`;
    if (/(.)\1{3,}/u.test(name)) return "The same character is repeated too many times.";
    if (kind !== "person" && PLACEHOLDERS.has(name.toLowerCase())) return `"${name}" is too vague. Say what it is for, for example "IT Support".`;
    if (kind !== "person" && !/\p{L}{2,}/u.test(name)) return "Needs a real word in it.";
    return null;
}

export const NAME_HINT: Record<NameKind, string> = {
    role: "3 to 60 characters, starting with a letter. Say what the role is, e.g. Support Agent.",
    team: "3 to 60 characters, starting with a letter. Say what it handles, e.g. IT Support.",
    category: "3 to 60 characters, starting with a letter, e.g. VPN access.",
    person: "Their full name, letters only.",
};
