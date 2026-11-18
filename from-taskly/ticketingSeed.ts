// Demo data for trying ticketing locally (safe to run twice): npx tsx src/scripts/ticketingSeed.ts
// Two categories with a form, one team each, using people from the database. Raise tickets in the app as any employee to see it work.
import type mysql from 'mysql2/promise';
import { pool } from '../config/db';
import * as cfg from '../modules/ticketing/ticketing.settings.service';

type Row = mysql.RowDataPacket;

async function userByName(name: string): Promise<number | null> {
  const [r] = await pool.query<Row[]>('SELECT UserID FROM Users WHERE UserName = ? AND UserStatus = 1 AND IsUserArchived = 0 LIMIT 1', [name]);
  return r[0] ? (r[0]['UserID'] as number) : null;
}

async function team(name: string, lead: string, members: [string, 'BASIC' | 'SENIOR'][]) {
  const [ex] = await pool.query<Row[]>('SELECT id FROM tkt_team WHERE name = ?', [name]);
  const leadId = await userByName(lead);
  const id = ex[0] ? (ex[0]['id'] as number) : (await cfg.saveTeam({ name, leadUserId: leadId })).id;
  const list: { userId: number; privilege: 'BASIC' | 'SENIOR' }[] = [];
  for (const [n, privilege] of members) { const u = await userByName(n); if (u) list.push({ userId: u, privilege }); }
  await cfg.setMembers(id, list);
  return id;
}

async function category(name: string, prefix: string, owner: string, teamId: number, subs: { name: string; fields: cfg.FieldInput[] }[]) {
  const [ex] = await pool.query<Row[]>('SELECT id FROM tkt_category WHERE prefix = ?', [prefix]);
  const ownerId = await userByName(owner);
  const id = ex[0] ? (ex[0]['id'] as number) : (await cfg.saveCategory({ name, prefix, ownerUserId: ownerId, defaultTeamId: teamId, teamIds: [teamId] })).id;
  for (const s of subs) {
    const [sx] = await pool.query<Row[]>('SELECT id FROM tkt_subcategory WHERE category_id = ? AND name = ?', [id, s.name]);
    const sid = sx[0] ? (sx[0]['id'] as number) : (await cfg.saveSubcategory(id, { name: s.name })).id;
    await cfg.setFields(sid, s.fields);
  }
}

(async () => {
  const display = await team('Display-Ad Operations', 'Nithin D', [['Kavya K N', 'SENIOR'], ['Samuel Joshua S', 'BASIC']]);
  await category('Ad Ops Requests', 'ADO', 'Nithin D', display, [
    { name: 'Tag Request', fields: [{ key: 'format', label: 'Ad format', type: 'SELECT', required: true, options: ['Video', 'Display', 'Native'] }, { key: 'domain', label: 'Publisher domain', type: 'TEXT' }] },
    { name: 'Optimization', fields: [{ key: 'ad_unit', label: 'Ad unit ID', type: 'TEXT' }] },
  ]);
  const it = await team('IT Support', 'Nithin D', [['Kavya K N', 'SENIOR']]);
  await category('IT Support', 'IT', 'Nithin D', it, [
    { name: 'Laptop / Hardware', fields: [] },
    { name: 'Access & Accounts', fields: [{ key: 'system', label: 'System', type: 'SELECT', required: true, options: ['GSuite', 'VPN', 'Taskly'] }] },
  ]);
  console.log('Demo categories "Ad Ops Requests" (ADO) and "IT Support" (IT) and their teams are in place.');
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
