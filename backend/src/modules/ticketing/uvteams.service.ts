/**
 * Teams on the UVdesk tables: uv_support_team (the team), uv_user_support_teams (who is in it, through the person's instance) and uv_lead_support_teams (its lead).
 * The way a team gives out tickets, its open-ticket limit and each member's privilege and skills are kept in team_settings and team_member_settings.
 */
import type mysql from 'mysql2/promise';
import { pool } from '../../config/db';
import { AppError } from '../../utils/AppError';
import { cleanName } from '../../utils/names';

type Row = mysql.RowDataPacket;
type Db = mysql.PoolConnection | typeof pool;

export const PRIVILEGES = ['ASSOCIATE', 'LEAD', 'ADMIN'] as const;
export const METHODS = ['MANUAL', 'ROUND_ROBIN', 'LEAST_OPEN', 'SKILL', 'SELF_PICK'] as const;
const DONE = `('resolved','closed','spam')`;

/** The instance a team membership hangs on: the person's agent or admin one first, then any active one */
async function instanceOf(userId: number, db: Db = pool): Promise<number> {
  const [r] = await db.query<Row[]>('SELECT id FROM uv_user_instance WHERE user_id = ? ORDER BY (supportRole_id IN (1, 2, 3)) DESC, is_active DESC, id LIMIT 1', [userId]);
  if (!r[0]) throw AppError.badRequest('That person has no account in the tool yet.');
  return r[0]['id'] as number;
}

export async function listTeams() {
  const [teams] = await pool.query<Row[]>(
    `SELECT t.id, t.name, t.is_active, COALESCE(s.assignment_method, 'MANUAL') AS method, COALESCE(s.max_open, 8) AS max_open,
       (SELECT COUNT(*) FROM uv_ticket x JOIN uv_ticket_status st ON st.id = x.status_id WHERE x.subGroup_id = t.id AND x.is_trashed = 0 AND st.code NOT IN ${DONE}) AS open_n
     FROM uv_support_team t LEFT JOIN team_settings s ON s.team_id = t.id ORDER BY t.name`);
  const [members] = await pool.query<Row[]>(
    `SELECT DISTINCT ut.supportTeamId AS team_id, u.UserID, u.UserName, u.UserEmail, u.UserStatus, i.is_active
     FROM uv_user_support_teams ut JOIN uv_user_instance i ON i.id = ut.userInstanceId JOIN Users u ON u.UserID = i.user_id ORDER BY u.UserName`);
  const [leads] = await pool.query<Row[]>('SELECT l.supportTeamId AS team_id, i.user_id FROM uv_lead_support_teams l JOIN uv_user_instance i ON i.id = l.leadUserInstanceId');
  const [settings] = await pool.query<Row[]>('SELECT team_id, user_id, privilege, skills FROM team_member_settings');
  const [work] = await pool.query<Row[]>(
    `SELECT x.subGroup_id AS team_id, x.agent_id, COUNT(*) AS n FROM uv_ticket x JOIN uv_ticket_status st ON st.id = x.status_id
     WHERE x.agent_id IS NOT NULL AND x.is_trashed = 0 AND st.code NOT IN ${DONE} GROUP BY x.subGroup_id, x.agent_id`);

  return teams.map((t) => {
    const lead = leads.find((l) => l['team_id'] === t['id'])?.['user_id'] as number | undefined;
    const seen = new Set<number>();
    const list = members.filter((m) => m['team_id'] === t['id'] && !seen.has(m['UserID']) && seen.add(m['UserID'])).map((m) => {
      const set = settings.find((x) => x['team_id'] === t['id'] && x['user_id'] === m['UserID']);
      return {
        userId: m['UserID'] as number, name: m['UserName'] as string, email: m['UserEmail'] as string,
        privilege: (m['UserID'] === lead ? 'LEAD' : set?.['privilege'] ?? 'ASSOCIATE') as string, active: Number(m['is_active']) === 1 && Number(m['UserStatus']) === 1,
        open: Number(work.find((w) => w['team_id'] === t['id'] && w['agent_id'] === m['UserID'])?.['n'] ?? 0), away: false,
        skills: set?.['skills'] ? (JSON.parse(set['skills']) as string[]) : [], source: 'MANUAL' as const, excluded: false,
      };
    });
    const leadName = list.find((m) => m.userId === lead)?.name ?? null;
    return {
      id: t['id'] as number, name: t['name'] as string, leadUserId: lead ?? null, leadName, assignmentMethod: t['method'] as string, maxOpen: Number(t['max_open']),
      active: Number(t['is_active']) === 1, openTickets: Number(t['open_n']), categories: [] as { id: number; name: string }[], members: list,
    };
  });
}

export interface TeamInput { name: string; assignmentMethod?: string; maxOpen?: number; active?: boolean }

export async function saveTeam(input: TeamInput, id?: number) {
  const method = input.assignmentMethod ?? 'MANUAL';
  if (!(METHODS as readonly string[]).includes(method)) throw AppError.badRequest(`Pick one of the ways of giving out tickets: ${METHODS.join(', ')}.`);
  let name = input.name.replace(/\s+/g, ' ').trim();
  if (id) {
    // a team that came from UVdesk keeps its name as it is; only a changed name is held to the naming rules
    const [cur] = await pool.query<Row[]>('SELECT name FROM uv_support_team WHERE id = ?', [id]);
    if (!cur[0]) throw AppError.notFound('Team not found.');
    if (String(cur[0]['name']).replace(/\s+/g, ' ').trim() !== name) name = cleanName('team', input.name);
  } else name = cleanName('team', input.name);
  const [dup] = await pool.query<Row[]>('SELECT id FROM uv_support_team WHERE TRIM(name) = ? AND id <> ?', [name, id ?? 0]);
  if (dup[0]) throw AppError.conflict(`A team named "${name}" already exists.`);
  const maxOpen = Math.min(Math.max(Number(input.maxOpen ?? 8) || 8, 1), 500);
  let teamId = id ?? 0;
  if (id) await pool.query('UPDATE uv_support_team SET name = ?, is_active = ? WHERE id = ?', [name, input.active === false ? 0 : 1, id]);
  else { const [r] = await pool.query<mysql.ResultSetHeader>('INSERT INTO uv_support_team (name, description, created_at, is_active) VALUES (?,?,NOW(),?)', [name, name, input.active === false ? 0 : 1]); teamId = r.insertId; }
  await pool.query('INSERT INTO team_settings (team_id, assignment_method, max_open) VALUES (?,?,?) ON DUPLICATE KEY UPDATE assignment_method = VALUES(assignment_method), max_open = VALUES(max_open)', [teamId, method, maxOpen]);
  return { id: teamId };
}

export async function deleteTeam(id: number) {
  const [t] = await pool.query<Row[]>('SELECT name FROM uv_support_team WHERE id = ?', [id]);
  if (!t[0]) throw AppError.notFound('Team not found.');
  const [n] = await pool.query<Row[]>('SELECT COUNT(*) AS n FROM uv_ticket WHERE subGroup_id = ?', [id]);
  if (Number(n[0]!['n']) > 0) throw AppError.conflict(`"${t[0]['name']}" has ${n[0]!['n']} ticket(s), so it cannot be deleted. Switch it to Inactive to stop using it.`);
  await pool.query('DELETE FROM uv_support_team WHERE id = ?', [id]);
  return { deleted: true };
}

export interface MemberInput { userId: number; privilege: string; active?: boolean; skills?: string[] }

/** Saves exactly the members the admin sees. The lead always stays a member. */
export async function setMembers(teamId: number, members: MemberInput[]) {
  const [t] = await pool.query<Row[]>('SELECT 1 FROM uv_support_team WHERE id = ?', [teamId]);
  if (!t[0]) throw AppError.notFound('Team not found.');
  const [lead] = await pool.query<Row[]>('SELECT i.user_id FROM uv_lead_support_teams l JOIN uv_user_instance i ON i.id = l.leadUserInstanceId WHERE l.supportTeamId = ?', [teamId]);
  const keep = new Map<number, MemberInput>();
  for (const m of members) if (m.active !== false) keep.set(m.userId, m);
  for (const l of lead) if (!keep.has(l['user_id'])) keep.set(l['user_id'], { userId: l['user_id'], privilege: 'LEAD' });

  const ids = [...keep.keys()];
  if (ids.length) {
    const [ok] = await pool.query<Row[]>('SELECT UserID FROM Users WHERE UserID IN (?) AND UserStatus = 1', [ids]);
    if (ok.length !== ids.length) throw AppError.badRequest('One of the chosen people cannot be added: they are switched off or have no access.');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // everyone not listed leaves the team (through every instance they hold)
    if (ids.length) await conn.query('DELETE ut FROM uv_user_support_teams ut JOIN uv_user_instance i ON i.id = ut.userInstanceId WHERE ut.supportTeamId = ? AND i.user_id NOT IN (?)', [teamId, ids]);
    else await conn.query('DELETE FROM uv_user_support_teams WHERE supportTeamId = ?', [teamId]);
    await conn.query('DELETE FROM team_member_settings WHERE team_id = ?' + (ids.length ? ' AND user_id NOT IN (?)' : ''), ids.length ? [teamId, ids] : [teamId]);
    for (const m of keep.values()) {
      const [has] = await conn.query<Row[]>('SELECT 1 FROM uv_user_support_teams ut JOIN uv_user_instance i ON i.id = ut.userInstanceId WHERE ut.supportTeamId = ? AND i.user_id = ? LIMIT 1', [teamId, m.userId]);
      if (!has[0]) await conn.query('INSERT IGNORE INTO uv_user_support_teams (userInstanceId, supportTeamId) VALUES (?,?)', [await instanceOf(m.userId, conn), teamId]);
      const priv = (PRIVILEGES as readonly string[]).includes(m.privilege) && m.privilege !== 'LEAD' ? m.privilege : 'ASSOCIATE';
      const skills = m.skills?.length ? JSON.stringify(m.skills.map((x) => x.trim()).filter(Boolean)) : null;
      await conn.query('INSERT INTO team_member_settings (team_id, user_id, privilege, skills) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE privilege = VALUES(privilege), skills = VALUES(skills)', [teamId, m.userId, priv, skills]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

// ── used by the Users screen ────────────────────────────────────────────────

export async function listTeamsLite() {
  const [rows] = await pool.query<Row[]>('SELECT id, name FROM uv_support_team WHERE is_active = 1 ORDER BY name');
  return rows.map((r) => ({ id: r['id'] as number, name: r['name'] as string }));
}

/** Every person's teams and the teams they lead, for the Users list */
export async function teamsByPerson() {
  const [tm] = await pool.query<Row[]>(
    `SELECT DISTINCT i.user_id, t.id, t.name FROM uv_user_support_teams ut JOIN uv_user_instance i ON i.id = ut.userInstanceId JOIN uv_support_team t ON t.id = ut.supportTeamId WHERE t.is_active = 1 ORDER BY t.name`);
  const [ld] = await pool.query<Row[]>('SELECT i.user_id, l.supportTeamId AS id FROM uv_lead_support_teams l JOIN uv_user_instance i ON i.id = l.leadUserInstanceId');
  const teamsOf = new Map<number, { id: number; name: string }[]>();
  for (const r of tm) { const l = teamsOf.get(r['user_id']) ?? []; l.push({ id: r['id'], name: r['name'] }); teamsOf.set(r['user_id'], l); }
  const leadOf = new Map<number, number[]>();
  for (const r of ld) { const l = leadOf.get(r['user_id']) ?? []; l.push(r['id']); leadOf.set(r['user_id'], l); }
  return { teamsOf, leadOf };
}

/** Puts the person on exactly these teams */
export async function setUserTeams(userId: number, teamIds: number[]) {
  const wanted = [...new Set(teamIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (wanted.length) {
    const [ok] = await pool.query<Row[]>('SELECT id FROM uv_support_team WHERE id IN (?)', [wanted]);
    if (ok.length !== wanted.length) throw AppError.badRequest('One of the chosen teams does not exist.');
  }
  const inst = await instanceOf(userId);
  const [lead] = await pool.query<Row[]>('SELECT l.supportTeamId FROM uv_lead_support_teams l JOIN uv_user_instance i ON i.id = l.leadUserInstanceId WHERE i.user_id = ?', [userId]);
  const leading = lead.map((l) => l['supportTeamId'] as number);
  for (const id of wanted) {
    const [has] = await pool.query<Row[]>('SELECT 1 FROM uv_user_support_teams ut JOIN uv_user_instance i ON i.id = ut.userInstanceId WHERE ut.supportTeamId = ? AND i.user_id = ? LIMIT 1', [id, userId]);
    if (!has[0]) await pool.query('INSERT IGNORE INTO uv_user_support_teams (userInstanceId, supportTeamId) VALUES (?,?)', [inst, id]);
  }
  const keep = [...new Set([...wanted, ...leading])];
  await pool.query(`DELETE ut FROM uv_user_support_teams ut JOIN uv_user_instance i ON i.id = ut.userInstanceId WHERE i.user_id = ?${keep.length ? ' AND ut.supportTeamId NOT IN (?)' : ''}`, keep.length ? [userId, keep] : [userId]);
}

/** The teams this person leads, exactly these. A team has one lead, so choosing it replaces the old one. */
export async function setUserLeads(userId: number, teamIds: number[]) {
  const wanted = [...new Set(teamIds.filter((n) => Number.isInteger(n) && n > 0))];
  await pool.query('DELETE l FROM uv_lead_support_teams l JOIN uv_user_instance i ON i.id = l.leadUserInstanceId WHERE i.user_id = ?' + (wanted.length ? ' AND l.supportTeamId NOT IN (?)' : ''), wanted.length ? [userId, wanted] : [userId]);
  if (!wanted.length) return;
  const [ok] = await pool.query<Row[]>('SELECT id FROM uv_support_team WHERE id IN (?)', [wanted]);
  if (ok.length !== wanted.length) throw AppError.badRequest('One of the chosen teams does not exist.');
  const inst = await instanceOf(userId);
  for (const id of wanted) {
    await pool.query('DELETE FROM uv_lead_support_teams WHERE supportTeamId = ?', [id]);
    await pool.query('INSERT INTO uv_lead_support_teams (leadUserInstanceId, supportTeamId) VALUES (?,?)', [inst, id]);
    await pool.query('INSERT IGNORE INTO uv_user_support_teams (userInstanceId, supportTeamId) VALUES (?,?)', [inst, id]);
  }
}
