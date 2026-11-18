import type { Request } from 'express';
import type mysql from 'mysql2/promise';
import { pool } from '../../config/db';

type Row = mysql.RowDataPacket;

export type LoginEvent = 'PASSWORD_FAILED' | 'OTP_SENT' | 'OTP_FAILED' | 'LOGIN_OK' | 'LOGOUT' | 'LOCKED' | 'PASSWORD_CHANGED' | 'TEMP_PASSWORD';

/** One line in the sign-in log. Never throws: a log failure must not block a sign-in. */
export async function logLogin(req: Request, event: LoginEvent, email: string, userId: number | null, detail?: string) {
  try {
    await pool.query('INSERT INTO LoginLog (UserID, Email, Event, Detail, Ip, UserAgent) VALUES (?,?,?,?,?,?)',
      [userId, email.slice(0, 190), event, detail?.slice(0, 200) ?? null, (req.ip ?? '').slice(0, 64), String(req.headers['user-agent'] ?? '').slice(0, 255)]);
  } catch { /* ignore */ }
}

/** Wrong passwords for this email in the last `minutes` */
export async function recentFailures(email: string, minutes = 15): Promise<number> {
  const [r] = await pool.query<Row[]>(
    `SELECT COUNT(*) AS n FROM LoginLog WHERE Email = ? AND Event IN ('PASSWORD_FAILED','OTP_FAILED') AND CreatedAt > (NOW(3) - INTERVAL ? MINUTE)
       AND CreatedAt > COALESCE((SELECT MAX(CreatedAt) FROM LoginLog WHERE Email = ? AND Event = 'LOGIN_OK'), '1970-01-01')`, [email, minutes, email]);
  return Number(r[0]?.['n'] ?? 0);
}

export interface LogQuery { event?: string; email?: string; from?: string; to?: string; page?: number; size?: number }

export async function listLoginLogs(q: LogQuery) {
  const where: string[] = []; const params: unknown[] = [];
  if (q.event) { where.push('l.Event = ?'); params.push(q.event); }
  if (q.email?.trim()) { where.push('(l.Email LIKE ? OR u.UserName LIKE ?)'); params.push(`%${q.email.trim()}%`, `%${q.email.trim()}%`); }
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) { where.push('l.CreatedAt >= ?'); params.push(`${q.from} 00:00:00`); }
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) { where.push('l.CreatedAt <= ?'); params.push(`${q.to} 23:59:59`); }
  const size = Math.min(Math.max(q.size ?? 50, 1), 200), offset = (Math.max(q.page ?? 1, 1) - 1) * size;
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query<Row[]>(
    `SELECT l.*, u.UserName FROM LoginLog l LEFT JOIN Users u ON u.UserID = l.UserID ${w} ORDER BY l.LogID DESC LIMIT ? OFFSET ?`, [...params, size, offset]);
  const [cnt] = await pool.query<Row[]>(`SELECT COUNT(*) AS n FROM LoginLog l LEFT JOIN Users u ON u.UserID = l.UserID ${w}`, params);
  const [sum] = await pool.query<Row[]>(
    `SELECT SUM(Event='LOGIN_OK') AS ok, SUM(Event IN ('PASSWORD_FAILED','OTP_FAILED')) AS failed, SUM(Event='LOCKED') AS locked FROM LoginLog WHERE CreatedAt > (NOW() - INTERVAL 7 DAY)`);
  return {
    total: Number(cnt[0]?.['n'] ?? 0), page: Math.max(q.page ?? 1, 1), size,
    last7Days: { signedIn: Number(sum[0]?.['ok'] ?? 0), failed: Number(sum[0]?.['failed'] ?? 0), locked: Number(sum[0]?.['locked'] ?? 0) },
    logs: rows.map((r) => ({ id: r['LogID'], at: r['CreatedAt'], event: r['Event'], email: r['Email'], name: r['UserName'] ?? null, detail: r['Detail'] ?? null, ip: r['Ip'] ?? null, device: r['UserAgent'] ?? null })),
  };
}
