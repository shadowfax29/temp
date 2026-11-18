/**
 * Changing tickets on the UVdesk tables. A ticket is uv_ticket; each message is a uv_thread row ('create' first, then 'reply' and 'note'); files are uv_ticket_attachments.
 * This tool's own records sit beside them: ticket_meta (first answer, resolved, closed, resolution note), tkt_event (the tamper-evident history) and tkt_period (who held it, for the timer).
 * A reply never changes the status; the team sets it by hand.
 */
import fs from 'fs';
import path from 'path';
import type mysql from 'mysql2/promise';
import { pool } from '../../config/db';
import { AppError } from '../../utils/AppError';
import { can } from '../access/access.service';
import { recordEvent, rollPeriod, type Actor } from './ticketing.service';
import { pathOf, removeFiles, type SavedFile } from './ticketing.files';
import { REOPEN_DAYS, UV_FILES_DIR, accessFor, type Access, type Priority, type Status } from './uvtickets.service';

type Row = mysql.RowDataPacket;
type Conn = mysql.PoolConnection;
export type { Actor };

const STATUSES: Status[] = ['OPEN', 'PENDING', 'ANSWERED', 'RESOLVED', 'CLOSED', 'SPAM'];
const PRIORITIES: Priority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

async function withTx<T>(fn: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); const out = await fn(conn); await conn.commit(); return out; }
  catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

/** UVdesk keeps messages as HTML, so what a person typed is escaped and its line breaks kept */
const toHtml = (s: string) => `<p>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim().replace(/\r?\n/g, '<br>')}</p>`;

async function statusId(conn: Conn, status: Status) { const [r] = await conn.query<Row[]>('SELECT id FROM uv_ticket_status WHERE code = ?', [status.toLowerCase()]); if (!r[0]) throw AppError.internal('Status missing'); return r[0]['id'] as number; }
async function priorityId(conn: Conn, p: Priority) { const [r] = await conn.query<Row[]>('SELECT id FROM uv_ticket_priority WHERE code = ?', [p.toLowerCase()]); if (!r[0]) throw AppError.internal('Priority missing'); return r[0]['id'] as number; }

/** The ticket row, locked for this change, with its status and priority in the tool's words */
async function lock(conn: Conn, key: string): Promise<Row> {
  const id = Number(key);
  if (!Number.isInteger(id) || id <= 0) throw AppError.notFound('That ticket does not exist.');
  const [r] = await conn.query<Row[]>('SELECT * FROM uv_ticket WHERE id = ? FOR UPDATE', [id]);
  if (!r[0]) throw AppError.notFound('That ticket does not exist.');
  const [s] = await conn.query<Row[]>('SELECT code FROM uv_ticket_status WHERE id = ?', [r[0]['status_id']]);
  return { ...r[0], status: String(s[0]?.['code'] ?? 'open').toUpperCase() };
}

const live = (t: Row) => t['status'] !== 'CLOSED' && t['status'] !== 'SPAM';
const touch = (conn: Conn, id: number, now: Date) => conn.query('UPDATE uv_ticket SET updated_at = ? WHERE id = ?', [now, id]);

async function addThread(conn: Conn, ticketId: number, userId: number, type: 'create' | 'reply' | 'note', by: 'agent' | 'customer', body: string, now: Date) {
  const [r] = await conn.query<mysql.ResultSetHeader>(
    `INSERT INTO uv_thread (ticket_id, user_id, source, thread_type, created_by, message, is_locked, is_bookmarked, created_at, updated_at) VALUES (?,?,'website',?,?,?,0,0,?,?)`, [ticketId, userId, type, by, toHtml(body), now, now]);
  return r.insertId;
}

/** Moves uploaded files into the attachments folder (the same layout UVdesk used) and records them against the message */
async function attach(conn: Conn, ticketId: number, threadId: number, files: SavedFile[]) {
  if (!files.length) return;
  const dir = path.join(UV_FILES_DIR, 'assets', 'threads', String(ticketId));
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const dest = path.join(dir, f.storedName);
    try { fs.renameSync(pathOf(f.storedName), dest); } catch { fs.copyFileSync(pathOf(f.storedName), dest); fs.rmSync(pathOf(f.storedName), { force: true }); }
    await conn.query('INSERT INTO uv_ticket_attachments (thread_id, name, path, content_type, size, file_system) VALUES (?,?,?,?,?,NULL)',
      [threadId, f.originalName, `/assets/threads/${ticketId}/${f.storedName}`, f.mime, f.size]);
  }
}

const meta = (conn: Conn, id: number, sets: string, params: unknown[]) =>
  conn.query(`INSERT INTO ticket_meta (ticket_id) VALUES (?) ON DUPLICATE KEY UPDATE ticket_id = ticket_id`, [id]).then(() => conn.query(`UPDATE ticket_meta SET ${sets} WHERE ticket_id = ?`, [...params, id]));

/** Records the new state: the history entry and the timer's period */
async function log(conn: Conn, t: Row, actor: Actor, now: Date, type: string, because: string, details: string, old?: unknown, next?: unknown, status?: Status) {
  await recordEvent(conn, t['id'], { type, actor, old, next, details, teamId: t['subGroup_id'] ?? null, userId: t['agent_id'] ?? null }, now);
  await rollPeriod(conn, { id: t['id'], teamId: t['subGroup_id'] ?? null, assigneeId: t['agent_id'] ?? null, status: status ?? (t['status'] as Status) }, now, because);
}

async function need(userId: number, t: Row, what: 'work' | 'lead' | 'member' | 'assigneeOrLead'): Promise<Access> {
  const a = await accessFor(userId, t);
  const ok = what === 'work' ? a.works : what === 'lead' ? a.rank >= 3 : what === 'member' ? a.rank >= 1 : a.rank >= 3 || t['agent_id'] === userId;
  if (!ok) throw AppError.forbidden('You cannot do that on this ticket.');
  return a;
}

// ── who gets a ticket by itself ────────────────────────────────────────────────────

/** The team's way of giving out tickets: nobody for Manual or Self-pick, else the right active member who is under their open-ticket limit */
async function pickAssignee(conn: Conn, teamId: number, typeId: number | null): Promise<number | null> {
  const [s] = await conn.query<Row[]>('SELECT assignment_method, max_open FROM team_settings WHERE team_id = ?', [teamId]);
  const method = (s[0]?.['assignment_method'] as string) ?? 'MANUAL';
  const limit = Number(s[0]?.['max_open'] ?? 8);
  if (method === 'MANUAL' || method === 'SELF_PICK') return null;
  const [people] = await conn.query<Row[]>(
    `SELECT DISTINCT u.UserID AS id, ms.skills, (SELECT COUNT(*) FROM uv_ticket x JOIN uv_ticket_status st ON st.id = x.status_id WHERE x.agent_id = u.UserID AND x.is_trashed = 0 AND st.code NOT IN ('resolved','closed','spam')) AS open_n
     FROM uv_user_support_teams ut JOIN uv_user_instance i ON i.id = ut.userInstanceId JOIN Users u ON u.UserID = i.user_id LEFT JOIN team_member_settings ms ON ms.team_id = ut.supportTeamId AND ms.user_id = u.UserID
     WHERE ut.supportTeamId = ? AND i.is_active = 1 AND u.UserStatus = 1 ORDER BY u.UserID`, [teamId]);
  let pool_ = people.filter((p) => Number(p['open_n']) < limit);
  if (!pool_.length) return null;
  if (method === 'SKILL' && typeId) {
    const [sk] = await conn.query<Row[]>('SELECT skill FROM type_settings WHERE type_id = ?', [typeId]);
    const want = String(sk[0]?.['skill'] ?? '').toLowerCase();
    const matching = want ? pool_.filter((p) => (p['skills'] ? (JSON.parse(p['skills']) as string[]) : []).some((x) => x.toLowerCase() === want)) : [];
    if (matching.length) pool_ = matching;
  }
  if (method === 'ROUND_ROBIN') {
    const [last] = await conn.query<Row[]>('SELECT agent_id FROM uv_ticket WHERE subGroup_id = ? AND agent_id IS NOT NULL ORDER BY id DESC LIMIT 1', [teamId]);
    const prev = last[0]?.['agent_id'] as number | undefined;
    return (pool_.find((p) => prev !== undefined && p['id'] > prev) ?? pool_[0])!['id'] as number;
  }
  return pool_.sort((a, b) => Number(a['open_n']) - Number(b['open_n']) || a['id'] - b['id'])[0]!['id'] as number;
}

async function assertMember(conn: Conn, teamId: number, userId: number) {
  const [m] = await conn.query<Row[]>(
    `SELECT 1 FROM uv_user_support_teams ut JOIN uv_user_instance i ON i.id = ut.userInstanceId JOIN Users u ON u.UserID = i.user_id WHERE ut.supportTeamId = ? AND u.UserID = ? AND i.is_active = 1 AND u.UserStatus = 1 LIMIT 1`, [teamId, userId]);
  if (!m[0]) throw AppError.badRequest('That person is not an active member of the team.');
}

// ── raising a ticket ───────────────────────────────────────────────────────────────

export interface NewTicket { subcategoryId?: number; categoryId?: number; subject: string; description: string; priority?: Priority; teamId?: number; assigneeId?: number }

export async function createTicket(input: NewTicket, actor: Actor, files: SavedFile[] = []) {
  const priority = input.priority ?? 'MEDIUM';
  if (!PRIORITIES.includes(priority)) throw AppError.badRequest('Invalid priority.');
  const typeId = input.subcategoryId ?? null;
  const key = await withTx(async (conn) => {
    if (typeId == null) throw AppError.badRequest('Choose a category.');
    const [ty] = await conn.query<Row[]>('SELECT 1 FROM uv_ticket_type WHERE id = ? AND is_active = 1', [typeId]);
    if (!ty[0]) throw AppError.badRequest('Choose a category.');
    let teamId: number | null = null;
    if (input.teamId != null) {
      const [tm] = await conn.query<Row[]>('SELECT 1 FROM uv_support_team WHERE id = ? AND is_active = 1', [input.teamId]);
      if (!tm[0]) throw AppError.badRequest('Choose a team.');
      teamId = input.teamId;
    }
    let agent: number | null = null;
    if (input.assigneeId != null) {
      if (teamId == null) throw AppError.badRequest('Choose a team before choosing a person.');
      if (!(await can(actor.userId, 'tkt_inbox', 'update'))) throw AppError.forbidden('Tickets you raise go to the team, which chooses who takes them.');
      await assertMember(conn, teamId, input.assigneeId);
      agent = input.assigneeId;
    } else if (teamId != null) agent = await pickAssignee(conn, teamId, typeId);

    const now = new Date();
    const [r] = await conn.query<mysql.ResultSetHeader>(
      `INSERT INTO uv_ticket (status_id, priority_id, type_id, customer_id, agent_id, group_id, subGroup_id, source, subject, is_new, is_replied, is_reply_enabled, is_starred, is_trashed, is_agent_viewed, is_customer_viewed, created_at, updated_at)
       VALUES (?,?,?,?,?,(SELECT id FROM uv_support_group ORDER BY id LIMIT 1),?, 'website',?,1,0,1,0,0,0,1,?,?)`,
      [await statusId(conn, 'OPEN'), await priorityId(conn, priority), typeId, actor.userId, agent, teamId, input.subject.trim(), now, now]);
    const id = r.insertId;
    const thread = await addThread(conn, id, actor.userId, 'create', 'customer', input.description, now);
    await attach(conn, id, thread, files);
    await conn.query('INSERT INTO ticket_meta (ticket_id) VALUES (?)', [id]);
    const t = { id, subGroup_id: teamId, agent_id: agent, status: 'OPEN' } as unknown as Row;
    await log(conn, t, actor, now, 'create', 'created', files.length ? `Raised on the web form (${files.length} file${files.length > 1 ? 's' : ''} attached)` : 'Raised on the web form', null, { teamId, assigneeId: agent });
    if (agent) await recordEvent(conn, id, { type: 'assign', actor: null, kind: 'RULE', details: input.assigneeId ? 'Chosen by the requester' : `Given out by the team's method`, userId: agent, teamId }, now);
    return String(id);
  }).catch(async (e) => { await removeFiles(files); throw e; });
  return { key };
}

// ── replies and notes ──────────────────────────────────────────────────────────────

export async function reply(key: string, actor: Actor, body: string, files: SavedFile[] = []) {
  await withTx(async (conn) => {
    const t = await lock(conn, key);
    const a = await accessFor(actor.userId, t);
    if (!a.isRequester && !a.works) throw AppError.forbidden('You cannot reply to this ticket.');
    if (!live(t)) throw AppError.badRequest('This ticket is closed. Raise a new ticket instead.');
    if (!a.works && t['status'] === 'RESOLVED' && Date.now() - new Date(t['updated_at']).getTime() > REOPEN_DAYS * 86_400_000) throw AppError.badRequest(`This ticket was resolved more than ${REOPEN_DAYS} days ago. Raise a new ticket instead.`);
    const now = new Date();
    const asAgent = a.works;
    const thread = await addThread(conn, t['id'], actor.userId, 'reply', asAgent ? 'agent' : 'customer', body, now);
    await attach(conn, t['id'], thread, files);
    if (asAgent) {
      await conn.query('UPDATE uv_ticket SET is_replied = 1, updated_at = ? WHERE id = ?', [now, t['id']]);
      const [m] = await conn.query<Row[]>('SELECT first_response_at FROM ticket_meta WHERE ticket_id = ?', [t['id']]);
      const [prior] = await conn.query<Row[]>(`SELECT 1 FROM uv_thread WHERE ticket_id = ? AND thread_type = 'reply' AND created_by = 'agent' AND id <> ? LIMIT 1`, [t['id'], thread]);
      if (!m[0]?.['first_response_at'] && !prior[0]) await meta(conn, t['id'], 'first_response_at = ?', [now]);
    } else await touch(conn, t['id'], now);
    await recordEvent(conn, t['id'], { type: 'reply', actor, details: files.length ? `${asAgent ? 'Public reply from the team' : 'Reply from the requester'} (${files.length} file${files.length > 1 ? 's' : ''} attached)` : asAgent ? 'Public reply from the team' : 'Reply from the requester' }, now);
  }).catch(async (e) => { await removeFiles(files); throw e; });
}

export async function addNote(key: string, actor: Actor, body: string, files: SavedFile[] = []) {
  await withTx(async (conn) => {
    const t = await lock(conn, key);
    await need(actor.userId, t, 'work');
    if (!live(t)) throw AppError.badRequest('This ticket is closed.');
    const now = new Date();
    const thread = await addThread(conn, t['id'], actor.userId, 'note', 'agent', body, now);
    await attach(conn, t['id'], thread, files);
    await touch(conn, t['id'], now);
    await recordEvent(conn, t['id'], { type: 'note', actor, details: files.length ? `Internal note added (${files.length} file${files.length > 1 ? 's' : ''} attached)` : 'Internal note added' }, now);
  }).catch(async (e) => { await removeFiles(files); throw e; });
}

// ── status, priority ───────────────────────────────────────────────────────────────

export async function changeStatus(key: string, actor: Actor, to: Status, text?: string) {
  if (!STATUSES.includes(to)) throw AppError.badRequest('Unknown status.');
  await withTx(async (conn) => {
    const t = await lock(conn, key);
    const a = await accessFor(actor.userId, t);
    const from = t['status'] as Status;
    const liveNow = from !== 'CLOSED' && from !== 'SPAM';
    const allowed = (to === 'CLOSED' ? a.rank >= 3 && liveNow : liveNow ? a.works : a.isAdmin && to === 'OPEN') && to !== from;
    if (!allowed) throw AppError.badRequest(`You cannot move this ticket from ${from} to ${to}.`);
    if (to === 'RESOLVED' && !text?.trim()) throw AppError.badRequest('Write a resolution note: the requester will read it.');
    const now = new Date();
    await conn.query('UPDATE uv_ticket SET status_id = ?, updated_at = ? WHERE id = ?', [await statusId(conn, to), now, t['id']]);
    if (to === 'RESOLVED') {
      await meta(conn, t['id'], 'resolved_at = ?, resolution_note = ?', [now, text!.trim()]);
      await addThread(conn, t['id'], actor.userId, 'reply', 'agent', `Resolved: ${text!.trim()}`, now);
    } else if (from === 'RESOLVED') await meta(conn, t['id'], 'resolved_at = NULL', []);
    if (to === 'CLOSED' || to === 'SPAM') await meta(conn, t['id'], 'closed_at = ?', [now]);
    await log(conn, t, actor, now, 'status', `status set to ${to}`, text?.trim() ? `${from} → ${to}: ${text.trim()}` : `${from} → ${to}`, { status: from }, { status: to }, to);
  });
}

export async function setPriority(key: string, actor: Actor, priority: Priority) {
  if (!PRIORITIES.includes(priority)) throw AppError.badRequest('Invalid priority.');
  await withTx(async (conn) => {
    const t = await lock(conn, key);
    await need(actor.userId, t, 'work');
    if (!live(t)) throw AppError.badRequest('This ticket is closed.');
    const [cur] = await conn.query<Row[]>('SELECT code FROM uv_ticket_priority WHERE id = ?', [t['priority_id']]);
    const from = String(cur[0]?.['code'] ?? 'low').toUpperCase();
    if (from === priority) return;
    const now = new Date();
    await conn.query('UPDATE uv_ticket SET priority_id = ?, updated_at = ? WHERE id = ?', [await priorityId(conn, priority), now, t['id']]);
    await recordEvent(conn, t['id'], { type: 'priority', actor, old: { priority: from }, next: { priority }, details: `${from} → ${priority}` }, now);
  });
}

export async function reopen(key: string, actor: Actor, reason?: string) {
  await withTx(async (conn) => {
    const t = await lock(conn, key);
    if (t['customer_id'] !== actor.userId) throw AppError.forbidden('Only the person who raised this ticket can reopen it.');
    const [m] = await conn.query<Row[]>('SELECT resolved_at FROM ticket_meta WHERE ticket_id = ?', [t['id']]);
    if (t['status'] !== 'RESOLVED' || Date.now() - new Date(m[0]?.['resolved_at'] ?? t['updated_at']).getTime() > REOPEN_DAYS * 86_400_000) throw AppError.badRequest(`Only a ticket resolved in the last ${REOPEN_DAYS} days can be reopened.`);
    const now = new Date();
    await conn.query('UPDATE uv_ticket SET status_id = ?, updated_at = ? WHERE id = ?', [await statusId(conn, 'OPEN'), now, t['id']]);
    await meta(conn, t['id'], 'resolved_at = NULL', []);
    if (reason?.trim()) await addThread(conn, t['id'], actor.userId, 'reply', 'customer', `Reopened: ${reason.trim()}`, now);
    await log(conn, t, actor, now, 'status', 'reopened by requester', reason?.trim() ? `Reopened: ${reason.trim()}` : 'Reopened by the requester', { status: 'RESOLVED' }, { status: 'OPEN' }, 'OPEN');
  });
}

// ── assigning and handing off ─────────────────────────────────────────────────────

async function addWatcher(conn: Conn, ticketId: number, userId: number | null) {
  if (userId) await conn.query('INSERT IGNORE INTO uv_tickets_collaborators (ticket_id, user_id) VALUES (?,?)', [ticketId, userId]);
}

export async function assign(key: string, actor: Actor, userId: number | null) {
  await withTx(async (conn) => {
    const t = await lock(conn, key);
    const a = await accessFor(actor.userId, t);
    if (!live(t)) throw AppError.badRequest('This ticket is closed.');
    if (!(a.rank >= 3 || (t['agent_id'] === actor.userId && userId !== null && a.rank >= 1))) throw AppError.forbidden('Only the team lead can assign this ticket, or the person who has it can hand it over.');
    if (userId !== null) { if (t['subGroup_id'] == null) throw AppError.badRequest('Choose the ticket\'s team first.'); await assertMember(conn, t['subGroup_id'], userId); }
    if (t['agent_id'] === userId) return;
    const now = new Date();
    const before = t['agent_id'] as number | null;
    await conn.query('UPDATE uv_ticket SET agent_id = ?, updated_at = ? WHERE id = ?', [userId, now, t['id']]);
    if (before && before !== actor.userId) await addWatcher(conn, t['id'], before);
    await log(conn, { ...t, agent_id: userId }, actor, now, 'assign', userId ? 'assigned' : 'unassigned', userId ? 'Assigned' : 'Unassigned', { assigneeId: before }, { assigneeId: userId });
  });
}

export async function take(key: string, actor: Actor) {
  await withTx(async (conn) => {
    const t = await lock(conn, key);
    const a = await accessFor(actor.userId, t);
    if (!live(t) || a.rank < 1 || t['subGroup_id'] == null) throw AppError.forbidden('You cannot take this ticket.');
    if (t['agent_id']) throw AppError.conflict('Someone already has this ticket.');
    const now = new Date();
    await conn.query('UPDATE uv_ticket SET agent_id = ?, updated_at = ? WHERE id = ?', [actor.userId, now, t['id']]);
    await log(conn, { ...t, agent_id: actor.userId }, actor, now, 'assign', 'taken', 'Taken by the agent', { assigneeId: null }, { assigneeId: actor.userId });
  });
}

/** Puts the ticket with a team and lets that team's way of giving out tickets choose a person */
async function moveToTeam(conn: Conn, t: Row, actor: Actor, teamId: number, type: 'route' | 'transfer', reason?: string) {
  const [tm] = await conn.query<Row[]>('SELECT name FROM uv_support_team WHERE id = ? AND is_active = 1', [teamId]);
  if (!tm[0]) throw AppError.badRequest('That team does not exist or is switched off.');
  if (t['subGroup_id'] === teamId) throw AppError.badRequest('It is already with that team.');
  const now = new Date();
  const before = t['agent_id'] as number | null;
  const next = await pickAssignee(conn, teamId, t['type_id'] ?? null);
  await conn.query('UPDATE uv_ticket SET subGroup_id = ?, agent_id = ?, updated_at = ? WHERE id = ?', [teamId, next, now, t['id']]);
  if (reason?.trim()) await addThread(conn, t['id'], actor.userId, 'note', 'agent', `Handed off to ${String(tm[0]['name']).trim()}: ${reason.trim()}`, now);
  if (type === 'transfer') await addWatcher(conn, t['id'], actor.userId);
  await log(conn, { ...t, subGroup_id: teamId, agent_id: next }, actor, now, type, type === 'transfer' ? 'transferred' : 'routed', reason?.trim() ? `To ${String(tm[0]['name']).trim()}: ${reason.trim()}` : `To ${String(tm[0]['name']).trim()}`, { teamId: t['subGroup_id'], assigneeId: before }, { teamId, assigneeId: next });
}

export async function route(key: string, actor: Actor, teamId: number) {
  await withTx(async (conn) => {
    const t = await lock(conn, key);
    await need(actor.userId, t, 'lead');
    if (!live(t)) throw AppError.badRequest('This ticket is closed.');
    await moveToTeam(conn, t, actor, teamId, 'route');
  });
}

export async function transfer(key: string, actor: Actor, teamId: number, reason: string) {
  await withTx(async (conn) => {
    const t = await lock(conn, key);
    await need(actor.userId, t, 'assigneeOrLead');
    if (!live(t)) throw AppError.badRequest('This ticket is closed.');
    if (t['subGroup_id'] == null) throw AppError.badRequest('Use "choose the team" for a ticket that has none.');
    await moveToTeam(conn, t, actor, teamId, 'transfer', reason);
  });
}

export async function recategorize(key: string, actor: Actor, input: { subcategoryId: number; reason: string }) {
  await withTx(async (conn) => {
    const t = await lock(conn, key);
    await need(actor.userId, t, 'assigneeOrLead');
    if (!live(t)) throw AppError.badRequest('This ticket is closed.');
    const [ty] = await conn.query<Row[]>('SELECT description FROM uv_ticket_type WHERE id = ? AND is_active = 1', [input.subcategoryId]);
    if (!ty[0]) throw AppError.badRequest('Choose a category.');
    if (t['type_id'] === input.subcategoryId) throw AppError.badRequest('It already has that category.');
    const now = new Date();
    await conn.query('UPDATE uv_ticket SET type_id = ?, updated_at = ? WHERE id = ?', [input.subcategoryId, now, t['id']]);
    await addThread(conn, t['id'], actor.userId, 'note', 'agent', `Category changed to ${String(ty[0]['description']).trim()}: ${input.reason.trim()}`, now);
    await recordEvent(conn, t['id'], { type: 'recategorize', actor, old: { typeId: t['type_id'] }, next: { typeId: input.subcategoryId }, details: `To ${String(ty[0]['description']).trim()}: ${input.reason.trim()}` }, now);
  });
}
