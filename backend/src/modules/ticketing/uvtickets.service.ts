/**
 * Reading tickets from the UVdesk tables: uv_ticket (the ticket), uv_thread (its messages), uv_ticket_attachments (files),
 * uv_support_team (the team = "sub group"), uv_ticket_type (the category), uv_ticket_status / uv_ticket_priority.
 * The ticket number is uv_ticket.id. A message is HTML in UVdesk; it is turned into plain text here, so nothing from an email can run in the browser.
 */
import path from 'path';
import { htmlToText } from 'html-to-text';
import type mysql from 'mysql2/promise';
import { pool } from '../../config/db';
import { AppError } from '../../utils/AppError';
import { can } from '../access/access.service';
import { kindOf, linkKind, readLink, signLink } from './ticketing.files';

type Row = mysql.RowDataPacket;

/** Where the copied UVdesk attachment folder lives: <this folder>/assets/threads/... (the database stores /assets/threads/...) */
export const UV_FILES_DIR = path.resolve(process.env['UVDESK_FILES_DIR'] || path.join(process.cwd(), 'public'));

export const REOPEN_DAYS = 7;
export type Status = 'OPEN' | 'PENDING' | 'ANSWERED' | 'RESOLVED' | 'CLOSED' | 'SPAM';
export type Priority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
export type InboxView = 'all' | 'new' | 'unassigned' | 'unanswered' | 'assigned' | 'triage' | 'pending' | 'answered' | 'resolved' | 'closed' | 'spam';
export interface ListQuery { status?: string; q?: string; page?: number; size?: number; teamId?: number; categoryId?: number; priority?: string }
export interface ReportQuery { from?: string; to?: string; teamId?: number; status?: string; priority?: string; typeId?: number; assigneeId?: number; unassigned?: boolean; q?: string }

const DONE = `('resolved','closed','spam')`;

const OPTIONS = { wordwrap: false as const, selectors: [{ selector: 'img', format: 'skip' }, { selector: 'a', options: { ignoreHref: false, hideLinkHrefIfSameAsText: true } }, { selector: 'style', format: 'skip' }, { selector: 'script', format: 'skip' }] };
const TAGLIKE = /<\/?(p|br|div|span|table|tr|td|ul|ol|li|a|b|i|u|strong|em|h[1-6]|blockquote|pre|font)\b/i;
/** UVdesk message HTML as plain text. Some messages were saved with their HTML escaped twice, so the text is converted again when tags are still showing. The result is only ever shown as text. */
const text = (html: unknown): string => {
  let out = htmlToText(String(html ?? ''), OPTIONS);
  if (TAGLIKE.test(out)) out = htmlToText(out, OPTIONS);
  return out.trim();
};

const isTicketAdmin = async (userId: number) => (await Promise.all([can(userId, 'tkt_teams', 'update'), can(userId, 'tkt_categories', 'update')])).every(Boolean);

// ── who the person is and which tickets they may see ────────────────────────────

export async function me(userId: number) {
  const [u] = await pool.query<Row[]>('SELECT UserName, UserEmail FROM Users WHERE UserID = ?', [userId]);
  const [teams] = await pool.query<Row[]>(
    `SELECT DISTINCT t.id, t.name FROM uv_user_support_teams ut JOIN uv_user_instance i ON i.id = ut.userInstanceId JOIN uv_support_team t ON t.id = ut.supportTeamId
     WHERE i.user_id = ? AND i.is_active = 1 AND t.is_active = 1 ORDER BY t.name`, [userId]);
  const isAdmin = await isTicketAdmin(userId);
  return {
    userId, name: u[0]?.['UserName'] ?? '', email: u[0]?.['UserEmail'] ?? '', isAdmin,
    teams: teams.map((t) => ({ id: t['id'] as number, name: t['name'] as string, privilege: 'ASSOCIATE', isLead: false })),
    away: false, ownedCategories: [] as { id: number; name: string; prefix: string }[],
    isAgent: isAdmin || teams.length > 0 || (await can(userId, 'tkt_inbox', 'read')),
  };
}

/** SQL that limits tickets to what this person may see as an agent: everything for an admin, else their teams' tickets and the ones assigned to them */
async function agentScope(userId: number): Promise<{ sql: string; params: unknown[] }> {
  const who = await me(userId);
  if (!who.isAgent) throw AppError.forbidden('You are not on a ticketing team yet.');
  if (who.isAdmin) return { sql: '1=1', params: [] };
  const ids = who.teams.map((t) => t.id);
  const watching = 'EXISTS (SELECT 1 FROM uv_tickets_collaborators c WHERE c.ticket_id = t.id AND c.user_id = ?)';
  return ids.length ? { sql: `(t.subGroup_id IN (?) OR t.agent_id = ? OR ${watching})`, params: [ids, userId, userId] } : { sql: `(t.agent_id = ? OR ${watching})`, params: [userId, userId] };
}

const LIST_SQL = `SELECT t.id, t.subject, t.created_at, t.updated_at, t.agent_id, t.customer_id, t.is_replied, t.subGroup_id, t.type_id, t.status_id,
    s.code AS status, p.code AS priority, ty.description AS type_name, tm.name AS team_name, cu.UserName AS requester_name, cu.UserEmail AS requester_email, ag.UserName AS assignee_name
  FROM uv_ticket t LEFT JOIN uv_ticket_status s ON s.id = t.status_id LEFT JOIN uv_ticket_priority p ON p.id = t.priority_id LEFT JOIN uv_ticket_type ty ON ty.id = t.type_id
  LEFT JOIN uv_support_team tm ON tm.id = t.subGroup_id LEFT JOIN Users cu ON cu.UserID = t.customer_id LEFT JOIN Users ag ON ag.UserID = t.agent_id`;

const row = (r: Row) => ({
  key: String(r['id']), subject: r['subject'] ?? '(no subject)', status: String(r['status'] ?? 'open').toUpperCase() as Status, priority: String(r['priority'] ?? 'low').toUpperCase() as Priority,
  category: r['type_name'] ?? 'No category', subcategory: 'General', team: r['team_name'] ?? null, requester: r['requester_name'] ?? null, requesterEmail: r['requester_email'] ?? null,
  assignee: r['assignee_name'] ?? null, assigneeId: r['agent_id'] ?? null, createdAt: r['created_at'], updatedAt: r['updated_at'],
});

function filters(q: ListQuery, params: unknown[]): string[] {
  const c: string[] = [];
  if (q.status) { c.push('s.code = ?'); params.push(q.status.toLowerCase()); }
  if (q.priority) { c.push('p.code = ?'); params.push(q.priority.toLowerCase()); }
  if (q.teamId) { c.push('t.subGroup_id = ?'); params.push(q.teamId); }
  if (q.categoryId) { c.push('t.type_id = ?'); params.push(q.categoryId); }
  if (q.q?.trim()) { c.push('(t.subject LIKE ? OR t.id = ?)'); params.push(`%${q.q.trim()}%`, Number(q.q.trim().replace(/^#/, '')) || 0); }
  return c;
}
const paging = (q: ListQuery) => { const size = Math.min(Math.max(q.size ?? 25, 1), 100); return { size, offset: (Math.max(q.page ?? 1, 1) - 1) * size }; };

/** Tickets I raised */
export async function listMine(userId: number, q: ListQuery) {
  const params: unknown[] = [userId];
  const where = ['t.customer_id = ?', 't.is_trashed = 0', ...filters(q, params)].join(' AND ');
  const { size, offset } = paging(q);
  const [rows] = await pool.query<Row[]>(`${LIST_SQL} WHERE ${where} ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?`, [...params, size, offset]);
  const [cnt] = await pool.query<Row[]>(`SELECT COUNT(*) AS n FROM uv_ticket t LEFT JOIN uv_ticket_status s ON s.id = t.status_id LEFT JOIN uv_ticket_priority p ON p.id = t.priority_id WHERE ${where}`, params);
  return { tickets: rows.map(row), total: Number(cnt[0]?.['n'] ?? 0), page: Math.max(q.page ?? 1, 1), size };
}

export async function listInbox(userId: number, view: InboxView, q: ListQuery) {
  const scope = await agentScope(userId);
  const views: Record<InboxView, { sql: string; params: unknown[] }> = {
    all: { sql: `s.code <> 'spam'`, params: [] },
    new: { sql: `s.code = 'open' AND t.is_replied = 0`, params: [] },
    unassigned: { sql: `t.agent_id IS NULL AND s.code NOT IN ${DONE}`, params: [] },
    unanswered: { sql: `s.code = 'open'`, params: [] },
    assigned: { sql: `t.agent_id = ? AND s.code NOT IN ${DONE}`, params: [userId] },
    triage: { sql: `t.subGroup_id IS NULL AND s.code NOT IN ${DONE}`, params: [] },
    pending: { sql: `s.code = 'pending'`, params: [] }, answered: { sql: `s.code = 'answered'`, params: [] }, resolved: { sql: `s.code = 'resolved'`, params: [] },
    closed: { sql: `s.code = 'closed'`, params: [] }, spam: { sql: `s.code = 'spam'`, params: [] },
  };
  const from = 'FROM uv_ticket t LEFT JOIN uv_ticket_status s ON s.id = t.status_id LEFT JOIN uv_ticket_priority p ON p.id = t.priority_id';
  const counts: Record<string, number> = {};
  // one pass for every count; the person's own id is a number, so it is safe to write into the SQL
  const sums = Object.entries(views).map(([k, v]) => 'SUM(' + v.sql.replace(/\?/g, String(Number(userId))) + ') AS `' + k + '`').join(', ');
  const [c] = await pool.query<Row[]>(`SELECT ${sums} ${from} WHERE ${scope.sql} AND t.is_trashed = 0`, scope.params);
  for (const k of Object.keys(views)) counts[k] = Number(c[0]?.[k] ?? 0);

  const v = views[view] ?? views.unanswered;
  const params: unknown[] = [...scope.params, ...v.params];
  const where = [scope.sql, 't.is_trashed = 0', v.sql, ...filters(q, params)].join(' AND ');
  const { size, offset } = paging(q);
  const [rows] = await pool.query<Row[]>(`${LIST_SQL} WHERE ${where} ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?`, [...params, size, offset]);
  const [cnt] = await pool.query<Row[]>(`SELECT COUNT(*) AS n ${from} WHERE ${where}`, params);
  return { tickets: rows.map(row), total: Number(cnt[0]?.['n'] ?? 0), page: Math.max(q.page ?? 1, 1), size, counts };
}

// ── one ticket ────────────────────────────────────────────────────────────────────

async function load(id: number) {
  const [r] = await pool.query<Row[]>(`${LIST_SQL} WHERE t.id = ?`, [id]);
  if (!r[0]) throw AppError.notFound('That ticket does not exist.');
  return r[0];
}

const RANK: Record<string, number> = { ASSOCIATE: 1, LEAD: 2, ADMIN: 3 };
export interface Access { userId: number; isRequester: boolean; isAdmin: boolean; isAgent: boolean; isWatcher: boolean; rank: number; works: boolean }

/** What this person is to this ticket: its requester, an admin, or a member of its team (rank 1 Associate, 2 Lead, 3 Admin). `works` = may answer it. */
export async function accessFor(userId: number, t: Row): Promise<Access> {
  const isRequester = t['customer_id'] === userId;
  const isAdmin = await isTicketAdmin(userId);
  let rank = isAdmin ? 3 : 0;
  const team = t['subGroup_id'] as number | null;
  if (!isAdmin && team != null) {
    const [m] = await pool.query<Row[]>('SELECT 1 FROM uv_user_support_teams ut JOIN uv_user_instance i ON i.id = ut.userInstanceId WHERE i.user_id = ? AND ut.supportTeamId = ? AND i.is_active = 1 LIMIT 1', [userId, team]);
    if (m[0]) {
      const [p] = await pool.query<Row[]>('SELECT privilege FROM team_member_settings WHERE team_id = ? AND user_id = ?', [team, userId]);
      rank = RANK[(p[0]?.['privilege'] as string) ?? 'ASSOCIATE'] ?? 1;
      const [l] = await pool.query<Row[]>('SELECT 1 FROM uv_lead_support_teams l JOIN uv_user_instance i ON i.id = l.leadUserInstanceId WHERE i.user_id = ? AND l.supportTeamId = ? LIMIT 1', [userId, team]);
      if (l[0]) rank = Math.max(rank, RANK['LEAD']!);
    }
  }
  const isAssignee = t['agent_id'] === userId;
  const [w] = await pool.query<Row[]>('SELECT 1 FROM uv_tickets_collaborators WHERE ticket_id = ? AND user_id = ?', [t['id'], userId]);
  return { userId, isRequester, isAdmin, rank, isAgent: rank > 0 || isAssignee, isWatcher: !!w[0], works: isAssignee || rank >= 2 };
}
const accessTo = accessFor;

const reopenable = (status: string, resolvedAt: unknown, updatedAt: unknown) =>
  status === 'RESOLVED' && Date.now() - new Date((resolvedAt ?? updatedAt) as string).getTime() <= REOPEN_DAYS * 86_400_000;

function transitionsFor(status: string, a: Access): { to: Status; needs?: 'resolution' }[] {
  const live = status !== 'CLOSED' && status !== 'SPAM';
  const out: { to: Status; needs?: 'resolution' }[] = [];
  if (a.works && live) {
    for (const to of ['OPEN', 'PENDING', 'ANSWERED'] as Status[]) if (to !== status) out.push({ to });
    if (status !== 'RESOLVED') out.push({ to: 'RESOLVED', needs: 'resolution' });
    out.push({ to: 'SPAM' });
  }
  if (a.rank >= 3 && live) out.push({ to: 'CLOSED' });
  if (a.isAdmin && !live) out.push({ to: 'OPEN' });
  return out;
}

export async function getTicket(key: string, userId: number) {
  const id = Number(key);
  if (!Number.isInteger(id) || id <= 0) throw AppError.notFound('That ticket does not exist.');
  const t = await load(id);
  const a = await accessFor(userId, t);
  if (!a.isRequester && !a.isAgent && !a.isWatcher) throw AppError.forbidden('You do not have access to this ticket.');
  const status = String(t['status'] ?? 'open').toUpperCase();
  const live = status !== 'CLOSED' && status !== 'SPAM';

  const [threads] = await pool.query<Row[]>(
    `SELECT h.id, h.thread_type, h.created_by, h.message, h.created_at, h.user_id, u.UserName FROM uv_thread h LEFT JOIN Users u ON u.UserID = h.user_id WHERE h.ticket_id = ? ORDER BY h.id`, [id]);
  const [atts] = await pool.query<Row[]>(
    `SELECT a.id, a.thread_id, a.name, a.size FROM uv_ticket_attachments a JOIN uv_thread h ON h.id = a.thread_id WHERE h.ticket_id = ? ORDER BY a.id`, [id]);
  const visible = threads.filter((h) => a.isAgent || (h['thread_type'] !== 'note' && h['thread_type'] !== 'forward'));
  const first = threads.find((h) => h['thread_type'] === 'create') ?? threads[0];
  const firstReply = threads.find((h) => h['thread_type'] === 'reply' && h['created_by'] === 'agent');
  const [meta] = await pool.query<Row[]>('SELECT * FROM ticket_meta WHERE ticket_id = ?', [id]);
  const m = meta[0];
  const [collab] = await pool.query<Row[]>('SELECT c.user_id, u.UserName FROM uv_tickets_collaborators c JOIN Users u ON u.UserID = c.user_id WHERE c.ticket_id = ?', [id]);
  const [tt] = await pool.query<Row[]>('SELECT subGroup_id, type_id FROM uv_ticket WHERE id = ?', [id]);
  const teamId = (tt[0]?.['subGroup_id'] as number | null) ?? null;
  const typeId = (tt[0]?.['type_id'] as number | null) ?? null;

  const isAssignee = t['agent_id'] === userId;
  const canManage = a.isAgent && live;
  let teamMembers: unknown[] = [], routeTeams: { id: number; name: string }[] = [], transferTeams: { id: number; name: string }[] = [];
  if (a.rank >= 2 || isAssignee) {
    const [mm] = teamId == null ? [[] as Row[]] : await pool.query<Row[]>(
      `SELECT DISTINCT u.UserID, u.UserName, COALESCE(s.privilege, 'ASSOCIATE') AS privilege, COALESCE(ts.max_open, 8) AS max_open,
         (SELECT COUNT(*) FROM uv_ticket x JOIN uv_ticket_status st ON st.id = x.status_id WHERE x.agent_id = u.UserID AND x.is_trashed = 0 AND st.code NOT IN ${DONE}) AS open_n
       FROM uv_user_support_teams ut JOIN uv_user_instance i ON i.id = ut.userInstanceId JOIN Users u ON u.UserID = i.user_id
       LEFT JOIN team_member_settings s ON s.team_id = ut.supportTeamId AND s.user_id = u.UserID LEFT JOIN team_settings ts ON ts.team_id = ut.supportTeamId
       WHERE ut.supportTeamId = ? AND i.is_active = 1 AND u.UserStatus = 1 ORDER BY u.UserName`, [teamId]);
    teamMembers = mm.map((x) => ({ userId: x['UserID'], name: x['UserName'], privilege: x['privilege'], open: Number(x['open_n']), limit: Number(x['max_open']) }));
  }
  if (a.rank >= 3 || isAssignee) {
    const [teams] = await pool.query<Row[]>('SELECT id, name FROM uv_support_team WHERE is_active = 1 ORDER BY name');
    routeTeams = teams.map((x) => ({ id: x['id'], name: String(x['name']).trim() }));
    transferTeams = routeTeams.filter((x) => x.id !== teamId);
  }
  const { timerOf } = await import('./ticketing.timer');
  const timer = await timerOf(id).then((tm) => (a.isAgent ? tm : { ...tm, laps: [] }));

  return {
    key: String(id), subject: t['subject'] ?? '(no subject)', description: text(first?.['message']),
    status: status as Status, priority: String(t['priority'] ?? 'low').toUpperCase() as Priority,
    category: { id: typeId ?? 0, name: t['type_name'] ?? 'No category' }, subcategory: { id: typeId ?? 0, name: 'General' },
    team: teamId != null ? { id: teamId, name: String(t['team_name'] ?? '').trim(), leadUserId: null } : null,
    requester: { id: t['customer_id'], name: t['requester_name'] ?? 'Unknown', email: t['requester_email'] ?? '', department: null, manager: null },
    assignee: t['agent_id'] ? { id: t['agent_id'], name: t['assignee_name'] ?? '' } : null,
    fields: [],
    messages: visible.map((h) => ({
      id: h['id'], kind: (h['thread_type'] === 'note' || h['thread_type'] === 'forward') ? 'NOTE' : 'REPLY', body: text(h['message']), at: h['created_at'],
      authorId: h['user_id'], author: h['UserName'] ?? 'Unknown',
      attachments: atts.filter((x) => x['thread_id'] === h['id']).map((x) => ({ id: x['id'], name: x['name'] ?? 'file', size: Number(x['size'] ?? 0), kind: kindOf(String(x['name'] ?? '')) })),
    })),
    createdAt: t['created_at'], updatedAt: t['updated_at'], firstResponseAt: m?.['first_response_at'] ?? firstReply?.['created_at'] ?? null,
    resolvedAt: m?.['resolved_at'] ?? null, closedAt: m?.['closed_at'] ?? null, resolutionNote: m?.['resolution_note'] ?? null,
    permissions: {
      isRequester: a.isRequester, isAgent: a.isAgent,
      canReply: live && (a.isRequester || a.works) && !(a.isRequester && !a.works && status === 'RESOLVED' && !reopenable(status, m?.['resolved_at'], t['updated_at'])),
      canNote: canManage && a.works, canReopen: a.isRequester && reopenable(status, m?.['resolved_at'], t['updated_at']),
      canSetPriority: canManage && a.works, canTake: canManage && !t['agent_id'] && a.rank >= 1,
      canAssign: canManage && a.rank >= 3, canHandOver: canManage && isAssignee && a.rank >= 1, canRoute: canManage && a.rank >= 3,
      canTransfer: canManage && (isAssignee || a.rank >= 3) && teamId != null, canRecategorize: canManage && (isAssignee || a.rank >= 3),
      transitions: transitionsFor(status, a),
    },
    teamMembers, routeTeams, transferTeams, watchers: collab.map((w) => ({ userId: w['user_id'], name: w['UserName'] })),
    timer, readOnly: false,
  };
}

/** What UVdesk logged for the ticket (agent_activity): who did what, and when */
export async function history(key: string, userId: number) {
  const id = Number(key);
  const t = await load(id);
  if (!(await accessFor(userId, t)).isAgent) throw AppError.forbidden('Only the handling team can see the history.');
  const { verifyChain } = await import('./ticketing.service');
  const [old] = await pool.query<Row[]>('SELECT id, agent_name, thread_type, created_at FROM agent_activity WHERE ticket_id = ? ORDER BY id', [id]);
  const [ev] = await pool.query<Row[]>(
    `SELECT e.id, e.event_type, e.actor_kind, e.old_value, e.new_value, e.details, e.created_at, u.UserName AS actor, iu.UserName AS imp
     FROM tkt_event e LEFT JOIN Users u ON u.UserID = e.actor_user_id LEFT JOIN Users iu ON iu.UserID = e.impersonated_by WHERE e.ticket_id = ? ORDER BY e.id`, [id]);
  const [pr] = await pool.query<Row[]>(
    `SELECT p.id, tm.name AS team, au.UserName AS assignee, p.status, p.started_at, p.ended_at, p.ended_because FROM tkt_period p
     LEFT JOIN uv_support_team tm ON tm.id = p.team_id LEFT JOIN Users au ON au.UserID = p.assignee_id WHERE p.ticket_id = ? ORDER BY p.id`, [id]);
  const chain = await verifyChain(id);
  const parse = (v: unknown) => { try { return v ? JSON.parse(String(v)) : null; } catch { return null; } };

  // For imported UVdesk tickets that have no tkt_period rows, synthesize a single period
  // from the UVdesk ticket itself so the "Who held it" table is not blank.
  let periods: { id: number; team: string | null; assignee: string | null; status: string; from: string; to: string | null; endedBecause: string | null }[];
  if (pr.length > 0) {
    periods = pr.map((p) => ({ id: p['id'], team: p['team'] ? String(p['team']).trim() : null, assignee: p['assignee'] ?? null, status: p['status'], from: p['started_at'], to: p['ended_at'], endedBecause: p['ended_because'] }));
  } else if (old.length > 0) {
    const [tk] = await pool.query<Row[]>(
      `SELECT t.created_at, t.updated_at, s.code AS status_code, tm.name AS team_name, au.UserName AS assignee_name
       FROM uv_ticket t
       LEFT JOIN uv_ticket_status s ON s.id = t.status_id
       LEFT JOIN uv_support_team tm ON tm.id = t.subGroup_id
       LEFT JOIN Users au ON au.UserID = t.agent_id
       WHERE t.id = ?`, [id]);
    const row = tk[0];
    const STATUS: Record<string, string> = { open: 'OPEN', pending: 'PENDING', answered: 'ANSWERED', resolved: 'RESOLVED', closed: 'CLOSED', spam: 'SPAM' };
    periods = row ? [{ id: 0, team: row['team_name'] ? String(row['team_name']).trim() : null, assignee: row['assignee_name'] ?? null, status: STATUS[String(row['status_code'] ?? '').toLowerCase()] ?? 'OPEN', from: row['created_at'], to: row['updated_at'], endedBecause: null }] : [];
  } else {
    periods = [];
  }

  return {
    imported: old.length > 0, chain,
    events: [
      ...old.map((r) => ({ id: -Number(r['id']), type: r['thread_type'] === 'note' ? 'note' : 'reply', kind: 'USER' as const, actor: r['agent_name'] ?? 'Agent', impersonatedBy: null, old: null, next: null, details: `UVdesk: ${r['thread_type'] ?? 'activity'}`, team: null, user: null, at: r['created_at'] })),
      ...ev.map((e) => ({ id: e['id'], type: e['event_type'], kind: e['actor_kind'], actor: e['actor'] ?? 'System', impersonatedBy: e['imp'] ?? null, old: parse(e['old_value']), next: parse(e['new_value']), details: e['details'], team: null, user: null, at: e['created_at'] })),
    ],
    periods,
  };
}

// ── files ──────────────────────────────────────────────────────────────────────────

async function attachmentFor(attachmentId: string, userId: number) {
  const [r] = await pool.query<Row[]>(
    `SELECT a.*, h.ticket_id, h.thread_type FROM uv_ticket_attachments a JOIN uv_thread h ON h.id = a.thread_id WHERE a.id = ?`, [attachmentId]);
  const a = r[0];
  if (!a) throw AppError.notFound('That file no longer exists.');
  const acc = await accessTo(userId, await load(a['ticket_id']));
  if (!acc.isRequester && !acc.isAgent && !acc.isWatcher) throw AppError.forbidden('You do not have access to this file.');
  if ((a['thread_type'] === 'note' || a['thread_type'] === 'forward') && !acc.isAgent) throw AppError.forbidden('You do not have access to this file.');
  return a;
}

export async function attachmentLink(key: string, attachmentId: string, userId: number) {
  const a = await attachmentFor(attachmentId, userId);
  if (String(a['ticket_id']) !== key) throw AppError.notFound('That file is not on this ticket.');
  return { url: `/api/ticketing/files/${signLink(a['id'], userId, 'uv')}`, name: (a['name'] ?? 'file') as string, kind: kindOf(String(a['name'] ?? '')), size: Number(a['size'] ?? 0) };
}

export async function attachmentByLink(token: string) {
  const { attachmentId, userId } = readLink(token);
  const a = await attachmentFor(attachmentId, userId);
  const rel = String(a['path'] ?? '').replace(/^\/+/, '');
  const full = path.resolve(UV_FILES_DIR, rel);
  // never leave the attachments folder, whatever the stored path says
  if (!rel || !full.startsWith(UV_FILES_DIR + path.sep)) throw AppError.notFound('The file path is not valid.');
  return { path: full, name: (a['name'] ?? 'file') as string, mime: (a['content_type'] as string | null) ?? 'application/octet-stream', kind: kindOf(String(a['name'] ?? '')), missingNote: 'This file has not been copied over from UVdesk yet.' };
}
export { linkKind };

export async function getTeamMembers(teamId: number) {
  const [mm] = await pool.query<Row[]>(
    `SELECT DISTINCT u.UserID, u.UserName, COALESCE(s.privilege, 'ASSOCIATE') AS privilege, COALESCE(ts.max_open, 8) AS max_open,
       (SELECT COUNT(*) FROM uv_ticket x JOIN uv_ticket_status st ON st.id = x.status_id WHERE x.agent_id = u.UserID AND x.is_trashed = 0 AND st.code NOT IN ${DONE}) AS open_n
     FROM uv_user_support_teams ut JOIN uv_user_instance i ON i.id = ut.userInstanceId JOIN Users u ON u.UserID = i.user_id
     LEFT JOIN team_member_settings s ON s.team_id = ut.supportTeamId AND s.user_id = u.UserID LEFT JOIN team_settings ts ON ts.team_id = ut.supportTeamId
     WHERE ut.supportTeamId = ? AND i.is_active = 1 AND u.UserStatus = 1 ORDER BY u.UserName`, [teamId]);
  return mm.map((x) => ({ userId: x['UserID'] as number, name: x['UserName'] as string, privilege: x['privilege'] as string, open: Number(x['open_n']), limit: Number(x['max_open']) }));
}

// ── report ─────────────────────────────────────────────────────────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function report(userId: number, q: ReportQuery) {
  const scope = await agentScope(userId);
  const to = q.to && DAY.test(q.to) ? q.to : new Date().toISOString().slice(0, 10);
  const from = q.from && DAY.test(q.from) ? q.from : new Date(Date.parse(to) - 29 * 86_400_000).toISOString().slice(0, 10);
  const params: unknown[] = [...scope.params, `${from} 00:00:00`, `${to} 23:59:59`];
  const conds = [scope.sql, 't.is_trashed = 0', 't.created_at >= ?', 't.created_at <= ?'];
  if (q.teamId) { conds.push('t.subGroup_id = ?'); params.push(q.teamId); }
  if (q.status) { conds.push('s.code = ?'); params.push(q.status.toLowerCase()); }
  if (q.priority) { conds.push('p.code = ?'); params.push(q.priority.toLowerCase()); }
  if (q.typeId) { conds.push('t.type_id = ?'); params.push(q.typeId); }
  if (q.assigneeId) { conds.push('t.agent_id = ?'); params.push(q.assigneeId); }
  if (q.unassigned) conds.push('t.agent_id IS NULL');
  if (q.q?.trim()) { conds.push('(t.subject LIKE ? OR t.id = ?)'); params.push(`%${q.q.trim()}%`, Number(q.q.trim().replace(/^#/, '')) || 0); }
  const where = conds.join(' AND ');
  const from_ = 'FROM uv_ticket t LEFT JOIN uv_ticket_status s ON s.id = t.status_id LEFT JOIN uv_ticket_priority p ON p.id = t.priority_id';
  const open = `s.code NOT IN ${DONE}`;
  const get = async (sql: string) => (await pool.query<Row[]>(sql, params))[0];
  const num = (v: unknown) => (v == null ? null : Number(v));

  const [tot] = await get(`SELECT COUNT(*) AS raised, SUM(${open}) AS open_n, SUM(s.code = 'resolved') AS resolved_n, SUM(s.code = 'closed') AS closed_n, SUM(s.code = 'spam') AS spam_n,
      SUM(t.agent_id IS NULL AND ${open}) AS unassigned_n, SUM(t.subGroup_id IS NULL AND ${open}) AS triage_n,
      AVG((SELECT TIMESTAMPDIFF(MINUTE, t.created_at, MIN(h.created_at)) FROM uv_thread h WHERE h.ticket_id = t.id AND h.thread_type = 'reply' AND h.created_by = 'agent')) AS first_resp
    ${from_} WHERE ${where}`) as [Row];
  const t0 = tot ?? {};
  const byStatus = await get(`SELECT UPPER(s.code) AS k, COUNT(*) AS n ${from_} WHERE ${where} GROUP BY s.code`);
  const byPriority = await get(`SELECT UPPER(p.code) AS k, COUNT(*) AS n ${from_} WHERE ${where} GROUP BY p.code`);
  const byTeam = await get(`SELECT COALESCE(tm.name, 'Triage (no team)') AS k, COUNT(*) AS n, SUM(${open}) AS open_n, SUM(s.code IN ('resolved','closed')) AS done_n
    ${from_} LEFT JOIN uv_support_team tm ON tm.id = t.subGroup_id WHERE ${where} GROUP BY tm.id, tm.name ORDER BY n DESC`);
  const byType = await get(`SELECT COALESCE(ty.description, 'No category') AS k, COUNT(*) AS n, SUM(${open}) AS open_n ${from_} LEFT JOIN uv_ticket_type ty ON ty.id = t.type_id WHERE ${where} GROUP BY ty.id, ty.description ORDER BY n DESC`);
  const byAgent = await get(`SELECT u.UserName AS k, COUNT(*) AS n, SUM(${open}) AS open_n, SUM(s.code IN ('resolved','closed')) AS done_n ${from_} JOIN Users u ON u.UserID = t.agent_id WHERE ${where} GROUP BY u.UserID, u.UserName ORDER BY n DESC LIMIT 20`);
  const byRequester = await get(`SELECT u.UserName AS k, COUNT(*) AS n ${from_} JOIN Users u ON u.UserID = t.customer_id WHERE ${where} GROUP BY u.UserID, u.UserName ORDER BY n DESC LIMIT 10`);
  const perDay = await get(`SELECT DATE_FORMAT(t.created_at, '%Y-%m-%d') AS k, COUNT(*) AS n ${from_} WHERE ${where} GROUP BY k ORDER BY k`);
  const oldest = await get(`SELECT t.id, t.subject, UPPER(s.code) AS status, UPPER(p.code) AS priority, tm.name AS team_name, au.UserName AS assignee_name, TIMESTAMPDIFF(HOUR, t.created_at, NOW()) AS age_h
    ${from_} LEFT JOIN uv_support_team tm ON tm.id = t.subGroup_id LEFT JOIN Users au ON au.UserID = t.agent_id WHERE ${where} AND ${open} ORDER BY t.created_at ASC LIMIT 10`);

  const who = await me(userId);
  const teams = who.isAdmin ? (await pool.query<Row[]>('SELECT id, name FROM uv_support_team WHERE is_active = 1 ORDER BY name'))[0].map((x) => ({ id: x['id'], name: x['name'] })) : who.teams.map((x) => ({ id: x.id, name: x.name }));
  const types = (await pool.query<Row[]>('SELECT id, description AS name FROM uv_ticket_type ORDER BY description'))[0].map((x) => ({ id: x['id'], name: x['name'] }));
  const agents = (await pool.query<Row[]>(`SELECT DISTINCT u.UserID AS id, u.UserName AS name FROM uv_ticket t JOIN Users u ON u.UserID = t.agent_id ORDER BY u.UserName`))[0].map((x) => ({ id: x['id'], name: x['name'] }));
  const raised = Number(t0['raised'] ?? 0);
  const done = Number(t0['resolved_n'] ?? 0) + Number(t0['closed_n'] ?? 0);
  const rows = (r: Row[]) => r.map((x) => ({ name: x['k'] as string, total: Number(x['n']), open: num(x['open_n']), done: num(x['done_n']), firstResponseMin: null as number | null }));

  return {
    from, to, teamId: q.teamId ?? null, teams, types, agents,
    totals: {
      raised, open: Number(t0['open_n'] ?? 0), resolved: Number(t0['resolved_n'] ?? 0), closed: Number(t0['closed_n'] ?? 0), spam: Number(t0['spam_n'] ?? 0),
      unassigned: Number(t0['unassigned_n'] ?? 0), triage: Number(t0['triage_n'] ?? 0), resolvedPercent: raised ? Math.round((done / raised) * 100) : 0,
      avgFirstResponseMin: num(t0['first_resp']) == null ? null : Math.round(Number(t0['first_resp'])), avgResolutionHours: null as number | null,
    },
    byStatus: byStatus.map((x) => ({ name: x['k'] as string, total: Number(x['n']) })), byPriority: byPriority.map((x) => ({ name: x['k'] as string, total: Number(x['n']) })),
    byTeam: rows(byTeam), byType: rows(byType), byAgent: rows(byAgent), byRequester: rows(byRequester),
    perDay: perDay.map((x) => ({ day: x['k'] as string, total: Number(x['n']) })),
    oldestOpen: oldest.map((x) => ({ key: String(x['id']), subject: x['subject'] ?? '(no subject)', status: x['status'], priority: x['priority'], team: x['team_name'] ?? null, assignee: x['assignee_name'] ?? null, ageHours: Number(x['age_h']) })),
  };
}

/** What the New ticket form offers: the active categories, and the active teams with their people */
export async function catalog(userId: number) {
  const [types] = await pool.query<Row[]>('SELECT id, description FROM uv_ticket_type WHERE is_active = 1 ORDER BY description');
  const [teams] = await pool.query<Row[]>('SELECT id, name FROM uv_support_team WHERE is_active = 1 ORDER BY name');
  const [people] = await pool.query<Row[]>(
    `SELECT DISTINCT ut.supportTeamId AS team_id, u.UserID, u.UserName FROM uv_user_support_teams ut JOIN uv_user_instance i ON i.id = ut.userInstanceId JOIN Users u ON u.UserID = i.user_id
     WHERE i.is_active = 1 AND u.UserStatus = 1 ORDER BY u.UserName`);
  return {
    chooseDepartment: true, chooseAssignee: await can(userId, 'tkt_inbox', 'update'),
    types: types.map((x) => ({ id: x['id'] as number, categoryId: 0, name: String(x['description']).trim(), fields: [] })),
    departments: teams.map((x) => ({ id: x['id'] as number, name: String(x['name']).trim(), members: people.filter((p) => p['team_id'] === x['id']).map((p) => ({ userId: p['UserID'] as number, name: p['UserName'] as string })) })),
  };
}
