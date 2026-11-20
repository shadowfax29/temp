/**
 * Ticketing, phase 1: raise, route to the category's team, assign, reply, change status, and an audit trail.
 * Design: docs/ticketing-phase1.md. Every change to a ticket goes through the functions in this file; each one runs in ONE
 * transaction that writes the ticket change, an event (hash-chained, insert-only) and the ownership period roll.
 */
import crypto from 'crypto';
import type mysql from 'mysql2/promise';
import { pool } from '../../config/db';
import { AppError } from '../../utils/AppError';
import { can } from '../access/access.service';
import { pickAssignee, resolveTeam } from './ticketing.routing';
import { freshenDepartmentTeams, raisableTeams, syncDepartmentTeam } from './ticketing.teams';
import { timerOf } from './ticketing.timer';
import { kindOf, pathOf, readLink, signLink, type SavedFile } from './ticketing.files';

type Row = mysql.RowDataPacket;
type Conn = mysql.PoolConnection;

export const STATUSES = ['OPEN', 'PENDING', 'ANSWERED', 'RESOLVED', 'CLOSED', 'SPAM'] as const;
export type Status = (typeof STATUSES)[number];
export const PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIVILEGES = ['ASSOCIATE', 'LEAD', 'ADMIN'] as const;
export type Privilege = (typeof PRIVILEGES)[number];

const RANK: Record<string, number> = { ASSOCIATE: 1, LEAD: 2, ADMIN: 3 };
const DONE: Status[] = ['RESOLVED', 'CLOSED', 'SPAM'];
const REOPEN_DAYS = 7;

/** Who is doing it: the signed-in user, and the real admin when this is a Switch User view */
/** Someone who manages both the teams and the categories sees and may act on every ticket */
async function isTicketAdmin(userId: number): Promise<boolean> {
  return (await Promise.all([can(userId, 'tkt_teams', 'update'), can(userId, 'tkt_categories', 'update')])).every(Boolean);
}

export interface Actor { userId: number; impersonatedBy: number | null; ip: string | null }

// ── Transactions, events and periods ─────────────────────────────────────────────────────────────

async function withTx<T>(fn: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

const j = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

interface EventInput {
  type: string;
  actor: Actor | null;
  kind?: 'USER' | 'SYSTEM' | 'RULE' | 'EMAIL';
  old?: unknown;
  next?: unknown;
  details?: string;
  categoryId?: number | null;
  teamId?: number | null;
  userId?: number | null;
  ruleId?: number | null;
}

interface EventRow {
  ticketId: string; type: string; kind: string; actorUserId: number | null; impersonatedBy: number | null;
  oldValue: string | null; newValue: string | null; details: string | null;
  categoryId: number | null; teamId: number | null; userId: number | null; ruleId: number | null; at: string;
}

const hashOf = (prev: string | null, e: EventRow) =>
  crypto.createHash('sha256').update(JSON.stringify([
    prev, e.ticketId, e.type, e.kind, e.actorUserId, e.impersonatedBy, e.oldValue, e.newValue, e.details, e.categoryId, e.teamId, e.userId, e.ruleId, e.at,
  ])).digest('hex');

/** Appends to the ticket's event log; the caller holds the ticket row lock so the chain cannot fork */
export async function recordEvent(conn: Conn, ticketId: number | string, e: EventInput, now: Date) {
  const [last] = await conn.query<Row[]>('SELECT hash FROM tkt_event WHERE ticket_id = ? ORDER BY id DESC LIMIT 1', [ticketId]);
  const prev = last[0] ? (last[0]['hash'] as string) : null;
  const row: EventRow = {
    ticketId: String(ticketId), type: e.type, kind: e.kind ?? (e.actor ? 'USER' : 'SYSTEM'),
    actorUserId: e.actor?.userId ?? null, impersonatedBy: e.actor?.impersonatedBy ?? null,
    oldValue: j(e.old), newValue: j(e.next), details: e.details ?? null,
    categoryId: e.categoryId ?? null, teamId: e.teamId ?? null, userId: e.userId ?? null, ruleId: e.ruleId ?? null, at: now.toISOString(),
  };
  await conn.query(
    `INSERT INTO tkt_event (ticket_id, event_type, actor_kind, actor_user_id, impersonated_by, old_value, new_value, details,
       category_id, team_id, user_id, rule_id, ip, created_at, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ticketId, row.type, row.kind, row.actorUserId, row.impersonatedBy, row.oldValue, row.newValue, row.details,
      row.categoryId, row.teamId, row.userId, row.ruleId, e.actor?.ip ?? null, now, prev, hashOf(prev, row)],
  );
}

/** Closes the open period and starts the next one with the ticket's new team / assignee / status (none after Closed or Spam) */
export async function rollPeriod(conn: Conn, t: { id: number | string; teamId: number | null; assigneeId: number | null; status: Status }, now: Date, because: string) {
  await conn.query('UPDATE tkt_period SET ended_at = ?, ended_because = ? WHERE ticket_id = ? AND ended_at IS NULL', [now, because, t.id]);
  if (t.status === 'CLOSED' || t.status === 'SPAM') return;
  await conn.query('INSERT INTO tkt_period (ticket_id, team_id, assignee_id, status, started_at) VALUES (?,?,?,?,?)',
    [t.id, t.teamId, t.assigneeId, t.status, now]);
}

/** Recomputes the chain of one ticket; false at the first event that does not match what was written */
export async function verifyChain(ticketId: number | string): Promise<{ ok: boolean; events: number; brokenAt: number | null }> {
  const [rows] = await pool.query<Row[]>('SELECT * FROM tkt_event WHERE ticket_id = ? ORDER BY id ASC', [ticketId]);
  let prev: string | null = null;
  for (const r of rows) {
    const e: EventRow = {
      ticketId: String(r['ticket_id']), type: r['event_type'], kind: r['actor_kind'], actorUserId: r['actor_user_id'], impersonatedBy: r['impersonated_by'],
      oldValue: r['old_value'], newValue: r['new_value'], details: r['details'], categoryId: r['category_id'], teamId: r['team_id'], userId: r['user_id'], ruleId: r['rule_id'],
      at: new Date(r['created_at']).toISOString(),
    };
    if ((r['prev_hash'] ?? null) !== prev || r['hash'] !== hashOf(prev, e)) return { ok: false, events: rows.length, brokenAt: Number(r['id']) };
    prev = r['hash'] as string;
  }
  return { ok: true, events: rows.length, brokenAt: null };
}

// ── Who may do what ──────────────────────────────────────────────────────────────────────────────

export interface Access {
  userId: number;
  isRequester: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  isMember: boolean;
  isWatcher: boolean;
  /** 0 = no agent rights on this ticket; 1 Basic, 2 Senior, 3 Lead (team lead, category owner), 4 Supervisor (admin) */
  rank: number;
  isAgent: boolean;
  /** an agent who may work the ticket: the assignee, or Senior and above */
  works: boolean;
}

async function accessFor(db: Conn | typeof pool, userId: number, t: Row): Promise<Access> {
  const [cat] = await db.query<Row[]>('SELECT owner_user_id FROM tkt_category WHERE id = ?', [t['category_id']]);
  const isOwner = cat[0]?.['owner_user_id'] === userId;
  let rank = 0;
  let isMember = false;
  if (t['team_id'] != null) {
    const [m] = await db.query<Row[]>('SELECT privilege FROM tkt_team_member WHERE team_id = ? AND user_id = ? AND active = 1', [t['team_id'], userId]);
    if (m[0]) { isMember = true; rank = RANK[m[0]['privilege'] as string] ?? 1; }
    const [tm] = await db.query<Row[]>('SELECT lead_user_id FROM tkt_team WHERE id = ?', [t['team_id']]);
    if (tm[0]?.['lead_user_id'] === userId) { isMember = true; rank = Math.max(rank, RANK['LEAD']!); }
  }
  if (isOwner) rank = Math.max(rank, RANK['LEAD']!);
  const isAdmin = await isTicketAdmin(userId);
  if (isAdmin) rank = RANK['ADMIN']!;
  const isRequester = t['requester_id'] === userId;
  const [w] = await db.query<Row[]>('SELECT 1 FROM tkt_watcher WHERE ticket_id = ? AND user_id = ?', [t['id'], userId]);
  return { userId, isRequester, isAdmin, isOwner, isMember, isWatcher: !!w[0], rank, isAgent: rank > 0, works: rank > 0 && (t['assignee_id'] === userId || rank >= RANK['LEAD']!) };
}

interface Transition { to: Status; needs?: 'comment' | 'resolution' }

/** The status changes this person may make now (UVdesk-style: an agent can set any open status; Closed is for team leads; an admin can bring back Closed and Spam) */
function transitionsFor(t: Row, a: Access): Transition[] {
  const s = t['status'] as Status;
  const out: Transition[] = [];
  const live = s !== 'CLOSED' && s !== 'SPAM';
  if (a.works && live) {
    for (const to of ['OPEN', 'PENDING', 'ANSWERED'] as Status[]) if (to !== s) out.push({ to });
    if (s !== 'RESOLVED') out.push({ to: 'RESOLVED', needs: 'resolution' });
    out.push({ to: 'SPAM' });
  }
  if (a.rank >= RANK['LEAD']! && live) out.push({ to: 'CLOSED' });
  if (a.isAdmin && !live) out.push({ to: 'OPEN' });
  return out;
}

const reopenable = (t: Row) =>
  t['status'] === 'RESOLVED' && t['resolved_at'] != null && Date.now() - new Date(t['resolved_at']).getTime() <= REOPEN_DAYS * 86_400_000;

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────

const KEY_RE = /^[A-Za-z0-9]{2,8}-\d+$/;

async function loadByKey(db: Conn | typeof pool, key: string, lock = false): Promise<Row> {
  if (!KEY_RE.test(key)) throw AppError.notFound(`Ticket not found: ${key}`);
  const [rows] = await db.query<Row[]>(`SELECT * FROM tkt_ticket WHERE ticket_key = ?${lock ? ' FOR UPDATE' : ''}`, [key.toUpperCase()]);
  if (!rows[0]) throw AppError.notFound(`Ticket not found: ${key}`);
  return rows[0];
}

/** The signed-in person's ticketing standing: used by the menu and the screens */
export async function me(userId: number) {
  await freshenDepartmentTeams();
  const [u] = await pool.query<Row[]>('SELECT UserName, UserEmail FROM Users WHERE UserID = ?', [userId]);
  const [teams] = await pool.query<Row[]>(
    `SELECT t.id, t.name, m.privilege, m.away, (t.lead_user_id = ?) AS isLead FROM tkt_team_member m JOIN tkt_team t ON t.id = m.team_id
     WHERE m.user_id = ? AND m.active = 1 AND t.active = 1 ORDER BY t.name`, [userId, userId]);
  const [owned] = await pool.query<Row[]>('SELECT id, name, prefix FROM tkt_category WHERE owner_user_id = ? AND active = 1 ORDER BY name', [userId]);
  const isAdmin = await isTicketAdmin(userId);
  return {
    userId, name: u[0]?.['UserName'] ?? '', email: u[0]?.['UserEmail'] ?? '', isAdmin,
    teams: teams.map((t) => ({ id: t['id'], name: t['name'], privilege: t['privilege'], isLead: !!t['isLead'] })),
    away: teams.some((t) => !!t['away']),
    ownedCategories: owned.map((c) => ({ id: c['id'], name: c['name'], prefix: c['prefix'] })),
    isAgent: isAdmin || teams.length > 0 || owned.length > 0,
  };
}

/** What the New Ticket form needs: the open categories with their sub-categories and fields */
export async function catalog(userId: number) {
  await freshenDepartmentTeams();
  const mine = await raisableTeams(pool, userId);
  // ticket types of every open group (people never see groups), and the department teams with the people in them
  const [subs] = await pool.query<Row[]>(
    'SELECT s.id, s.category_id, s.name FROM tkt_subcategory s JOIN tkt_category c ON c.id = s.category_id WHERE s.active = 1 AND c.active = 1 ORDER BY s.sort_order, s.name');
  const [fields] = await pool.query<Row[]>('SELECT * FROM tkt_field ORDER BY sort_order, id');
  const [teams] = await pool.query<Row[]>(
    `SELECT t.id, t.name FROM tkt_team t WHERE t.active = 1 ORDER BY t.name`);
  const [people] = await pool.query<Row[]>(
    `SELECT m.team_id, m.user_id, u.UserName FROM tkt_team_member m JOIN Users u ON u.UserID = m.user_id
     WHERE m.active = 1 AND u.UserStatus = 1 ORDER BY u.UserName`);
  const offered = teams.filter((t) => mine.all || mine.ids.includes(t['id']));
  return {
    chooseDepartment: mine.choose,
    /** only people who work tickets (Tickets: Edit) can name the person; for everyone else the team decides */
    chooseAssignee: await can(userId, 'tkt_inbox', 'update'),
    types: subs.map((s) => ({ id: s['id'], categoryId: s['category_id'], name: s['name'], fields: fields.filter((f) => f['subcategory_id'] === s['id']).map(fieldOut) })),
    departments: offered.map((t) => ({
      id: t['id'], name: t['name'],
      members: people.filter((p) => p['team_id'] === t['id']).map((p) => ({ userId: p['user_id'], name: p['UserName'] })),
    })),
  };
}

const fieldOut = (f: Row) => ({
  key: f['field_key'], label: f['label'], type: f['field_type'], required: !!f['required'],
  options: f['options'] ? (JSON.parse(f['options']) as string[]) : [],
});

const LIST_SQL = `SELECT t.id, t.ticket_key, t.subject, t.status, t.priority, t.created_at, t.updated_at, t.assignee_id, t.team_id,
    c.name AS category_name, s.name AS sub_name, tm.name AS team_name, ru.UserName AS requester_name, ru.UserEmail AS requester_email, au.UserName AS assignee_name
  FROM tkt_ticket t JOIN tkt_category c ON c.id = t.category_id JOIN tkt_subcategory s ON s.id = t.subcategory_id
  LEFT JOIN tkt_team tm ON tm.id = t.team_id LEFT JOIN Users ru ON ru.UserID = t.requester_id LEFT JOIN Users au ON au.UserID = t.assignee_id`;

const listItem = (r: Row) => ({
  key: r['ticket_key'], subject: r['subject'], status: r['status'], priority: r['priority'], category: r['category_name'], subcategory: r['sub_name'],
  team: r['team_name'] ?? null, requester: r['requester_name'] ?? null, requesterEmail: r['requester_email'] ?? null, assignee: r['assignee_name'] ?? null, assigneeId: r['assignee_id'],
  createdAt: r['created_at'], updatedAt: r['updated_at'],
});

export interface ListQuery { status?: string; q?: string; page?: number; size?: number; teamId?: number; categoryId?: number; priority?: string }

function filters(q: ListQuery, params: unknown[]): string[] {
  const c: string[] = [];
  if (q.status && (STATUSES as readonly string[]).includes(q.status)) { c.push('t.status = ?'); params.push(q.status); }
  if (q.priority && (PRIORITIES as readonly string[]).includes(q.priority)) { c.push('t.priority = ?'); params.push(q.priority); }
  if (q.teamId) { c.push('t.team_id = ?'); params.push(q.teamId); }
  if (q.categoryId) { c.push('t.category_id = ?'); params.push(q.categoryId); }
  if (q.q?.trim()) { c.push('(t.subject LIKE ? OR t.ticket_key LIKE ?)'); params.push(`%${q.q.trim()}%`, `%${q.q.trim()}%`); }
  return c;
}

const page = (q: ListQuery) => { const size = Math.min(Math.max(q.size ?? 25, 1), 100); return { size, offset: (Math.max(q.page ?? 1, 1) - 1) * size }; };

/** Tickets I raised */
export async function listMine(userId: number, q: ListQuery) {
  const params: unknown[] = [userId];
  const where = ['t.requester_id = ?', ...filters(q, params)].join(' AND ');
  const { size, offset } = page(q);
  const [rows] = await pool.query<Row[]>(`${LIST_SQL} WHERE ${where} ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?`, [...params, size, offset]);
  const [cnt] = await pool.query<Row[]>(`SELECT COUNT(*) AS n FROM tkt_ticket t WHERE ${where}`, params);
  return { tickets: rows.map(listItem), total: Number(cnt[0]?.['n'] ?? 0), page: Math.max(q.page ?? 1, 1), size };
}

export type InboxView = 'all' | 'new' | 'unassigned' | 'unanswered' | 'assigned' | 'triage' | 'pending' | 'answered' | 'resolved' | 'closed' | 'spam';

/** The agent's tickets: what is assigned to me, the team queues I belong to, the categories I own (everything for an admin) */
export async function listInbox(userId: number, view: InboxView, q: ListQuery) {
  const who = await me(userId);
  if (!who.isAgent) throw AppError.forbidden('You are not on a ticketing team yet.');
  const teamIds = who.teams.map((t) => t.id);
  const ownedIds = who.ownedCategories.map((c) => c.id);
  const done = `('RESOLVED','CLOSED','SPAM')`;

  const scopeParams: unknown[] = [];
  const scope = who.isAdmin ? '1=1' : `(t.team_id IN (?) OR t.category_id IN (?))`;
  if (!who.isAdmin) scopeParams.push(teamIds.length ? teamIds : [0], ownedIds.length ? ownedIds : [0]);

  const byStatus = (st: Status) => ({ sql: `${scope} AND t.status = '${st}'`, params: scopeParams });
  const viewSql: Record<InboxView, { sql: string; params: unknown[] }> = {
    all: { sql: `${scope} AND t.status <> 'SPAM'`, params: scopeParams },
    new: { sql: `${scope} AND t.status = 'OPEN' AND t.first_response_at IS NULL`, params: scopeParams },
    unassigned: { sql: `${scope} AND t.assignee_id IS NULL AND t.team_id IS NOT NULL AND t.status NOT IN ${done}`, params: scopeParams },
    unanswered: byStatus('OPEN'),
    assigned: { sql: `t.assignee_id = ? AND t.status NOT IN ${done}`, params: [userId] },
    triage: { sql: `${scope} AND t.team_id IS NULL AND t.status NOT IN ${done}`, params: scopeParams },
    pending: byStatus('PENDING'),
    answered: byStatus('ANSWERED'),
    resolved: byStatus('RESOLVED'),
    closed: byStatus('CLOSED'),
    spam: byStatus('SPAM'),
  };

  const counts: Record<string, number> = {};
  for (const [name, v] of Object.entries(viewSql)) {
    const [r] = await pool.query<Row[]>(`SELECT COUNT(*) AS n FROM tkt_ticket t WHERE ${v.sql}`, v.params);
    counts[name] = Number(r[0]?.['n'] ?? 0);
  }

  const chosen = viewSql[view] ?? viewSql.assigned;
  const params = [...chosen.params];
  const where = [chosen.sql, ...filters(q, params)].join(' AND ');
  const { size, offset } = page(q);
  const [rows] = await pool.query<Row[]>(`${LIST_SQL} WHERE ${where} ORDER BY FIELD(t.priority,'URGENT','HIGH','MEDIUM','LOW'), t.created_at ASC LIMIT ? OFFSET ?`, [...params, size, offset]);
  return { tickets: rows.map(listItem), total: counts[view] ?? 0, counts, page: Math.max(q.page ?? 1, 1), size };
}

/** One ticket as this person may see it, with what they can do next. The assignee opening it for the first time is logged. */
export async function getTicket(key: string, userId: number, actor?: Actor) {
  let t = await loadByKey(pool, key);
  let a = await accessFor(pool, userId, t);
  if (!a.isRequester && !a.isAgent && !a.isWatcher) throw AppError.forbidden('You do not have access to this ticket.');

  if (t['assignee_id'] === userId && t['first_opened_at'] == null && actor) {
    await withTx(async (conn) => {
      const locked = await loadByKey(conn, key, true);
      if (locked['first_opened_at'] != null) return;
      const now = new Date();
      await conn.query('UPDATE tkt_ticket SET first_opened_at = ?, updated_at = ? WHERE id = ?', [now, now, locked['id']]);
      const mins = Math.round((now.getTime() - new Date(locked['created_at']).getTime()) / 60_000);
      await recordEvent(conn, locked['id'], { type: 'open', actor, details: `First opened by the assignee (${mins} min after creation)`, userId }, now);
    });
    t = await loadByKey(pool, key);
    a = await accessFor(pool, userId, t);
  }

  const [meta] = await pool.query<Row[]>(
    `SELECT c.name AS category_name, c.prefix, s.name AS sub_name, tm.name AS team_name, tm.lead_user_id, tm.assignment_method, ru.UserName AS requester_name, ru.UserEmail AS requester_email,
       au.UserName AS assignee_name, mg.UserName AS manager_name,
       NULL AS requester_dept
     FROM tkt_ticket t JOIN tkt_category c ON c.id = t.category_id JOIN tkt_subcategory s ON s.id = t.subcategory_id LEFT JOIN tkt_team tm ON tm.id = t.team_id
     LEFT JOIN Users ru ON ru.UserID = t.requester_id LEFT JOIN Users au ON au.UserID = t.assignee_id LEFT JOIN Users mg ON mg.UserID = NULL
     WHERE t.id = ?`, [t['id']]);
  const m = meta[0]!;

  // internal notes are for agents only; a person who is only the requester never sees them
  const seesNotes = a.isAgent;
  const [msgs] = await pool.query<Row[]>(
    `SELECT g.id, g.kind, g.body, g.created_at, g.author_id, u.UserName AS author_name FROM tkt_message g LEFT JOIN Users u ON u.UserID = g.author_id
     WHERE g.ticket_id = ? ${seesNotes ? '' : `AND g.kind <> 'NOTE'`} ORDER BY g.id`, [t['id']]);

  const [atts] = await pool.query<Row[]>('SELECT id, message_id, original_name, mime, size FROM tkt_attachment WHERE ticket_id = ? ORDER BY id', [t['id']]);
  const [fdefs] = await pool.query<Row[]>('SELECT * FROM tkt_field WHERE subcategory_id = ? ORDER BY sort_order, id', [t['subcategory_id']]);
  const values = t['field_values'] ? (JSON.parse(t['field_values']) as Record<string, unknown>) : {};

  let members: { userId: number; name: string; privilege: string; open: number; limit: number }[] = [];
  const canAssign = a.rank >= RANK['LEAD']!;
  const selfPick = m['assignment_method'] === 'SELF_PICK';
  const canTake = a.isMember && (a.rank >= RANK['LEAD']! || selfPick) && t['assignee_id'] == null && !DONE.includes(t['status']);
  const canHandOver = a.rank >= RANK['LEAD']! && t['assignee_id'] === userId;
  if ((canAssign || canHandOver) && t['team_id'] != null) members = await teamMembers(t['team_id']);

  const canRoute = a.isOwner || a.isAdmin;
  let routeTeams: { id: number; name: string }[] = [];
  if (canRoute) {
    const [rt] = await pool.query<Row[]>(
      'SELECT tm.id, tm.name FROM tkt_team tm WHERE tm.active = 1 ORDER BY tm.name');
    routeTeams = rt.map((r) => ({ id: r['id'], name: r['name'] }));
  }

  const live = t['status'] !== 'CLOSED' && t['status'] !== 'SPAM';
  const canTransfer = a.rank >= RANK['LEAD']! && live;
  const canRecategorize = a.rank >= RANK['LEAD']! && live;
  let transferTeams: { id: number; name: string }[] = [];
  if (canTransfer) {
    const [tt] = await pool.query<Row[]>(
      'SELECT tm.id, tm.name FROM tkt_team tm WHERE tm.active = 1 AND tm.id <> ? ORDER BY tm.name',
      [t['team_id'] ?? 0]);
    transferTeams = tt.map((r) => ({ id: r['id'], name: r['name'] }));
  }
  const [wt] = await pool.query<Row[]>('SELECT w.user_id, u.UserName FROM tkt_watcher w JOIN Users u ON u.UserID = w.user_id WHERE w.ticket_id = ? ORDER BY w.added_at', [t['id']]);
  const open = !DONE.includes(t['status']) || t['status'] === 'RESOLVED';
  return {
    key: t['ticket_key'], subject: t['subject'], description: t['description'], status: t['status'], priority: t['priority'],
    category: { id: t['category_id'], name: m['category_name'] }, subcategory: { id: t['subcategory_id'], name: m['sub_name'] },
    team: t['team_id'] != null ? { id: t['team_id'], name: m['team_name'], leadUserId: m['lead_user_id'] } : null,
    requester: { id: t['requester_id'], name: m['requester_name'], email: m['requester_email'], department: m['requester_dept'] ?? null, manager: m['manager_name'] ?? null },
    assignee: t['assignee_id'] != null ? { id: t['assignee_id'], name: m['assignee_name'] } : null,
    fields: fdefs.map((f) => ({ ...fieldOut(f), value: values[f['field_key']] ?? null })),
    messages: msgs.map((g) => ({
      id: g['id'], kind: g['kind'], body: g['body'], at: g['created_at'], authorId: g['author_id'], author: g['author_name'] ?? 'System',
      attachments: atts.filter((a) => a['message_id'] === g['id']).map((a) => ({ id: a['id'], name: a['original_name'], size: Number(a['size']), kind: kindOf(a['original_name']) })),
    })),
    createdAt: t['created_at'], updatedAt: t['updated_at'], firstResponseAt: t['first_response_at'], resolvedAt: t['resolved_at'], closedAt: t['closed_at'],
    resolutionNote: t['resolution_note'],
    permissions: {
      isRequester: a.isRequester, isAgent: a.isAgent,
      canReply: (a.isRequester || a.works) && t['status'] !== 'CLOSED' && t['status'] !== 'SPAM',
      canNote: a.works && t['status'] !== 'CLOSED' && t['status'] !== 'SPAM',
      canReopen: a.isRequester && reopenable(t),
      canSetPriority: a.works && open,
      canTake, canAssign, canHandOver, canRoute, canTransfer, canRecategorize,
      transitions: transitionsFor(t, a),
    },
    teamMembers: members, routeTeams, transferTeams, watchers: wt.map((w) => ({ userId: w['user_id'], name: w['UserName'] })),
    // the requester sees the consolidated time only; the team sees every lap
    timer: await timerOf(t['id']).then((tm) => (a.isAgent ? tm : { ...tm, laps: [] })),
  };
}

export async function getTeamMembers(teamId: number) { return teamMembers(teamId); }

async function teamMembers(teamId: number) {
  const [rows] = await pool.query<Row[]>(
    `SELECT m.user_id, m.privilege, u.UserName, tm.max_open,
       (SELECT COUNT(*) FROM tkt_ticket x WHERE x.assignee_id = m.user_id AND x.status NOT IN ('RESOLVED','CLOSED','SPAM')) AS open_n
     FROM tkt_team_member m JOIN tkt_team tm ON tm.id = m.team_id JOIN Users u ON u.UserID = m.user_id
     WHERE m.team_id = ? AND m.active = 1 AND u.UserStatus = 1 ORDER BY u.UserName`, [teamId]);
  return rows.map((r) => ({ userId: r['user_id'] as number, name: r['UserName'] as string, privilege: r['privilege'] as string, open: Number(r['open_n']), limit: r['max_open'] as number }));
}

/** The audit trail of a ticket for agents: events, ownership periods and whether the chain is intact */
export async function history(key: string, userId: number) {
  const t = await loadByKey(pool, key);
  const a = await accessFor(pool, userId, t);
  if (!a.isAgent) throw AppError.forbidden('Only the handling team can see the history.');
  const [ev] = await pool.query<Row[]>(
    `SELECT e.*, u.UserName AS actor_name, iu.UserName AS imp_name, tu.UserName AS target_name, tm.name AS team_name
     FROM tkt_event e LEFT JOIN Users u ON u.UserID = e.actor_user_id LEFT JOIN Users iu ON iu.UserID = e.impersonated_by
     LEFT JOIN Users tu ON tu.UserID = e.user_id LEFT JOIN tkt_team tm ON tm.id = e.team_id WHERE e.ticket_id = ? ORDER BY e.id`, [t['id']]);
  const [pr] = await pool.query<Row[]>(
    `SELECT p.*, u.UserName AS user_name, tm.name AS team_name FROM tkt_period p LEFT JOIN Users u ON u.UserID = p.assignee_id LEFT JOIN tkt_team tm ON tm.id = p.team_id
     WHERE p.ticket_id = ? ORDER BY p.id`, [t['id']]);
  return {
    chain: await verifyChain(t['id']),
    events: ev.map((e) => ({
      id: e['id'], type: e['event_type'], kind: e['actor_kind'], actor: e['actor_name'] ?? (e['actor_kind'] === 'USER' ? `#${e['actor_user_id']}` : 'System'),
      impersonatedBy: e['imp_name'] ?? null, old: e['old_value'] ? JSON.parse(e['old_value']) : null, next: e['new_value'] ? JSON.parse(e['new_value']) : null,
      details: e['details'], team: e['team_name'] ?? null, user: e['target_name'] ?? null, at: e['created_at'],
    })),
    periods: pr.map((p) => ({
      id: p['id'], team: p['team_name'] ?? null, assignee: p['user_name'] ?? null, status: p['status'], from: p['started_at'], to: p['ended_at'], endedBecause: p['ended_because'],
    })),
  };
}

// ── Writing ──────────────────────────────────────────────────────────────────────────────────────

export interface NewTicket {
  categoryId?: number; subject: string; description: string; priority?: Priority;
  /** the team the requester chose (it must handle the group); without it the routing rules and defaults choose */
  teamId?: number;
  /** a person of that team the requester chose; without it the team's assignment method picks, or the lead assigns */
  assigneeId?: number;
  /** optional: a ticket type of the group, and the answers to its form (the New ticket form no longer asks for these) */
  subcategoryId?: number; fields?: Record<string, unknown>;
}

/** The group's ticket type for tickets raised without choosing one: its first open type, made on the spot ("General") when it has none */
async function defaultType(conn: Conn, categoryId: number): Promise<Row> {
  const [open] = await conn.query<Row[]>('SELECT * FROM tkt_subcategory WHERE category_id = ? AND active = 1 ORDER BY sort_order, id LIMIT 1', [categoryId]);
  if (open[0]) return open[0];
  await conn.query(`INSERT INTO tkt_subcategory (category_id, name, active, sort_order) VALUES (?, 'General', 1, 0) ON DUPLICATE KEY UPDATE active = 1`, [categoryId]);
  const [made] = await conn.query<Row[]>(`SELECT * FROM tkt_subcategory WHERE category_id = ? AND name = 'General'`, [categoryId]);
  return made[0]!;
}

function checkFields(defs: Row[], given: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of defs) {
    const key = f['field_key'] as string;
    const raw = given[key];
    const empty = raw === undefined || raw === null || String(raw).trim() === '';
    if (empty) {
      if (f['required']) throw AppError.badRequest(`${f['label']} is required.`);
      continue;
    }
    const v = String(raw).trim();
    if (f['field_type'] === 'NUMBER' && !Number.isFinite(Number(v))) throw AppError.badRequest(`${f['label']} must be a number.`);
    if (f['field_type'] === 'DATE' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw AppError.badRequest(`${f['label']} must be a date (YYYY-MM-DD).`);
    if (f['field_type'] === 'SELECT' && !(JSON.parse(f['options'] ?? '[]') as string[]).includes(v)) throw AppError.badRequest(`${f['label']}: pick one of the listed options.`);
    out[key] = f['field_type'] === 'NUMBER' ? Number(v) : v;
  }
  return out;
}

/** Raise a ticket: key from the category prefix, the category's default team (else Triage), first message, event log and first period */
export async function createTicket(input: NewTicket, actor: Actor, files: SavedFile[] = []) {
  const priority = input.priority ?? 'MEDIUM';
  if (!(PRIORITIES as readonly string[]).includes(priority)) throw AppError.badRequest('Invalid priority.');
  return withTx(async (conn) => {
    // the group is implied by the ticket type (people no longer choose one)
    let categoryId = input.categoryId ?? 0;
    if (input.subcategoryId != null) {
      const [own] = await conn.query<Row[]>('SELECT category_id FROM tkt_subcategory WHERE id = ?', [input.subcategoryId]);
      if (own[0]) categoryId = own[0]['category_id'];
    }
    const [cats] = await conn.query<Row[]>('SELECT * FROM tkt_category WHERE id = ? AND active = 1', [categoryId]);
    const cat = cats[0];
    if (!cat) throw AppError.badRequest('Pick a category.');
    let sub: Row;
    let values: Record<string, unknown> = {};
    if (input.subcategoryId != null) {
      const [subs] = await conn.query<Row[]>('SELECT * FROM tkt_subcategory WHERE id = ? AND category_id = ? AND active = 1', [input.subcategoryId, categoryId]);
      if (!subs[0]) throw AppError.badRequest('Pick a category.');
      sub = subs[0];
      const [defs] = await conn.query<Row[]>('SELECT * FROM tkt_field WHERE subcategory_id = ? ORDER BY sort_order, id', [sub['id']]);
      // ticket types no longer ask extra questions (the form sends none), so nothing is required
      values = defs.length && input.fields ? checkFields(defs, input.fields) : {};
    } else {
      sub = await defaultType(conn, cat['id']);
    }
    const subcategoryId = sub['id'] as number;

    // the team: the one the requester chose, else the routing rules and defaults
    let route: { teamId: number | null; via: string; ruleId: number | null };
    if (input.teamId != null) {
      const [tm] = await conn.query<Row[]>(
        `SELECT t.id, t.department_id FROM tkt_team t WHERE t.id = ? AND t.active = 1`, [input.teamId]);
      if (!tm[0]) throw AppError.badRequest('Choose a department.');
      const mine = await raisableTeams(conn, actor.userId);
      // (an old custom team has no department, so there is nothing to compare)
      if (input.assigneeId != null && tm[0]['department_id'] != null && !mine.choose && !mine.all) throw AppError.forbidden('Tickets you raise for yourself go to your department; it chooses who takes them.');
      if (tm[0]['department_id'] != null && !mine.all && !mine.ids.includes(input.teamId)) throw AppError.forbidden('You can raise tickets only to your own department, or to the ones you lead or manage.');
      route = { teamId: input.teamId, via: 'Team chosen by the requester', ruleId: null };
    } else {
      route = await resolveTeam(conn, cat['id'], { subcategoryId, fields: values, departmentIds: await departmentsOf(conn, actor.userId), priority });
    }
    const teamId = route.teamId;
    if (input.assigneeId != null) {
      if (teamId == null) throw AppError.badRequest('Choose a team before choosing a person.');
      await syncDepartmentTeam(conn, teamId);
      const [mem] = await conn.query<Row[]>(
        `SELECT 1 FROM tkt_team_member m JOIN Users u ON u.UserID = m.user_id WHERE m.team_id = ? AND m.user_id = ? AND m.active = 1 AND u.UserStatus = 1`, [teamId, input.assigneeId]);
      if (!mem[0]) throw AppError.badRequest('That person is not an active member of the chosen team.');
    }

    await conn.query('UPDATE tkt_category SET next_no = LAST_INSERT_ID(next_no + 1) WHERE id = ?', [cat['id']]);
    const [no] = await conn.query<Row[]>('SELECT LAST_INSERT_ID() AS n');
    const key = `${cat['prefix']}-${no[0]!['n']}`;

    const now = new Date();
    const [ins] = await conn.query<mysql.ResultSetHeader>(
      `INSERT INTO tkt_ticket (ticket_key, category_id, subcategory_id, team_id, requester_id, subject, description, priority, status, field_values, source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?, 'OPEN', ?, 'WEB', ?, ?)`,
      [key, cat['id'], subcategoryId, teamId, actor.userId, input.subject.trim(), input.description.trim(), priority, Object.keys(values).length ? JSON.stringify(values) : null, now, now]);
    const id = ins.insertId;
    const [first] = await conn.query<mysql.ResultSetHeader>('INSERT INTO tkt_message (ticket_id, author_id, kind, body, created_at) VALUES (?,?,?,?,?)', [id, actor.userId, 'REPLY', input.description.trim(), now]);
    await addAttachments(conn, id, first.insertId, actor.userId, files, now);
    await recordEvent(conn, id, {
      type: 'create', actor, categoryId: cat['id'], teamId,
      next: { category: cat['name'], subcategory: sub['name'], priority }, details: withFiles(`Raised by the web form as ${key}`, files),
    }, now);
    await logRoute(conn, id, route, now);
    let who: number | null = null;
    if (input.assigneeId != null) {
      who = input.assigneeId;
      await conn.query('UPDATE tkt_ticket SET assignee_id = ? WHERE id = ?', [who, id]);
      await recordEvent(conn, id, { type: 'assign', actor, old: { userId: null }, next: { userId: who }, userId: who, teamId, details: 'Person chosen by the requester' }, now);
    } else if (teamId != null) {
      who = await autoAssign(conn, id, teamId, subcategoryId, now);
    }
    await rollPeriod(conn, { id, teamId, assigneeId: who, status: 'OPEN' }, now, 'created');
    return { key };
  });
}

/** Records the files that came with a message (the files are already on disk) */
async function addAttachments(conn: Conn, ticketId: number | string, messageId: number | string, userId: number, files: SavedFile[], now: Date) {
  for (const f of files) {
    await conn.query(
      'INSERT INTO tkt_attachment (ticket_id, message_id, uploaded_by, original_name, stored_name, mime, size, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [ticketId, messageId, userId, f.originalName, f.storedName, f.mime, f.size, now]);
  }
}
const withFiles = (text: string, files: SavedFile[]) => (files.length ? `${text} (${files.length} file${files.length > 1 ? 's' : ''} attached)` : text);

const departmentsOf = async (db: Conn, userId: number) => {
  void db; void userId;
  return [] as number[];
};

/** Logs how the team was chosen (a rule, a default, or Triage) */
async function logRoute(conn: Conn, ticketId: number | string, route: { teamId: number | null; ruleId: number | null; via: string }, now: Date) {
  await recordEvent(conn, ticketId, { type: 'route', actor: null, kind: route.ruleId ? 'RULE' : 'SYSTEM', teamId: route.teamId, ruleId: route.ruleId, next: { teamId: route.teamId }, details: route.via }, now);
}

/**
 * Runs the team's assignment method. When it names a person the ticket is assigned to them (logged as a rule event);
 * when not (manual, self-pick, nobody available) the ticket waits in the team list and the reason is logged. The caller rolls the period.
 */
async function autoAssign(conn: Conn, ticketId: number | string, teamId: number, subcategoryId: number, now: Date): Promise<number | null> {
  await syncDepartmentTeam(conn, teamId);
  const [sub] = await conn.query<Row[]>('SELECT skill FROM tkt_subcategory WHERE id = ?', [subcategoryId]);
  const pick = await pickAssignee(conn, teamId, (sub[0]?.['skill'] as string | null | undefined) ?? null);
  if (pick.userId != null) {
    await conn.query('UPDATE tkt_ticket SET assignee_id = ?, updated_at = ? WHERE id = ?', [pick.userId, now, ticketId]);
    await conn.query('UPDATE tkt_team SET last_assigned_user_id = ? WHERE id = ?', [pick.userId, teamId]);
  }
  const skipped = pick.skipped.length ? ` · skipped: ${pick.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}` : '';
  await recordEvent(conn, ticketId, { type: 'assign', actor: null, kind: 'RULE', old: { userId: null }, next: { userId: pick.userId }, userId: pick.userId, teamId, details: `${pick.why}${skipped}` }, now);
  return pick.userId;
}

async function addWatcher(conn: Conn, ticketId: number | string, userId: number, addedBy: number, reason: string, now: Date) {
  await conn.query('INSERT IGNORE INTO tkt_watcher (ticket_id, user_id, added_by, reason, added_at) VALUES (?,?,?,?,?)', [ticketId, userId, addedBy, reason, now]);
}

async function mustWork(conn: Conn, key: string, actor: Actor) {
  const t = await loadByKey(conn, key, true);
  const a = await accessFor(conn, actor.userId, t);
  return { t, a };
}

const isClosed = (t: Row) => t['status'] === 'CLOSED' || t['status'] === 'SPAM';

/** Applies a status change inside the caller's transaction: ticket row, event, period */
async function applyStatus(conn: Conn, t: Row, to: Status, actor: Actor | null, now: Date, because: string, details: string, kind: 'USER' | 'SYSTEM' | 'RULE' = 'USER') {
  const from = t['status'] as Status;
  const sets: string[] = ['status = ?', 'updated_at = ?'];
  const params: unknown[] = [to, now];
  if (to === 'RESOLVED') { sets.push('resolved_at = ?'); params.push(now); }
  if (from === 'RESOLVED' && to !== 'RESOLVED' && to !== 'CLOSED') { sets.push('resolved_at = NULL'); }
  if (to === 'CLOSED' || to === 'SPAM') { sets.push('closed_at = ?'); params.push(now); }
  await conn.query(`UPDATE tkt_ticket SET ${sets.join(', ')} WHERE id = ?`, [...params, t['id']]);
  await recordEvent(conn, t['id'], { type: 'status', actor, kind: actor === null && kind === 'USER' ? 'SYSTEM' : kind, old: { status: from }, next: { status: to }, details }, now);
  await rollPeriod(conn, { id: t['id'], teamId: t['team_id'], assigneeId: t['assignee_id'], status: to }, now, because);
  t['status'] = to;
}

/** A public reply. The requester's reply wakes a Pending ticket and reopens a Resolved one (within 7 days); an agent's first reply is the first response. */
export async function reply(key: string, actor: Actor, body: string, files: SavedFile[] = []) {
  await withTx(async (conn) => {
    const { t, a } = await mustWork(conn, key, actor);
    if (!a.isRequester && !a.works) throw AppError.forbidden('You cannot reply to this ticket.');
    if (isClosed(t)) throw AppError.badRequest('This ticket is closed. Raise a new ticket instead.');
    const now = new Date();
    const asAgent = a.works;
    if (!asAgent && t['status'] === 'RESOLVED' && !reopenable(t)) throw AppError.badRequest(`This ticket was resolved more than ${REOPEN_DAYS} days ago. Raise a new ticket instead.`);

    const [msg] = await conn.query<mysql.ResultSetHeader>('INSERT INTO tkt_message (ticket_id, author_id, kind, body, created_at) VALUES (?,?,?,?,?)', [t['id'], actor.userId, 'REPLY', body.trim(), now]);
    await addAttachments(conn, t['id'], msg.insertId, actor.userId, files, now);
    await conn.query('UPDATE tkt_ticket SET updated_at = ? WHERE id = ?', [now, t['id']]);
    await recordEvent(conn, t['id'], { type: 'reply', actor, details: withFiles(asAgent ? 'Public reply from the team' : 'Reply from the requester', files) }, now);

    if (asAgent) {
      if (t['first_response_at'] == null) {
        await conn.query('UPDATE tkt_ticket SET first_response_at = ? WHERE id = ?', [now, t['id']]);
        const mins = Math.round((now.getTime() - new Date(t['created_at']).getTime()) / 60_000);
        await recordEvent(conn, t['id'], { type: 'reply', actor, details: `First response (${mins} min after creation)` }, now);
      }
    }
    // the status is never changed by a reply: the team and the requester change it by hand
  });
}

/** An internal note: agents only; the first one by the assignee starts the work */
export async function addNote(key: string, actor: Actor, body: string, files: SavedFile[] = []) {
  await withTx(async (conn) => {
    const { t, a } = await mustWork(conn, key, actor);
    if (!a.works) throw AppError.forbidden('Only the agent working this ticket can add notes.');
    if (isClosed(t)) throw AppError.badRequest('This ticket is closed.');
    const now = new Date();
    const [msg] = await conn.query<mysql.ResultSetHeader>('INSERT INTO tkt_message (ticket_id, author_id, kind, body, created_at) VALUES (?,?,?,?,?)', [t['id'], actor.userId, 'NOTE', body.trim(), now]);
    await addAttachments(conn, t['id'], msg.insertId, actor.userId, files, now);
    await conn.query('UPDATE tkt_ticket SET updated_at = ? WHERE id = ?', [now, t['id']]);
    await recordEvent(conn, t['id'], { type: 'note', actor, details: withFiles('Internal note added', files) }, now);
  });
}

/** A status change by an agent: only the moves listed in transitionsFor; On Hold needs a comment, Resolved a note for the requester */
export async function changeStatus(key: string, actor: Actor, to: Status, text?: string) {
  await withTx(async (conn) => {
    const { t, a } = await mustWork(conn, key, actor);
    const step = transitionsFor(t, a).find((x) => x.to === to);
    if (!step) throw AppError.badRequest(`You cannot move this ticket from ${t['status']} to ${to}.`);
    const note = text?.trim() ?? '';
    if (step.needs && !note) throw AppError.badRequest(step.needs === 'comment' ? 'Say what the ticket is waiting on.' : 'A resolution note is required.');
    const now = new Date();
    if (to === 'RESOLVED') {
      await conn.query('INSERT INTO tkt_message (ticket_id, author_id, kind, body, created_at) VALUES (?,?,?,?,?)', [t['id'], actor.userId, 'REPLY', note, now]);
      await conn.query('UPDATE tkt_ticket SET resolution_note = ? WHERE id = ?', [note, t['id']]);
    }
    await applyStatus(conn, t, to, actor, now, `status set to ${to}`, note ? `${t['status']} → ${to}: ${note}` : `${t['status']} → ${to}`);
  });
}

/** The requester brings a Resolved ticket back within 7 days; it returns to the same agent */
export async function reopen(key: string, actor: Actor, reason?: string) {
  await withTx(async (conn) => {
    const { t, a } = await mustWork(conn, key, actor);
    if (!a.isRequester) throw AppError.forbidden('Only the requester can reopen a ticket.');
    if (!reopenable(t)) throw AppError.badRequest(`Only a ticket resolved in the last ${REOPEN_DAYS} days can be reopened.`);
    const now = new Date();
    if (reason?.trim()) await conn.query('INSERT INTO tkt_message (ticket_id, author_id, kind, body, created_at) VALUES (?,?,?,?,?)', [t['id'], actor.userId, 'REPLY', reason.trim(), now]);
    await applyStatus(conn, t, 'OPEN', actor, now, 'reopened by requester', reason?.trim() ? `Reopened: ${reason.trim()}` : 'Reopened by the requester');
  });
}

export async function setPriority(key: string, actor: Actor, priority: Priority) {
  if (!(PRIORITIES as readonly string[]).includes(priority)) throw AppError.badRequest('Invalid priority.');
  await withTx(async (conn) => {
    const { t, a } = await mustWork(conn, key, actor);
    if (!a.works || isClosed(t)) throw AppError.forbidden('You cannot change the priority of this ticket.');
    if (t['priority'] === priority) return;
    const now = new Date();
    await conn.query('UPDATE tkt_ticket SET priority = ?, updated_at = ? WHERE id = ?', [priority, now, t['id']]);
    await recordEvent(conn, t['id'], { type: 'field', actor, old: { priority: t['priority'] }, next: { priority }, details: `Priority ${t['priority']} → ${priority}` }, now);
  });
}

async function assignInTx(conn: Conn, t: Row, userId: number | null, actor: Actor, now: Date, details: string) {
  if (userId != null) {
    if (t['team_id'] == null) throw AppError.badRequest('Route the ticket to a team first.');
    const [m] = await conn.query<Row[]>(
      `SELECT 1 FROM tkt_team_member m JOIN Users u ON u.UserID = m.user_id WHERE m.team_id = ? AND m.user_id = ? AND m.active = 1 AND u.UserStatus = 1`, [t['team_id'], userId]);
    if (!m[0]) throw AppError.badRequest('That person is not an active member of the ticket\'s team.');
  }
  if ((t['assignee_id'] ?? null) === userId) return;
  const old = t['assignee_id'] ?? null;
  await conn.query('UPDATE tkt_ticket SET assignee_id = ?, updated_at = ? WHERE id = ?', [userId, now, t['id']]);
  t['assignee_id'] = userId;
  await recordEvent(conn, t['id'], { type: 'assign', actor, old: { userId: old }, next: { userId }, userId, teamId: t['team_id'], details }, now);
  await rollPeriod(conn, { id: t['id'], teamId: t['team_id'], assigneeId: userId, status: t['status'] }, now, userId == null ? 'unassigned' : old == null ? 'assigned' : 'reassigned');
}

/** Team lead (or above) assigns anyone in the team or clears the assignee; a Senior agent can hand their own ticket to a teammate */
export async function assign(key: string, actor: Actor, userId: number | null) {
  await withTx(async (conn) => {
    const { t, a } = await mustWork(conn, key, actor);
    if (isClosed(t)) throw AppError.badRequest('This ticket is closed.');
    const lead = a.rank >= RANK['LEAD']!;
    const handOver = a.rank >= RANK['LEAD']! && t['assignee_id'] === actor.userId && userId != null;
    if (!lead && !handOver) throw AppError.forbidden('Only the team lead can assign this ticket.');
    await assignInTx(conn, t, userId, actor, new Date(), userId == null ? 'Unassigned' : lead ? 'Assigned by the team lead' : 'Handed over by the assignee');
  });
}

/** A Senior agent takes an unassigned ticket from the team list */
export async function take(key: string, actor: Actor) {
  await withTx(async (conn) => {
    const { t, a } = await mustWork(conn, key, actor);
    const [tm] = await conn.query<Row[]>('SELECT assignment_method FROM tkt_team WHERE id = ?', [t['team_id'] ?? 0]);
    const selfPick = tm[0]?.['assignment_method'] === 'SELF_PICK';
    if (!a.isMember || (a.rank < RANK['LEAD']! && !selfPick)) throw AppError.forbidden('Only Leads and Admins can take tickets from the list (anyone on a self-pick team can).');
    if (t['assignee_id'] != null || isClosed(t)) throw AppError.badRequest('This ticket already has an owner.');
    await assignInTx(conn, t, actor.userId, actor, new Date(), 'Taken from the team list');
  });
}

/** The category owner (or an admin) picks the team: for tickets waiting in Triage, or to move one to another team of the category */
export async function route(key: string, actor: Actor, teamId: number) {
  await withTx(async (conn) => {
    const { t, a } = await mustWork(conn, key, actor);
    if (!a.isOwner && !a.isAdmin) throw AppError.forbidden('Only the category owner can choose the team.');
    if (isClosed(t)) throw AppError.badRequest('This ticket is closed.');
    if (t['team_id'] === teamId) return;
    const [tm] = await conn.query<Row[]>(
      `SELECT t.id, t.name FROM tkt_team t WHERE t.id = ? AND t.active = 1`, [teamId]);
    if (!tm[0]) throw AppError.badRequest('That team does not exist or is switched off.');
    const now = new Date();
    const old = { teamId: t['team_id'] ?? null, assigneeId: t['assignee_id'] ?? null };
    await conn.query('UPDATE tkt_ticket SET team_id = ?, assignee_id = NULL, updated_at = ? WHERE id = ?', [teamId, now, t['id']]);
    t['team_id'] = teamId;
    t['assignee_id'] = null;
    await recordEvent(conn, t['id'], { type: 'route', actor, old, next: { teamId, assigneeId: null }, teamId, details: `Routed to ${tm[0]['name']} by ${a.isAdmin ? 'an admin' : 'the category owner'}` }, now);
    const who = await autoAssign(conn, t['id'], teamId, t['subcategory_id'], now);
    await rollPeriod(conn, { id: t['id'], teamId, assigneeId: who, status: t['status'] }, now, 'routed to a team');
  });
}

// ── Handoffs ─────────────────────────────────────────────────────────────────────────────────────

const systemNote = (conn: Conn, ticketId: number | string, body: string, now: Date) =>
  conn.query('INSERT INTO tkt_message (ticket_id, author_id, kind, body, created_at) VALUES (?,?,?,?,?)', [ticketId, null, 'SYSTEM', body, now]);

/** Team to team inside the category. Reason required; the old owner stays a watcher; the new team's assignment method runs; the requester is told. */
export async function transfer(key: string, actor: Actor, teamId: number, reason: string) {
  const why = reason.trim();
  if (why.length < 3) throw AppError.badRequest('Say why you are sending it to another team.');
  await withTx(async (conn) => {
    const { t, a } = await mustWork(conn, key, actor);
    if (a.rank < RANK['LEAD']!) throw AppError.forbidden('Only Leads and Admins can transfer a ticket to another team.');
    if (isClosed(t)) throw AppError.badRequest('This ticket is closed. Raise a linked ticket instead.');
    if (t['team_id'] === teamId) throw AppError.badRequest('It is already with that team.');
    const [tm] = await conn.query<Row[]>(
      `SELECT t.id, t.name FROM tkt_team t WHERE t.id = ? AND t.active = 1`, [teamId]);
    if (!tm[0]) throw AppError.badRequest('That team does not exist or is switched off.');
    const [from] = await conn.query<Row[]>('SELECT name FROM tkt_team WHERE id = ?', [t['team_id'] ?? 0]);
    const now = new Date();
    const old = { teamId: t['team_id'] ?? null, assigneeId: t['assignee_id'] ?? null };
    if (t['assignee_id'] != null) await addWatcher(conn, t['id'], t['assignee_id'], actor.userId, 'handoff', now);
    await conn.query('UPDATE tkt_ticket SET team_id = ?, assignee_id = NULL, updated_at = ? WHERE id = ?', [teamId, now, t['id']]);
    t['team_id'] = teamId;
    t['assignee_id'] = null;
    await recordEvent(conn, t['id'], {
      type: 'transfer', actor, old, next: { teamId, assigneeId: null }, teamId,
      details: `Team transfer ${from[0]?.['name'] ?? 'Triage'} → ${tm[0]['name']}. Reason: "${why}"${old.assigneeId != null ? ' · the previous owner is kept as a watcher' : ''}`,
    }, now);
    await systemNote(conn, t['id'], `Your ticket was moved to ${tm[0]['name']}.`, now);
    const who = await autoAssign(conn, t['id'], teamId, t['subcategory_id'], now);
    await rollPeriod(conn, { id: t['id'], teamId, assigneeId: who, status: t['status'] }, now, 'team transfer');
  });
}

export interface Recategorize { categoryId: number; subcategoryId: number; fields?: Record<string, unknown>; reason: string }

/** Wrong kind of request: another category and sub-category. Team lead or category owner; reason required; the new category's routing rules run. The key stays. */
export async function recategorize(key: string, actor: Actor, input: Recategorize) {
  const why = input.reason.trim();
  if (why.length < 3) throw AppError.badRequest('Say why it belongs in another category.');
  await withTx(async (conn) => {
    const { t, a } = await mustWork(conn, key, actor);
    if (a.rank < RANK['LEAD']!) throw AppError.forbidden('Only the team lead or the category owner can re-categorize a ticket.');
    if (isClosed(t)) throw AppError.badRequest('This ticket is closed. Raise a linked ticket instead.');
    if (t['category_id'] === input.categoryId && t['subcategory_id'] === input.subcategoryId) throw AppError.badRequest('It is already in that category and sub-category.');
    const [cats] = await conn.query<Row[]>('SELECT id, name FROM tkt_category WHERE id = ? AND active = 1', [input.categoryId]);
    const [subs] = await conn.query<Row[]>('SELECT id, name FROM tkt_subcategory WHERE id = ? AND category_id = ? AND active = 1', [input.subcategoryId, input.categoryId]);
    if (!cats[0] || !subs[0]) throw AppError.badRequest('Pick an open category and one of its sub-categories.');
    const [oldCat] = await conn.query<Row[]>('SELECT c.name AS c, s.name AS s FROM tkt_category c JOIN tkt_subcategory s ON s.id = ? WHERE c.id = ?', [t['subcategory_id'], t['category_id']]);
    const [defs] = await conn.query<Row[]>('SELECT * FROM tkt_field WHERE subcategory_id = ? ORDER BY sort_order, id', [input.subcategoryId]);
    const before = t['field_values'] ? (JSON.parse(t['field_values']) as Record<string, unknown>) : {};
    const values = checkFields(defs, { ...before, ...(input.fields ?? {}) });
    const route = await resolveTeam(conn, input.categoryId, { subcategoryId: input.subcategoryId, fields: values, departmentIds: await departmentsOf(conn, t['requester_id']), priority: t['priority'] });

    const now = new Date();
    const old = { category: oldCat[0]?.['c'], subcategory: oldCat[0]?.['s'], teamId: t['team_id'] ?? null, assigneeId: t['assignee_id'] ?? null };
    if (t['assignee_id'] != null) await addWatcher(conn, t['id'], t['assignee_id'], actor.userId, 'handoff', now);
    await conn.query('UPDATE tkt_ticket SET category_id = ?, subcategory_id = ?, team_id = ?, assignee_id = NULL, field_values = ?, updated_at = ? WHERE id = ?',
      [input.categoryId, input.subcategoryId, route.teamId, Object.keys(values).length ? JSON.stringify(values) : null, now, t['id']]);
    t['category_id'] = input.categoryId;
    t['subcategory_id'] = input.subcategoryId;
    t['team_id'] = route.teamId;
    t['assignee_id'] = null;
    await recordEvent(conn, t['id'], {
      type: 'recategorize', actor, old, next: { category: cats[0]['name'], subcategory: subs[0]['name'], teamId: route.teamId }, categoryId: input.categoryId, teamId: route.teamId,
      details: `Re-categorized ${old.category} › ${old.subcategory} → ${cats[0]['name']} › ${subs[0]['name']}. Reason: "${why}"${old.assigneeId != null ? ' · the previous owner is kept as a watcher' : ''}`,
    }, now);
    await logRoute(conn, t['id'], route, now);
    await systemNote(conn, t['id'], `Your ticket was moved to ${cats[0]['name']} › ${subs[0]['name']}.`, now);
    const who = route.teamId != null ? await autoAssign(conn, t['id'], route.teamId, input.subcategoryId, now) : null;
    await rollPeriod(conn, { id: t['id'], teamId: route.teamId, assigneeId: who, status: t['status'] }, now, 'recategorized');
  });
}

/** The "Away" switch: while on, automatic assignment skips this person in every team they are in */

// ── Attachments: a signed link for someone who may see the ticket, then the file behind a link ─────────

async function attachmentFor(db: typeof pool, attachmentId: string, userId: number) {
  const [rows] = await db.query<Row[]>(
    `SELECT a.*, g.kind AS message_kind, t.ticket_key FROM tkt_attachment a LEFT JOIN tkt_message g ON g.id = a.message_id JOIN tkt_ticket t ON t.id = a.ticket_id WHERE a.id = ?`, [attachmentId]);
  const a = rows[0];
  if (!a) throw AppError.notFound('That file no longer exists.');
  const t = await loadByKey(db, a['ticket_key']);
  const acc = await accessFor(db, userId, t);
  // the same people who can see the ticket; a file on an internal note is for agents only
  if (!acc.isRequester && !acc.isAgent && !acc.isWatcher) throw AppError.forbidden('You do not have access to this file.');
  if (a['message_kind'] === 'NOTE' && !acc.isAgent) throw AppError.forbidden('You do not have access to this file.');
  return a;
}

/** A link (valid for ten minutes) to open or download one attachment */
export async function attachmentLink(key: string, attachmentId: string, userId: number) {
  const a = await attachmentFor(pool, attachmentId, userId);
  if (String(a['ticket_key']) !== key.toUpperCase()) throw AppError.notFound('That file is not on this ticket.');
  return { url: `/api/ticketing/files/${signLink(a['id'], userId)}`, name: a['original_name'] as string, kind: kindOf(a['original_name']), size: Number(a['size']) };
}

/** What to send for a link that was handed out by attachmentLink */
export async function attachmentByLink(token: string) {
  const { attachmentId, userId } = readLink(token);
  const a = await attachmentFor(pool, attachmentId, userId);
  return { path: pathOf(a['stored_name']), name: a['original_name'] as string, mime: (a['mime'] as string | null) ?? 'application/octet-stream', kind: kindOf(a['original_name']) };
}

// ── Report: one consolidated summary of the tickets a person may see ─────────────────────────────────

export interface ReportQuery { from?: string; to?: string; teamId?: number; status?: string; priority?: string; typeId?: number; assigneeId?: number; unassigned?: boolean; q?: string }
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function report(userId: number, q: ReportQuery) {
  const who = await me(userId);
  if (!who.isAgent) throw AppError.forbidden('You are not on a ticketing team yet.');
  const to = q.to && DAY.test(q.to) ? q.to : new Date().toISOString().slice(0, 10);
  const from = q.from && DAY.test(q.from) ? q.from : new Date(Date.parse(to) - 29 * 86_400_000).toISOString().slice(0, 10);

  // the same tickets the person sees on the Tickets page, raised between the two dates
  const params: unknown[] = [`${from} 00:00:00`, `${to} 23:59:59`];
  const conds = ['t.created_at >= ?', 't.created_at <= ?'];
  if (!who.isAdmin) {
    conds.push('(t.team_id IN (?) OR t.category_id IN (?))');
    params.push(who.teams.length ? who.teams.map((t) => t.id) : [0], who.ownedCategories.length ? who.ownedCategories.map((c) => c.id) : [0]);
  }
  if (q.teamId) { conds.push('t.team_id = ?'); params.push(q.teamId); }
  if (q.status && (STATUSES as readonly string[]).includes(q.status)) { conds.push('t.status = ?'); params.push(q.status); }
  if (q.priority && (PRIORITIES as readonly string[]).includes(q.priority)) { conds.push('t.priority = ?'); params.push(q.priority); }
  if (q.typeId) { conds.push('t.subcategory_id = ?'); params.push(q.typeId); }
  if (q.assigneeId) { conds.push('t.assignee_id = ?'); params.push(q.assigneeId); }
  if (q.unassigned) conds.push('t.assignee_id IS NULL');
  if (q.q?.trim()) { conds.push('(t.subject LIKE ? OR t.ticket_key LIKE ?)'); params.push(`%${q.q.trim()}%`, `%${q.q.trim()}%`); }
  const where = conds.join(' AND ');
  const open = `t.status NOT IN ('RESOLVED','CLOSED','SPAM')`;
  const num = (v: unknown) => (v == null ? null : Number(v));
  const get = async (sql: string) => (await pool.query<Row[]>(sql, params))[0];

  const [tot] = await get(`SELECT COUNT(*) AS raised, SUM(${open}) AS open_n, SUM(t.status = 'RESOLVED') AS resolved_n, SUM(t.status = 'CLOSED') AS closed_n, SUM(t.status = 'SPAM') AS spam_n,
      SUM(t.assignee_id IS NULL AND ${open}) AS unassigned_n, SUM(t.team_id IS NULL AND ${open}) AS triage_n,
      AVG(TIMESTAMPDIFF(MINUTE, t.created_at, t.first_response_at)) AS first_resp, AVG(TIMESTAMPDIFF(MINUTE, t.created_at, t.resolved_at)) AS resolve_min
    FROM tkt_ticket t WHERE ${where}`) as [Row];
  const t0 = tot ?? {};

  const byStatus = await get(`SELECT t.status AS k, COUNT(*) AS n FROM tkt_ticket t WHERE ${where} GROUP BY t.status`);
  const byPriority = await get(`SELECT t.priority AS k, COUNT(*) AS n FROM tkt_ticket t WHERE ${where} GROUP BY t.priority`);
  const byTeam = await get(`SELECT COALESCE(tm.name, 'Triage (no team)') AS k, COUNT(*) AS n, SUM(${open}) AS open_n, SUM(t.status IN ('RESOLVED','CLOSED')) AS done_n,
      AVG(TIMESTAMPDIFF(MINUTE, t.created_at, t.first_response_at)) AS first_resp
    FROM tkt_ticket t LEFT JOIN tkt_team tm ON tm.id = t.team_id WHERE ${where} GROUP BY tm.id, tm.name ORDER BY n DESC`);
  const byType = await get(`SELECT s.name AS k, COUNT(*) AS n, SUM(${open}) AS open_n FROM tkt_ticket t JOIN tkt_subcategory s ON s.id = t.subcategory_id WHERE ${where} GROUP BY s.id, s.name ORDER BY n DESC`);
  const byAgent = await get(`SELECT u.UserName AS k, COUNT(*) AS n, SUM(${open}) AS open_n, SUM(t.status IN ('RESOLVED','CLOSED')) AS done_n
    FROM tkt_ticket t JOIN Users u ON u.UserID = t.assignee_id WHERE ${where} GROUP BY u.UserID, u.UserName ORDER BY n DESC LIMIT 20`);
  const byRequester = await get(`SELECT u.UserName AS k, COUNT(*) AS n FROM tkt_ticket t JOIN Users u ON u.UserID = t.requester_id WHERE ${where} GROUP BY u.UserID, u.UserName ORDER BY n DESC LIMIT 10`);
  const perDay = await get(`SELECT DATE_FORMAT(t.created_at, '%Y-%m-%d') AS k, COUNT(*) AS n FROM tkt_ticket t WHERE ${where} GROUP BY k ORDER BY k`);
  const oldest = await get(`SELECT t.ticket_key, t.subject, t.status, t.priority, tm.name AS team_name, au.UserName AS assignee_name, TIMESTAMPDIFF(HOUR, t.created_at, NOW()) AS age_h
    FROM tkt_ticket t LEFT JOIN tkt_team tm ON tm.id = t.team_id LEFT JOIN Users au ON au.UserID = t.assignee_id WHERE ${where} AND ${open} ORDER BY t.created_at ASC LIMIT 10`);

  const teams = who.isAdmin
    ? (await pool.query<Row[]>('SELECT id, name FROM tkt_team WHERE active = 1 ORDER BY name'))[0].map((x) => ({ id: x['id'], name: x['name'] }))
    : who.teams.map((x) => ({ id: x.id, name: x.name }));
  const types = (await pool.query<Row[]>('SELECT id, name FROM tkt_subcategory ORDER BY name'))[0].map((x) => ({ id: x['id'], name: x['name'] }));
  const agents = (await pool.query<Row[]>(
    `SELECT DISTINCT u.UserID AS id, u.UserName AS name FROM tkt_team_member m JOIN Users u ON u.UserID = m.user_id
     WHERE m.active = 1 AND u.UserStatus = 1 ${who.isAdmin ? '' : 'AND m.team_id IN (?)'} ORDER BY u.UserName`, who.isAdmin ? [] : [who.teams.length ? who.teams.map((t) => t.id) : [0]]))[0]
    .map((x) => ({ id: x['id'], name: x['name'] }));
  const raised = Number(t0['raised'] ?? 0);
  const done = Number(t0['resolved_n'] ?? 0) + Number(t0['closed_n'] ?? 0);
  const rows = (r: Row[]) => r.map((x) => ({ name: x['k'] as string, total: Number(x['n']), open: num(x['open_n']), done: num(x['done_n']), firstResponseMin: num(x['first_resp']) == null ? null : Math.round(Number(x['first_resp'])) }));

  return {
    from, to, teamId: q.teamId ?? null, teams, types, agents,
    totals: {
      raised, open: Number(t0['open_n'] ?? 0), resolved: Number(t0['resolved_n'] ?? 0), closed: Number(t0['closed_n'] ?? 0), spam: Number(t0['spam_n'] ?? 0),
      unassigned: Number(t0['unassigned_n'] ?? 0), triage: Number(t0['triage_n'] ?? 0),
      resolvedPercent: raised ? Math.round((done / raised) * 100) : 0,
      avgFirstResponseMin: num(t0['first_resp']) == null ? null : Math.round(Number(t0['first_resp'])),
      avgResolutionHours: num(t0['resolve_min']) == null ? null : Math.round((Number(t0['resolve_min']) / 60) * 10) / 10,
    },
    byStatus: byStatus.map((x) => ({ name: x['k'] as string, total: Number(x['n']) })),
    byPriority: byPriority.map((x) => ({ name: x['k'] as string, total: Number(x['n']) })),
    byTeam: rows(byTeam), byType: rows(byType), byAgent: rows(byAgent), byRequester: rows(byRequester),
    perDay: perDay.map((x) => ({ day: x['k'] as string, total: Number(x['n']) })),
    oldestOpen: oldest.map((x) => ({ key: x['ticket_key'], subject: x['subject'], status: x['status'], priority: x['priority'], team: x['team_name'] ?? null, assignee: x['assignee_name'] ?? null, ageHours: Number(x['age_h']) })),
  };
}
