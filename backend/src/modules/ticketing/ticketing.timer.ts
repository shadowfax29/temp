/**
 * The ticket timer, worked out from what is already recorded (who held the ticket in which status, and the events), so it can never drift.
 *   - It runs while the ticket has an owner and its status is Open or Answered.
 *   - It pauses on Pending (waiting for the requester) and stops on Resolved, Closed and Spam. Reopening starts it again.
 *   - Every reply, note, status change, reassignment, hand off or priority change ends a lap and starts the next one.
 *   - The consolidated time is the sum of the laps.
 */
import type mysql from 'mysql2/promise';
import { pool } from '../../config/db';

type Row = mysql.RowDataPacket;

export interface Lap { n: number; ownerId: number; owner: string; team: string | null; startedBy: string; endedBy: string | null; start: string; end: string | null; secs: number; running: boolean }
export interface Timer { totalSecs: number; running: boolean; since: string | null; laps: Lap[]; paused: boolean; note: string }

const RUNNING = new Set(['OPEN', 'ANSWERED']);
const LABEL: Record<string, string> = {
  reply: 'Reply sent', note: 'Note added', status: 'Status changed', assign: 'Reassigned', transfer: 'Handed off', recategorize: 'Ticket type changed', priority: 'Priority changed',
};
const LAP_EVENTS = Object.keys(LABEL);

/**
 * Tickets that came from UVdesk have no hand-over records, only their messages. The time is worked out from those:
 * from when the ticket was raised to when it was closed (or now, if it is still open), split at every message.
 * Each lap belongs to the person whose message ended it, so you can see who answered after how long.
 */
async function importedTimer(ticketId: number | string, now: Date): Promise<Timer> {
  const [[t]] = await pool.query<Row[]>(
    `SELECT t.created_at, t.updated_at, s.code AS status, m.closed_at, m.resolved_at
     FROM uv_ticket t JOIN uv_ticket_status s ON s.id = t.status_id LEFT JOIN ticket_meta m ON m.ticket_id = t.id WHERE t.id = ?`, [ticketId]) as unknown as [Row[]];
  if (!t) return { totalSecs: 0, running: false, since: null, laps: [], paused: false, note: '' };
  const [msgs] = await pool.query<Row[]>(
    `SELECT th.created_at, th.thread_type, th.created_by, th.user_id, u.UserName AS name
     FROM uv_thread th LEFT JOIN Users u ON u.UserID = th.user_id WHERE th.ticket_id = ? AND th.thread_type IN ('create','reply','note') ORDER BY th.id`, [ticketId]);
  const status = String(t['status']).toUpperCase();
  const done = ['RESOLVED', 'CLOSED', 'SPAM'].includes(status);
  const from = new Date(t['created_at']).getTime();
  const end = done ? new Date(t['closed_at'] ?? t['resolved_at'] ?? t['updated_at']).getTime() : now.getTime();
  const staff = msgs.filter((m) => m['created_by'] === 'agent' && m['thread_type'] !== 'create');
  const laps: Lap[] = [];
  let cursor = from, startedBy = 'Ticket raised';
  for (const m of staff) {
    const at = Math.min(new Date(m['created_at']).getTime(), end);
    if (at < cursor) continue;
    laps.push({ n: laps.length + 1, ownerId: Number(m['user_id']), owner: m['name'] ?? 'Unknown', team: null, startedBy, endedBy: m['thread_type'] === 'note' ? 'Note added' : 'Reply sent',
      start: new Date(cursor).toISOString(), end: new Date(at).toISOString(), secs: Math.round((at - cursor) / 1000), running: false });
    cursor = at; startedBy = m['thread_type'] === 'note' ? 'Note added' : 'Reply sent';
  }
  if (end > cursor || !laps.length) {
    const last = staff[staff.length - 1];
    const open = !done;
    laps.push({ n: laps.length + 1, ownerId: Number(last?.['user_id'] ?? 0), owner: last?.['name'] ?? 'Not answered', team: null, startedBy, endedBy: open ? null : status === 'CLOSED' ? 'Closed' : status === 'RESOLVED' ? 'Resolved' : 'Marked spam',
      start: new Date(cursor).toISOString(), end: open ? null : new Date(end).toISOString(), secs: Math.max(0, Math.round((end - cursor) / 1000)), running: open });
  }
  return {
    totalSecs: laps.reduce((n, l) => n + l.secs, 0), running: !done, since: done ? null : new Date(from).toISOString(), laps, paused: false,
    note: done ? 'Time from when the ticket was raised to when it was closed. Worked out from its messages (imported from UVdesk).' : 'Time since the ticket was raised, worked out from its messages (imported from UVdesk).',
  };
}

export async function timerOf(ticketId: number | string, now = new Date()): Promise<Timer> {
  const [periods] = await pool.query<Row[]>(
    `SELECT p.team_id, p.assignee_id, p.status, p.started_at, p.ended_at, p.ended_because, u.UserName AS owner, tm.name AS team
     FROM tkt_period p LEFT JOIN Users u ON u.UserID = p.assignee_id LEFT JOIN uv_support_team tm ON tm.id = p.team_id WHERE p.ticket_id = ? ORDER BY p.id`, [ticketId]);
  const [events] = await pool.query<Row[]>(
    `SELECT event_type, created_at FROM tkt_event WHERE ticket_id = ? AND event_type IN (${LAP_EVENTS.map(() => '?').join(',')}) ORDER BY id`, [ticketId, ...LAP_EVENTS]);
  if (!periods.length) return importedTimer(ticketId, now);
  const marks = events.map((e) => ({ at: new Date(e['created_at']).getTime(), label: LABEL[e['event_type'] as string] ?? 'Updated' }));

  const laps: Lap[] = [];
  let lastStartLabel = 'Assigned';
  for (const p of periods) {
    const from = new Date(p['started_at']).getTime();
    const to = p['ended_at'] ? new Date(p['ended_at']).getTime() : now.getTime();
    const starter = marks.filter((m) => m.at === from).map((m) => m.label).pop();
    if (!(p['assignee_id'] && RUNNING.has(p['status']))) { lastStartLabel = starter ?? lastStartLabel; continue; }
    // lap boundaries inside this period
    const inside = marks.filter((m) => m.at > from && m.at < to);
    const cuts = [from, ...inside.map((m) => m.at), to];
    for (let i = 0; i < cuts.length - 1; i++) {
      const s = cuts[i]!, e = cuts[i + 1]!;
      const last = i === cuts.length - 2;
      const open = last && !p['ended_at'];
      const endMark = last ? marks.filter((m) => m.at === e).map((m) => m.label).pop() ?? (p['ended_because'] as string | null) ?? null : inside[i]!.label;
      laps.push({
        n: laps.length + 1, ownerId: p['assignee_id'], owner: p['owner'] ?? 'Unknown', team: p['team'] ?? null,
        startedBy: i === 0 ? (starter ?? (laps.length ? lastStartLabel : 'Assigned')) : inside[i - 1]!.label,
        endedBy: open ? null : endMark, start: new Date(s).toISOString(), end: open ? null : new Date(e).toISOString(),
        secs: Math.max(0, Math.round((e - s) / 1000)), running: open,
      });
    }
    lastStartLabel = starter ?? lastStartLabel;
  }
  const cur = periods[periods.length - 1];
  const running = laps.some((l) => l.running);
  const paused = !!cur && !cur['ended_at'] && cur['status'] === 'PENDING' && !!cur['assignee_id'];
  const done = !!cur && ['RESOLVED', 'CLOSED', 'SPAM'].includes(cur['status']);
  return {
    totalSecs: laps.reduce((n, l) => n + l.secs, 0), running, since: laps.find((l) => l.running)?.start ?? null, laps, paused,
    note: !laps.length ? 'The timer starts when the ticket is assigned.' : running ? 'Running.' : paused ? 'Paused while waiting for the requester (Pending).' : done ? 'Stopped. The total is final unless the ticket is reopened.' : 'Not running.',
  };
}
