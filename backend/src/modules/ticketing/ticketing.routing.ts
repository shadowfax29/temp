/**
 * Ticketing routing: which team gets a ticket, and which person in that team.
 *   team   = the category's routing rules (top to bottom, first match) -> the sub-category's default team -> the category's default team -> Triage
 *   person = the team's assignment method: round-robin, least open tickets, skill match (then least open), manual (the lead assigns), self-pick
 * Everything here only reads; the callers write the result (and log it) in their own transaction.
 */
import type mysql from 'mysql2/promise';
import { pool } from '../../config/db';

type Row = mysql.RowDataPacket;
type Db = mysql.PoolConnection | typeof pool;

export const ASSIGNMENT_METHODS = ['MANUAL', 'ROUND_ROBIN', 'LEAST_OPEN', 'SKILL', 'SELF_PICK'] as const;
export type AssignmentMethod = (typeof ASSIGNMENT_METHODS)[number];
export const METHOD_LABEL: Record<AssignmentMethod, string> = {
  MANUAL: 'Manual (the team lead assigns)', ROUND_ROBIN: 'Round-robin', LEAST_OPEN: 'Least open tickets', SKILL: 'Skill match, then least open', SELF_PICK: 'Self-pick (members take it)',
};

export type CondType = 'subcategory' | 'field' | 'department' | 'priority';
export interface Cond { type: CondType; key?: string; op: 'is' | 'is_not'; value: string }
/** What a rule can look at */
export interface Facts { subcategoryId: number; fields: Record<string, unknown>; departmentIds: number[]; priority: string }

const hit = (c: Cond, f: Facts): boolean => {
  let h: boolean;
  switch (c.type) {
    case 'subcategory': h = String(f.subcategoryId) === String(c.value); break;
    case 'field': h = String(f.fields[c.key ?? ''] ?? '').trim().toLowerCase() === String(c.value).trim().toLowerCase(); break;
    case 'department': h = f.departmentIds.map(String).includes(String(c.value)); break;
    case 'priority': h = f.priority === c.value; break;
    default: h = false;
  }
  return c.op === 'is_not' ? !h : h;
};

export function parseConditions(raw: unknown): Cond[] {
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(list) ? (list as Cond[]) : [];
  } catch { return []; }
}

export interface TraceStep { rule: string; ruleId: number | null; matched: boolean; note?: string }
export interface RouteResult { teamId: number | null; teamName: string | null; via: string; ruleId: number | null; trace: TraceStep[] }

/** Teams that may take tickets of this category: active and linked to it */
async function serves(db: Db, categoryId: number, teamId: number | null | undefined): Promise<Row | null> {
  if (teamId == null) return null;
  const [r] = await db.query<Row[]>(
    `SELECT t.id, t.name FROM tkt_team t JOIN tkt_category_team ct ON ct.team_id = t.id AND ct.category_id = ? WHERE t.id = ? AND t.active = 1`, [categoryId, teamId]);
  return r[0] ?? null;
}

export async function resolveTeam(db: Db, categoryId: number, f: Facts): Promise<RouteResult> {
  const trace: TraceStep[] = [];
  const [rules] = await db.query<Row[]>('SELECT * FROM tkt_route_rule WHERE category_id = ? AND active = 1 ORDER BY position, id', [categoryId]);
  for (const r of rules) {
    const conds = parseConditions(r['conditions']);
    const matched = conds.length > 0 && conds.every((c) => hit(c, f));
    if (!matched) { trace.push({ rule: r['name'], ruleId: r['id'], matched: false }); continue; }
    const team = await serves(db, categoryId, r['team_id']);
    if (!team) { trace.push({ rule: r['name'], ruleId: r['id'], matched: true, note: 'its team is inactive or does not serve this category, skipped' }); continue; }
    trace.push({ rule: r['name'], ruleId: r['id'], matched: true });
    return { teamId: team['id'], teamName: team['name'], via: `Rule "${r['name']}"`, ruleId: r['id'], trace };
  }
  const [sub] = await db.query<Row[]>('SELECT default_team_id FROM tkt_subcategory WHERE id = ?', [f.subcategoryId]);
  const subTeam = await serves(db, categoryId, sub[0]?.['default_team_id']);
  if (subTeam) return { teamId: subTeam['id'], teamName: subTeam['name'], via: 'No rule matched: the sub-category\'s default team', ruleId: null, trace };
  const [cat] = await db.query<Row[]>('SELECT default_team_id FROM tkt_category WHERE id = ?', [categoryId]);
  const catTeam = await serves(db, categoryId, cat[0]?.['default_team_id']);
  if (catTeam) return { teamId: catTeam['id'], teamName: catTeam['name'], via: 'No rule matched: the category\'s default team', ruleId: null, trace };
  return { teamId: null, teamName: null, via: 'No rule matched and no default team: Triage for the category owner', ruleId: null, trace };
}

export interface Candidate { userId: number; name: string; open: number; limit: number; away: boolean; skills: string[]; privilege: string }
export interface PickResult { userId: number | null; method: AssignmentMethod; why: string; skipped: { name: string; reason: string }[]; candidates: Candidate[] }

/** Members with how many tickets they hold right now (across every team) */
export async function candidates(db: Db, teamId: number): Promise<{ list: Candidate[]; method: AssignmentMethod; last: number | null }> {
  const [t] = await db.query<Row[]>('SELECT assignment_method, max_open, last_assigned_user_id FROM tkt_team WHERE id = ?', [teamId]);
  const [rows] = await db.query<Row[]>(
    `SELECT m.user_id, m.privilege, m.away, m.skills, u.UserName,
       (SELECT COUNT(*) FROM tkt_ticket x WHERE x.assignee_id = m.user_id AND x.status NOT IN ('RESOLVED','CLOSED','SPAM')) AS open_n
     FROM tkt_team_member m JOIN Users u ON u.UserID = m.user_id WHERE m.team_id = ? AND m.active = 1 AND u.UserStatus = 1 ORDER BY m.user_id`, [teamId]);
  const limit = (t[0]?.['max_open'] as number | undefined) ?? 8;
  return {
    method: ((t[0]?.['assignment_method'] as string | undefined) ?? 'MANUAL') as AssignmentMethod,
    last: (t[0]?.['last_assigned_user_id'] as number | null | undefined) ?? null,
    list: rows.map((r) => ({
      userId: r['user_id'], name: r['UserName'], open: Number(r['open_n']), limit, away: !!r['away'], privilege: r['privilege'],
      skills: r['skills'] ? (JSON.parse(r['skills']) as string[]).map((s) => s.toLowerCase()) : [],
    })),
  };
}

/** Picks the person the team's method would give the ticket to now. Members at their limit or inactive are skipped. */
export async function pickAssignee(db: Db, teamId: number, skill: string | null): Promise<PickResult> {
  const { list, method, last } = await candidates(db, teamId);
  const skipped: { name: string; reason: string }[] = [];
  const free = list.filter((c) => {
    if (c.open >= c.limit) { skipped.push({ name: c.name, reason: `at the limit (${c.open}/${c.limit})` }); return false; }
    return true;
  });
  const done = (userId: number | null, why: string): PickResult => ({ userId, method, why, skipped, candidates: list });
  if (method === 'MANUAL') return done(null, 'Manual assignment: waits in the team list for the team lead');
  if (method === 'SELF_PICK') return done(null, 'Self-pick: waits in the team list for a member to take it');
  if (!free.length) return done(null, `Nobody available${skipped.length ? ` (${skipped.map((s) => `${s.name}: ${s.reason}`).join(', ')})` : ' (the team has no active members)'}: waits in the team list`);

  const least = (pool: Candidate[]) => [...pool].sort((a, b) => a.open - b.open || a.userId - b.userId)[0]!;
  if (method === 'LEAST_OPEN') { const p = least(free); return done(p.userId, `Least open tickets: ${p.name} has ${p.open}`); }
  if (method === 'SKILL') {
    const want = skill?.trim().toLowerCase();
    const matched = want ? free.filter((c) => c.skills.includes(want)) : [];
    if (matched.length) { const p = least(matched); return done(p.userId, `Skill "${skill}" matched; ${p.name} has the fewest open (${p.open})`); }
    const p = least(free);
    return done(p.userId, want ? `Nobody available has the skill "${skill}": least open instead, ${p.name} (${p.open})` : `The sub-category needs no skill: least open, ${p.name} (${p.open})`);
  }
  // round-robin: the next available member after the one who got the last ticket
  const ids = list.map((c) => c.userId);
  const from = last != null ? ids.indexOf(last) : -1;
  for (let k = 1; k <= list.length; k++) {
    const c = list[(from + k + list.length) % list.length]!;
    if (free.includes(c)) return done(c.userId, last != null && from >= 0 ? `Round-robin: next available after ${list[from]!.name}` : 'Round-robin: first available member');
  }
  return done(null, 'Nobody available');
}
