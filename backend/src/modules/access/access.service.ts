/**
 * Roles, users and the permission check. What a person may do is exactly what their role ticks.
 * A role with user type SUPER_ADMIN or ADMIN has everything, so nobody can lock the last admin out.
 */
import type mysql from 'mysql2/promise';
import { pool } from '../../config/db';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { cleanName } from '../../utils/names';
import { mailConfigured, sendMail } from '../../utils/mailer';
import { generateTempPassword } from '../../utils/password';
import { listTeamsLite, setUserLeads, setUserTeams, teamsByPerson } from '../ticketing/uvteams.service';
import { createPerson, hashPassword, setPassword, updatePerson } from './people.service';
import { FULL_ACCESS, normalize, type Action, type Privileges } from './catalog';

type Row = mysql.RowDataPacket;
const isAdminType = (t: unknown) => t === 'SUPER_ADMIN' || t === 'ADMIN';

const parse = (text: unknown): Privileges => {
  if (typeof text !== 'string' || !text) return {};
  try { return normalize(JSON.parse(text)); } catch { return {}; }
};

/** The privileges a signed-in user ends up with */
export async function privilegesOf(userId: number): Promise<Privileges> {
  const [r] = await pool.query<Row[]>(
    `SELECT r.UserType, r.RolePrivileges FROM Users u JOIN AMRole r ON r.RoleID = u.RoleID
     WHERE u.UserID = ? AND u.UserStatus = 1 AND u.IsUserArchived = 0 AND r.RoleStatus = 1`, [userId]);
  if (!r[0]) return {};
  return isAdminType(r[0]['UserType']) ? FULL_ACCESS : parse(r[0]['RolePrivileges']);
}

export async function can(userId: number, module: string, action: Action = 'read'): Promise<boolean> {
  return !!(await privilegesOf(userId))[module]?.includes(action);
}

// ── Roles ────────────────────────────────────────────────────────────────

export async function listRoles() {
  const [rows] = await pool.query<Row[]>(
    `SELECT r.*, (SELECT COUNT(*) FROM Users u WHERE u.RoleID = r.RoleID AND u.IsUserArchived = 0) AS userCount
     FROM AMRole r WHERE r.IsRoleArchived = 0 ORDER BY r.RoleID`);
  return rows.map((r) => ({
    roleId: r['RoleID'], roleName: r['RoleName'], description: r['RoleDescription'] ?? '', active: r['RoleStatus'] === 1,
    system: isAdminType(r['UserType']), userCount: Number(r['userCount']),
    privileges: isAdminType(r['UserType']) ? FULL_ACCESS : parse(r['RolePrivileges']),
  }));
}

export async function saveRole(input: { roleId?: number; roleName: string; description?: string; active?: boolean; privileges: unknown }) {
  const roleName = cleanName('role', input.roleName);
  const privs = JSON.stringify(normalize(input.privileges));
  try {
    if (input.roleId) {
      const [cur] = await pool.query<Row[]>('SELECT UserType FROM AMRole WHERE RoleID = ?', [input.roleId]);
      if (!cur[0]) throw AppError.notFound('Role not found.');
      if (isAdminType(cur[0]['UserType'])) throw AppError.badRequest('The Admin role always has everything and cannot be edited.');
      await pool.query('UPDATE AMRole SET RoleName = ?, RoleDescription = ?, RolePrivileges = ?, RoleStatus = ? WHERE RoleID = ?',
        [roleName, input.description?.trim() ?? null, privs, input.active === false ? 0 : 1, input.roleId]);
      return { roleId: input.roleId };
    }
    const [r] = await pool.query<mysql.ResultSetHeader>('INSERT INTO AMRole (RoleName, RoleDescription, RolePrivileges, RoleStatus) VALUES (?,?,?,?)',
      [roleName, input.description?.trim() ?? null, privs, input.active === false ? 0 : 1]);
    return { roleId: r.insertId };
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw AppError.conflict(`A role named "${roleName}" already exists.`);
    throw e;
  }
}

export async function deleteRole(roleId: number) {
  const [cur] = await pool.query<Row[]>('SELECT UserType, (SELECT COUNT(*) FROM Users u WHERE u.RoleID = r.RoleID) AS n FROM AMRole r WHERE RoleID = ?', [roleId]);
  if (!cur[0]) throw AppError.notFound('Role not found.');
  if (isAdminType(cur[0]['UserType'])) throw AppError.badRequest('The Admin role cannot be deleted.');
  if (Number(cur[0]['n']) > 0) throw AppError.conflict('People still have this role. Move them to another role first.');
  await pool.query('DELETE FROM AMRole WHERE RoleID = ?', [roleId]);
  return { deleted: true };
}

// ── Users ────────────────────────────────────────────────────────────────

/** Puts the person on exactly these teams (as Basic agents). Teams they lead keep them; a team that no longer lists them switches them off, so their history stays. */
export async function listUsers() {
  const [rows] = await pool.query<Row[]>(
    `SELECT u.UserID, u.UserName, u.UserEmail, u.UserStatus, u.RoleID, u.TwoFactor, u.MustChangePassword, (u.PasswordHash IS NOT NULL) AS HasPassword, r.RoleName FROM Users u JOIN AMRole r ON r.RoleID = u.RoleID
     WHERE u.IsUserArchived = 0 ORDER BY u.UserName`);
  const { teamsOf, leadOf } = await teamsByPerson();
  return rows.map((u) => ({ userId: u['UserID'], name: u['UserName'], email: u['UserEmail'], active: u['UserStatus'] === 1, roleId: u['RoleID'], roleName: u['RoleName'], hasPassword: Number(u['HasPassword']) === 1, mustChange: Number(u['MustChangePassword']) === 1, teams: teamsOf.get(u['UserID']) ?? [], leadOf: leadOf.get(u['UserID']) ?? [], twoFactor: u['TwoFactor'] === null ? null : u['TwoFactor'] === 1 }));
}

export interface SaveUserResult { userId: number; passwordSent: boolean; emailed: boolean; /** only in development when no mail server is set up, so the admin can pass it on */ tempPassword?: string }

/** The email that carries a temporary password */
async function sendTempPassword(name: string, email: string, password: string, why: 'new' | 'reset'): Promise<boolean> {
  const lines = [
    `Hello ${name},`, '',
    why === 'new' ? 'An account was created for you in the Ticketing Tool.' : 'Your password was reset by an admin.', '',
    `Sign in at: ${env.FRONTEND_URL}/login`, `Email: ${email}`, `Temporary password: ${password}`, '',
    'You will be asked to choose your own password right after you sign in. Do not share this email.',
  ];
  return sendMail(email, why === 'new' ? 'Your Ticketing Tool account' : 'Your password was reset', lines.join('\n'));
}

/**
 * Creates or updates a person. A new person gets a temporary password that is generated here and emailed to them; they must replace it at their first sign-in.
 * `resetPassword` does the same for someone who already exists (a forgotten password).
 */
export async function saveUser(input: { userId?: number; name: string; email: string; roleId: number; active?: boolean; resetPassword?: boolean; twoFactor?: boolean | null; teamIds?: number[]; leadTeamIds?: number[] }): Promise<SaveUserResult> {
  const tf = input.twoFactor === undefined || input.twoFactor === null ? null : input.twoFactor ? 1 : 0;
  const [role] = await pool.query<Row[]>('SELECT UserType FROM AMRole WHERE RoleID = ? AND IsRoleArchived = 0', [input.roleId]);
  if (!role[0]) throw AppError.badRequest('Choose a role.');
  const personName = cleanName('person', input.name);
  const email = input.email.trim().toLowerCase();
  const needsPassword = !input.userId || !!input.resetPassword;
  // Without a mail server the password could not reach the person: refuse in production, show it to the admin in development
  if (needsPassword && !mailConfigured() && env.NODE_ENV === 'production') throw AppError.badRequest('The mail server is not set up, so the temporary password cannot be sent. Ask your administrator to set it up.');
  const temp = needsPassword ? generateTempPassword() : null;
  const finish = async (userId: number): Promise<SaveUserResult> => {
    if (input.teamIds || input.leadTeamIds) {
      const leads = [...new Set(input.leadTeamIds ?? [])];
      await setUserLeads(userId, leads);
      await setUserTeams(userId, [...(input.teamIds ?? []), ...leads]);
    }
    if (!temp) return { userId, passwordSent: false, emailed: false };
    const emailed = await sendTempPassword(personName, email, temp, input.userId ? 'reset' : 'new');
    return { userId, passwordSent: true, emailed, ...(!emailed && env.NODE_ENV !== 'production' ? { tempPassword: temp } : {}) };
  };
  try {
    if (input.userId) {
      const [cur] = await pool.query<Row[]>('SELECT u.UserID, r.UserType FROM Users u JOIN AMRole r ON r.RoleID = u.RoleID WHERE u.UserID = ?', [input.userId]);
      if (!cur[0]) throw AppError.notFound('User not found.');
      // the last active admin cannot be demoted or switched off
      if (isAdminType(cur[0]['UserType']) && (!isAdminType(role[0]['UserType']) || input.active === false)) {
        const [n] = await pool.query<Row[]>(`SELECT COUNT(*) AS n FROM Users u JOIN AMRole r ON r.RoleID = u.RoleID WHERE r.UserType IN ('SUPER_ADMIN','ADMIN') AND u.UserStatus = 1 AND u.IsUserArchived = 0 AND u.UserID <> ?`, [input.userId]);
        if (Number(n[0]!['n']) === 0) throw AppError.badRequest('This is the last active admin. Make someone else an admin first.');
      }
      await updatePerson(input.userId, { name: personName, email, roleId: input.roleId, active: input.active !== false, twoFactor: tf });
      if (temp) await setPassword(input.userId, await hashPassword(temp), true);
      return finish(input.userId);
    }
    const id = await createPerson({ name: personName, email, roleId: input.roleId, passwordHash: await hashPassword(temp!), active: input.active !== false, twoFactor: tf, mustChange: true });
    return finish(id);
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw AppError.conflict('Someone with that email already exists.');
    throw e;
  }
}

// ── Two-step sign-in default ─────────────────────────────────────────────

export async function getTwoFactorDefault() {
  const [r] = await pool.query<Row[]>(`SELECT SettingValue FROM AppSetting WHERE SettingKey = 'twoFactorDefault'`);
  return { on: (r[0]?.['SettingValue'] ?? 'on') !== 'off' };
}
export async function setTwoFactorDefault(on: boolean) {
  await pool.query(`INSERT INTO AppSetting (SettingKey, SettingValue) VALUES ('twoFactorDefault', ?) ON DUPLICATE KEY UPDATE SettingValue = VALUES(SettingValue)`, [on ? 'on' : 'off']);
  return { on };
}

export { listTeamsLite };
