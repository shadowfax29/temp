/**
 * People are stored the UVdesk way: a row in uv_user (name, email, password) and one in uv_user_instance (which UVdesk role they hold),
 * plus a row in user_access for what this tool adds (its own role, code sign-in, must-change-password).
 * Everything that creates, changes or checks a password goes through here.
 */
import argon2 from 'argon2';
import bcrypt from 'bcryptjs';
import type mysql from 'mysql2/promise';
import { pool } from '../../config/db';

type Row = mysql.RowDataPacket;
type Db = mysql.PoolConnection | typeof pool;

/** "Anita Rao" -> first "Anita", last "Rao"; one word is just a first name */
export function splitName(full: string): { first: string; last: string | null } {
  const parts = full.replace(/\s+/g, ' ').trim().split(' ');
  if (parts.length === 1) return { first: parts[0]!, last: null };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1]! };
}

/** The UVdesk role a tool role stands for (1 Account Owner, 2 Administrator, 3 Agent, 4 Customer) */
export async function uvRoleFor(roleId: number, db: Db = pool): Promise<number> {
  const [r] = await db.query<Row[]>('SELECT UserType, RoleName, RolePrivileges FROM AMRole WHERE RoleID = ?', [roleId]);
  const role = r[0];
  if (!role) return 4;
  if (role['UserType'] === 'SUPER_ADMIN') return 1;
  if (role['UserType'] === 'ADMIN') return 2;
  return /tkt_inbox/.test(String(role['RolePrivileges'] ?? '')) ? 3 : 4;
}

/** Checks a password against what is stored: the tool's own format (bcrypt) or UVdesk's (Argon2). `upgrade` says a UVdesk hash should be re-saved in the tool's format. */
export async function verifyPassword(plain: string, stored: string | null): Promise<{ ok: boolean; upgrade: boolean }> {
  if (!stored) return { ok: false, upgrade: false };
  try {
    if (stored.startsWith('$argon2')) return { ok: await argon2.verify(stored, plain), upgrade: true };
    return { ok: await bcrypt.compare(plain, stored), upgrade: false };
  } catch {
    return { ok: false, upgrade: false };
  }
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);

export interface NewPerson { name: string; email: string; roleId: number; passwordHash: string | null; active?: boolean; twoFactor?: number | null; mustChange?: boolean }

export async function createPerson(p: NewPerson, db: Db = pool): Promise<number> {
  const { first, last } = splitName(p.name);
  const [u] = await db.query<mysql.ResultSetHeader>(
    'INSERT INTO uv_user (email, password, first_name, last_name, is_enabled) VALUES (?,?,?,?,?)', [p.email, p.passwordHash, first, last, p.active === false ? 0 : 1]);
  await db.query('INSERT INTO uv_user_instance (user_id, source, created_at, updated_at, is_active, is_verified, supportRole_id) VALUES (?,?,NOW(),NOW(),?,1,?)',
    [u.insertId, 'website', p.active === false ? 0 : 1, await uvRoleFor(p.roleId, db)]);
  await db.query('INSERT INTO user_access (user_id, role_id, two_factor, must_change_password) VALUES (?,?,?,?)', [u.insertId, p.roleId, p.twoFactor ?? null, p.mustChange ? 1 : 0]);
  return u.insertId;
}

export async function updatePerson(userId: number, p: { name: string; email: string; roleId: number; active: boolean; twoFactor: number | null }, db: Db = pool) {
  const { first, last } = splitName(p.name);
  await db.query('UPDATE uv_user SET email = ?, first_name = ?, last_name = ?, is_enabled = ? WHERE id = ?', [p.email, first, last, p.active ? 1 : 0, userId]);
  const uvRole = await uvRoleFor(p.roleId, db);
  const [inst] = await db.query<Row[]>('SELECT id FROM uv_user_instance WHERE user_id = ? ORDER BY supportRole_id LIMIT 1', [userId]);
  if (inst[0]) await db.query('UPDATE uv_user_instance SET supportRole_id = ?, is_active = ?, updated_at = NOW() WHERE id = ?', [uvRole, p.active ? 1 : 0, inst[0]['id']]);
  else await db.query('INSERT INTO uv_user_instance (user_id, source, created_at, updated_at, is_active, is_verified, supportRole_id) VALUES (?,?,NOW(),NOW(),?,1,?)', [userId, 'website', p.active ? 1 : 0, uvRole]);
  await db.query(
    'INSERT INTO user_access (user_id, role_id, two_factor, must_change_password) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), two_factor = VALUES(two_factor)',
    [userId, p.roleId, p.twoFactor]);
}

export async function setPassword(userId: number, passwordHash: string, mustChange: boolean, db: Db = pool) {
  await db.query('UPDATE uv_user SET password = ? WHERE id = ?', [passwordHash, userId]);
  await db.query('UPDATE user_access SET must_change_password = ? WHERE user_id = ?', [mustChange ? 1 : 0, userId]);
}

/** Used by the end-to-end check to remove the people it made */
export async function deletePeopleByEmail(like: string, db: Db = pool) {
  await db.query('DELETE FROM uv_user WHERE email LIKE ?', [like]);
}
