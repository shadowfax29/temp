/** Ticketing settings: categories, sub-categories and their form fields, teams and members. Used by admins (module tkt_settings). */
import type mysql from 'mysql2/promise';
import { pool } from '../../config/db';
import { AppError } from '../../utils/AppError';
import { cleanName } from '../../utils/names';
import { PRIVILEGES } from './ticketing.service';
import { syncDepartmentTeam } from './ticketing.teams';
import { ASSIGNMENT_METHODS, METHOD_LABEL, candidates, parseConditions, pickAssignee, resolveTeam, type Cond, type Facts } from './ticketing.routing';

type Row = mysql.RowDataPacket;

export const FIELD_TYPES = ['TEXT', 'TEXTAREA', 'NUMBER', 'SELECT', 'DATE'] as const;
export { ASSIGNMENT_METHODS, METHOD_LABEL };

async function withTx<T>(fn: (conn: mysql.PoolConnection) => Promise<T>): Promise<T> {
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

async function assertUsers(db: mysql.PoolConnection | typeof pool, ids: number[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const [rows] = await db.query<Row[]>('SELECT UserID FROM Users WHERE UserID IN (?) AND IsUserArchived = 0 AND UserStatus = 1', [unique]);
  const found = new Set(rows.map((r) => r['UserID'] as number));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length) throw AppError.badRequest(`Not an active user: ${missing.join(', ')}`);
}

// ── Categories ───────────────────────────────────────────────────────────────────────────────────

export async function listCategories() {
  const [cats] = await pool.query<Row[]>(
    `SELECT c.*, ou.UserName AS owner_name, NULL AS department_name,
       (SELECT COUNT(*) FROM tkt_ticket t WHERE t.category_id = c.id) AS ticket_count
     FROM tkt_category c LEFT JOIN Users ou ON ou.UserID = c.owner_user_id ORDER BY c.name`);
  const [subs] = await pool.query<Row[]>('SELECT * FROM tkt_subcategory ORDER BY sort_order, name');
  const [fields] = await pool.query<Row[]>('SELECT * FROM tkt_field ORDER BY sort_order, id');
  const [links] = await pool.query<Row[]>('SELECT ct.category_id, ct.team_id, t.name FROM tkt_category_team ct JOIN tkt_team t ON t.id = ct.team_id ORDER BY t.name');
  const [rules] = await pool.query<Row[]>('SELECT r.*, t.name AS team_name FROM tkt_route_rule r JOIN tkt_team t ON t.id = r.team_id ORDER BY r.position, r.id');
  const [subCounts] = await pool.query<Row[]>(
    `SELECT subcategory_id, status, COUNT(*) AS n FROM tkt_ticket GROUP BY subcategory_id, status`);
  const countMap = new Map<number, Record<string, number>>();
  for (const r of subCounts) {
    const id = r['subcategory_id'] as number;
    if (!countMap.has(id)) countMap.set(id, {});
    countMap.get(id)![r['status'] as string] = Number(r['n']);
  }
  return cats.map((c) => ({
    id: c['id'], name: c['name'], prefix: c['prefix'], description: c['description'], active: !!c['active'],
    departmentId: c['department_id'], departmentName: c['department_name'] ?? null, ownerUserId: c['owner_user_id'], ownerName: c['owner_name'] ?? null,
    defaultTeamId: c['default_team_id'], ticketCount: Number(c['ticket_count']),
    teams: links.filter((l) => l['category_id'] === c['id']).map((l) => ({ id: l['team_id'], name: l['name'] })),
    rules: rules.filter((r) => r['category_id'] === c['id']).map((r) => ({ id: r['id'], name: r['name'], teamId: r['team_id'], teamName: r['team_name'], active: !!r['active'], conditions: parseConditions(r['conditions']) })),
    subcategories: subs.filter((s) => s['category_id'] === c['id']).map((s) => {
      const sc = countMap.get(s['id'] as number) ?? {};
      const total = Object.values(sc).reduce((a, b) => a + b, 0);
      const open = (sc['OPEN'] ?? 0) + (sc['PENDING'] ?? 0) + (sc['ANSWERED'] ?? 0);
      return {
        id: s['id'], name: s['name'], active: !!s['active'], sortOrder: s['sort_order'], defaultTeamId: s['default_team_id'], skill: s['skill'],
        counts: { total, open, resolved: sc['RESOLVED'] ?? 0, pending: sc['PENDING'] ?? 0 },
        fields: fields.filter((f) => f['subcategory_id'] === s['id']).map((f) => ({
          key: f['field_key'], label: f['label'], type: f['field_type'], required: !!f['required'], options: f['options'] ? (JSON.parse(f['options']) as string[]) : [],
        })),
      };
    }),
  }));
}

export interface CategoryInput {
  name: string; prefix: string; description?: string | null; departmentId?: number | null; ownerUserId?: number | null;
  defaultTeamId?: number | null; active?: boolean; teamIds?: number[];
}

export async function saveCategory(input: CategoryInput, id?: number) {
  const prefix = input.prefix.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,7}$/.test(prefix)) throw AppError.badRequest('The key prefix is 2 to 8 letters or digits, starting with a letter (for example ADO).');
  return withTx(async (conn) => {
    if (input.ownerUserId) await assertUsers(conn, [input.ownerUserId]);
    const teamIds = [...new Set(input.teamIds ?? [])];
    if (input.defaultTeamId != null && !teamIds.includes(input.defaultTeamId)) teamIds.push(input.defaultTeamId);
    if (teamIds.length) {
      const [t] = await conn.query<Row[]>('SELECT id FROM tkt_team WHERE id IN (?)', [teamIds]);
      if (t.length !== teamIds.length) throw AppError.badRequest('One of the teams does not exist.');
    }

    let catId = id ?? 0;
    try {
      if (id) {
        const [cur] = await conn.query<Row[]>('SELECT prefix FROM tkt_category WHERE id = ?', [id]);
        if (!cur[0]) throw AppError.notFound('Category not found.');
        if (cur[0]['prefix'] !== prefix) {
          const [used] = await conn.query<Row[]>('SELECT COUNT(*) AS n FROM tkt_ticket WHERE category_id = ?', [id]);
          if (Number(used[0]?.['n']) > 0) throw AppError.badRequest('The key prefix cannot change once the category has tickets.');
        }
        await conn.query(
          `UPDATE tkt_category SET name = ?, prefix = ?, description = ?, department_id = ?, owner_user_id = ?, default_team_id = ?, active = ? WHERE id = ?`,
          [input.name.trim(), prefix, input.description ?? null, input.departmentId ?? null, input.ownerUserId ?? null, input.defaultTeamId ?? null, input.active === false ? 0 : 1, id]);
      } else {
        const [r] = await conn.query<mysql.ResultSetHeader>(
          `INSERT INTO tkt_category (name, prefix, description, department_id, owner_user_id, default_team_id, active) VALUES (?,?,?,?,?,?,?)`,
          [input.name.trim(), prefix, input.description ?? null, input.departmentId ?? null, input.ownerUserId ?? null, input.defaultTeamId ?? null, input.active === false ? 0 : 1]);
        catId = r.insertId;
        // tickets are raised without choosing a ticket type: every group has a General one
        await conn.query("INSERT INTO tkt_subcategory (category_id, name, active, sort_order) VALUES (?, 'General', 1, 0)", [catId]);
      }
    } catch (e) {
      if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw AppError.conflict('A category with that name or key prefix already exists.');
      throw e;
    }
    if (input.teamIds || input.defaultTeamId != null) {
      await conn.query('DELETE FROM tkt_category_team WHERE category_id = ?', [catId]);
      for (const teamId of teamIds) await conn.query('INSERT INTO tkt_category_team (category_id, team_id) VALUES (?,?)', [catId, teamId]);
    }
    return { id: catId };
  });
}

/** Groups are not shown to anyone: ticket types live in one hidden group (the first one, or "Requests" made on the spot) */
export async function defaultCategoryId(): Promise<number> {
  const [c] = await pool.query<Row[]>('SELECT id FROM tkt_category ORDER BY active DESC, id LIMIT 1');
  if (c[0]) return c[0]['id'] as number;
  const [r] = await pool.query<mysql.ResultSetHeader>(`INSERT INTO tkt_category (name, prefix, description, active) VALUES ('Requests', 'TKT', 'All ticket types', 1)`);
  return r.insertId;
}

export async function saveSubcategory(categoryId: number, input: { name: string; active?: boolean; sortOrder?: number; defaultTeamId?: number | null; skill?: string | null }, id?: number) {
  const name = cleanName('category', input.name);
  const [same] = await pool.query<Row[]>('SELECT id FROM tkt_subcategory WHERE name = ? AND id <> ?', [name, id ?? 0]);
  if (same[0]) throw AppError.conflict(`A category named "${name}" already exists.`);
  if (!categoryId) categoryId = await defaultCategoryId();
  const [c] = await pool.query<Row[]>('SELECT id FROM tkt_category WHERE id = ?', [categoryId]);
  if (!c[0]) throw AppError.notFound('Category not found.');
  if (input.defaultTeamId != null) {
    const [t] = await pool.query<Row[]>('SELECT 1 FROM tkt_category_team WHERE category_id = ? AND team_id = ?', [categoryId, input.defaultTeamId]);
    if (!t[0]) throw AppError.badRequest('The default team must be one of the teams of this category.');
  }
  const skill = input.skill?.trim() || null;
  try {
    if (id) {
      const [r] = await pool.query<mysql.ResultSetHeader>(
        'UPDATE tkt_subcategory SET name = ?, active = ?, sort_order = ?, default_team_id = ?, skill = ? WHERE id = ? AND category_id = ?',
        [name, input.active === false ? 0 : 1, input.sortOrder ?? 0, input.defaultTeamId ?? null, skill, id, categoryId]);
      if (!r.affectedRows) throw AppError.notFound('Sub-category not found.');
      return { id };
    }
    const [r] = await pool.query<mysql.ResultSetHeader>('INSERT INTO tkt_subcategory (category_id, name, active, sort_order, default_team_id, skill) VALUES (?,?,?,?,?,?)',
      [categoryId, name, input.active === false ? 0 : 1, input.sortOrder ?? 0, input.defaultTeamId ?? null, skill]);
    return { id: r.insertId };
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw AppError.conflict('That category already has a sub-category with this name.');
    throw e;
  }
}

export interface FieldInput { key: string; label: string; type: (typeof FIELD_TYPES)[number]; required?: boolean; options?: string[] }

/** Replaces the form of a sub-category. Tickets keep the values they were raised with, by field key. */
export async function setFields(subcategoryId: number, fields: FieldInput[]) {
  const [s] = await pool.query<Row[]>('SELECT id FROM tkt_subcategory WHERE id = ?', [subcategoryId]);
  if (!s[0]) throw AppError.notFound('Sub-category not found.');
  const seen = new Set<string>();
  for (const f of fields) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(f.key)) throw AppError.badRequest(`Field key "${f.key}": use lower case letters, digits and underscores, starting with a letter.`);
    if (seen.has(f.key)) throw AppError.badRequest(`Field key "${f.key}" is used twice.`);
    seen.add(f.key);
    if (f.type === 'SELECT' && !(f.options ?? []).filter((o) => o.trim()).length) throw AppError.badRequest(`Field "${f.label}": add at least one option.`);
  }
  await withTx(async (conn) => {
    await conn.query('DELETE FROM tkt_field WHERE subcategory_id = ?', [subcategoryId]);
    let order = 0;
    for (const f of fields) {
      await conn.query(
        'INSERT INTO tkt_field (subcategory_id, field_key, label, field_type, options, required, sort_order) VALUES (?,?,?,?,?,?,?)',
        [subcategoryId, f.key, f.label.trim(), f.type, f.type === 'SELECT' ? JSON.stringify((f.options ?? []).map((o) => o.trim()).filter(Boolean)) : null, f.required ? 1 : 0, order++]);
    }
  });
}

// ── Teams ────────────────────────────────────────────────────────────────────────────────────────

export async function listTeams() {
  const [teams] = await pool.query<Row[]>(
    `SELECT t.*, lu.UserName AS lead_name,
       (SELECT COUNT(*) FROM tkt_ticket x WHERE x.team_id = t.id AND x.status NOT IN ('RESOLVED','CLOSED','SPAM')) AS open_n
     FROM tkt_team t LEFT JOIN Users lu ON lu.UserID = t.lead_user_id ORDER BY t.name`);
  const [members] = await pool.query<Row[]>(
    `SELECT m.team_id, m.user_id, m.privilege, m.active, m.away, m.skills, m.source, m.excluded, u.UserName, u.UserEmail, u.UserStatus,
       (SELECT COUNT(*) FROM tkt_ticket x WHERE x.assignee_id = m.user_id AND x.team_id = m.team_id AND x.status NOT IN ('RESOLVED','CLOSED','SPAM')) AS open_n
     FROM tkt_team_member m JOIN Users u ON u.UserID = m.user_id ORDER BY u.UserName`);
  const [links] = await pool.query<Row[]>('SELECT ct.team_id, ct.category_id, c.name FROM tkt_category_team ct JOIN tkt_category c ON c.id = ct.category_id ORDER BY c.name');
  return teams.map((t) => ({
    id: t['id'], name: t['name'], leadUserId: t['lead_user_id'], leadName: t['lead_name'] ?? null, assignmentMethod: t['assignment_method'],
    maxOpen: t['max_open'], active: !!t['active'], openTickets: Number(t['open_n']),
    categories: links.filter((l) => l['team_id'] === t['id']).map((l) => ({ id: l['category_id'], name: l['name'] })),
    members: members.filter((m) => m['team_id'] === t['id']).map((m) => ({
      userId: m['user_id'], name: m['UserName'], email: m['UserEmail'], privilege: m['privilege'], active: !!m['active'] && m['UserStatus'] === 1, open: Number(m['open_n']),
      away: !!m['away'], skills: m['skills'] ? (JSON.parse(m['skills']) as string[]) : [], source: m['source'] as 'DEPT' | 'MANUAL', excluded: !!m['excluded'],
    })),
  }));
}

export interface TeamInput {
  name: string; leadUserId?: number | null; assignmentMethod?: string; maxOpen?: number; active?: boolean; categoryIds?: number[];
  /** kept for older callers; teams here never follow a department */
  useDepartmentLead?: boolean;
}

/** The lead is always a member with the Team Lead privilege; a former lead drops to Senior. */
export async function saveTeam(input: TeamInput, id?: number) {
  const name = cleanName('team', input.name);
  const [dup] = await pool.query<Row[]>('SELECT id FROM tkt_team WHERE name = ? AND id <> ?', [name, id ?? 0]);
  if (dup[0]) throw AppError.conflict(`A team named "${name}" already exists.`);
  const method = input.assignmentMethod ?? 'MANUAL';
  if (!(ASSIGNMENT_METHODS as readonly string[]).includes(method)) throw AppError.badRequest(`Assignment method must be one of: ${ASSIGNMENT_METHODS.join(', ')}.`);
  return withTx(async (conn) => {
    if (input.leadUserId) await assertUsers(conn, [input.leadUserId]);
    let teamId = id ?? 0;
    let oldLead: number | null = null;
    let departmentId: number | null = null;
    try {
      if (id) {
        const [cur] = await conn.query<Row[]>('SELECT lead_user_id, department_id, lead_locked FROM tkt_team WHERE id = ?', [id]);
        if (!cur[0]) throw AppError.notFound('Team not found.');
        oldLead = cur[0]['lead_user_id'] as number | null;
        departmentId = (cur[0]['department_id'] as number | null) ?? null;
        let locked = cur[0]['lead_locked'] ? 1 : 0;
        // a lead that is not mentioned stays as it is; null clears it
        let lead = input.leadUserId === undefined ? oldLead : (input.leadUserId ?? null);
        if (departmentId != null) {
          if (input.useDepartmentLead) { locked = 0; lead = oldLead; }
          else if (lead !== oldLead) locked = 1;
        }
        await conn.query('UPDATE tkt_team SET name = ?, lead_user_id = ?, lead_locked = ?, assignment_method = ?, max_open = ?, active = ? WHERE id = ?',
          [name, lead, locked, method, input.maxOpen ?? 8, input.active === false ? 0 : 1, id]);
        input.leadUserId = lead;
      } else {
        const [r] = await conn.query<mysql.ResultSetHeader>('INSERT INTO tkt_team (name, lead_user_id, assignment_method, max_open, active) VALUES (?,?,?,?,?)',
          [name, input.leadUserId ?? null, method, input.maxOpen ?? 8, input.active === false ? 0 : 1]);
        teamId = r.insertId;
      }
    } catch (e) {
      if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw AppError.conflict('A team with that name already exists.');
      throw e;
    }
    if (oldLead && oldLead !== (input.leadUserId ?? null)) {
      await conn.query(`UPDATE tkt_team_member SET privilege = 'ASSOCIATE' WHERE team_id = ? AND user_id = ? AND privilege = 'LEAD'`, [teamId, oldLead]);
    }
    if (input.leadUserId) {
      await conn.query(
        `INSERT INTO tkt_team_member (team_id, user_id, privilege, active) VALUES (?,?, 'LEAD', 1) ON DUPLICATE KEY UPDATE privilege = 'LEAD', active = 1, excluded = 0`, [teamId, input.leadUserId]);
    }
    if (departmentId != null && input.useDepartmentLead) await syncDepartmentTeam(conn, teamId);
    if (input.categoryIds) {
      const ids = [...new Set(input.categoryIds)];
      if (ids.length) {
        const [c] = await conn.query<Row[]>('SELECT id FROM tkt_category WHERE id IN (?)', [ids]);
        if (c.length !== ids.length) throw AppError.badRequest('One of the categories does not exist.');
      }
      await conn.query('DELETE FROM tkt_category_team WHERE team_id = ?', [teamId]);
      for (const cid of ids) await conn.query('INSERT INTO tkt_category_team (category_id, team_id) VALUES (?,?)', [cid, teamId]);
    }
    return { id: teamId };
  });
}

export interface MemberInput { userId: number; privilege: (typeof PRIVILEGES)[number]; active?: boolean; skills?: string[] }

/**
 * Saves the members the admin sees. A person from the sub department can be switched off (excluded: they stay out of ticketing even though they are in the sub department)
 * and given a privilege or skills; people added by hand who are no longer listed are removed. Sub department members who are not listed are left as they are.
 * The lead stays a member with the Team Lead privilege whatever is sent.
 */
export async function setMembers(teamId: number, members: MemberInput[]) {
  const [t] = await pool.query<Row[]>('SELECT lead_user_id FROM tkt_team WHERE id = ?', [teamId]);
  if (!t[0]) throw AppError.notFound('Team not found.');
  const lead = t[0]['lead_user_id'] as number | null;
  const byUser = new Map<number, MemberInput>();
  for (const m of members) byUser.set(m.userId, m);
  if (lead) byUser.set(lead, { userId: lead, privilege: 'LEAD', active: true, skills: byUser.get(lead)?.skills });
  await withTx(async (conn) => {
    const switchedOn = [...byUser.values()].filter((m) => m.active !== false).map((m) => m.userId);
    await assertUsers(conn, switchedOn);
    const [rows] = await conn.query<Row[]>('SELECT user_id, source FROM tkt_team_member WHERE team_id = ?', [teamId]);
    const have = new Map(rows.map((r) => [r['user_id'] as number, r['source'] as string]));
    for (const m of byUser.values()) {
      const isLead = m.userId === lead;
      const include = isLead || m.active !== false;
      const privilege = isLead ? 'LEAD' : m.privilege === 'LEAD' ? 'ASSOCIATE' : m.privilege;
      const skills = m.skills?.length ? JSON.stringify(m.skills.map((x) => x.trim()).filter(Boolean)) : null;
      if (have.has(m.userId)) {
        const fromDept = have.get(m.userId) === 'DEPT';
        await conn.query('UPDATE tkt_team_member SET privilege = ?, skills = ?, active = ?, excluded = ? WHERE team_id = ? AND user_id = ?',
          [privilege, skills, include ? 1 : 0, fromDept && !include ? 1 : 0, teamId, m.userId]);
      } else if (include) {
        await conn.query(`INSERT INTO tkt_team_member (team_id, user_id, privilege, active, skills, source) VALUES (?,?,?,1,?, 'MANUAL')`, [teamId, m.userId, privilege, skills]);
      }
    }
    for (const [uid, source] of have) {
      if (source === 'MANUAL' && !byUser.has(uid) && uid !== lead) await conn.query('UPDATE tkt_team_member SET active = 0 WHERE team_id = ? AND user_id = ?', [teamId, uid]);
    }
  });
}

/** People picker: active users matching a name or email */
export async function searchUsers(q: string) {
  const like = `%${q.trim()}%`;
  const [rows] = await pool.query<Row[]>(
    `SELECT u.UserID, u.UserName, u.UserEmail, NULL AS dept
     FROM Users u WHERE u.IsUserArchived = 0 AND u.UserStatus = 1 AND (u.UserName LIKE ? OR u.UserEmail LIKE ?) ORDER BY u.UserName LIMIT 20`, [like, like]);
  return rows.map((r) => ({ id: r['UserID'] as number, name: r['UserName'] as string, email: r['UserEmail'] as string, department: (r['dept'] as string | null) ?? null }));
}

// ── Routing rules ────────────────────────────────────────────────────────────────────────────────

export interface RuleInput { name: string; conditions: Cond[]; teamId: number; active?: boolean }

/** Replaces the category's routing rules; their order in the list is the order they are tried */
export async function setRules(categoryId: number, rules: RuleInput[]) {
  const [c] = await pool.query<Row[]>('SELECT id FROM tkt_category WHERE id = ?', [categoryId]);
  if (!c[0]) throw AppError.notFound('Category not found.');
  for (const r of rules) {
    if (!r.conditions.length) throw AppError.badRequest(`Rule "${r.name}": add at least one condition.`);
    for (const k of r.conditions) {
      if (k.type === 'field' && !k.key?.trim()) throw AppError.badRequest(`Rule "${r.name}": pick the form field to look at.`);
      if (!String(k.value ?? '').trim()) throw AppError.badRequest(`Rule "${r.name}": every condition needs a value.`);
    }
    const [t] = await pool.query<Row[]>('SELECT 1 FROM tkt_category_team WHERE category_id = ? AND team_id = ?', [categoryId, r.teamId]);
    if (!t[0]) throw AppError.badRequest(`Rule "${r.name}": its team must be one of the teams of this category.`);
  }
  await withTx(async (conn) => {
    await conn.query('DELETE FROM tkt_route_rule WHERE category_id = ?', [categoryId]);
    let pos = 0;
    for (const r of rules) {
      await conn.query('INSERT INTO tkt_route_rule (category_id, position, name, conditions, team_id, active) VALUES (?,?,?,?,?,?)',
        [categoryId, pos++, r.name.trim(), JSON.stringify(r.conditions), r.teamId, r.active === false ? 0 : 1]);
    }
  });
}

/** "Test routing": where would a ticket with these answers go, and who would get it? Changes nothing. */
export async function testRouting(categoryId: number, input: { subcategoryId: number; fields?: Record<string, unknown>; departmentIds?: number[]; priority?: string }) {
  const facts: Facts = { subcategoryId: input.subcategoryId, fields: input.fields ?? {}, departmentIds: input.departmentIds ?? [], priority: input.priority ?? 'MEDIUM' };
  const route = await resolveTeam(pool, categoryId, facts);
  let pick = null;
  if (route.teamId != null) {
    const [sub] = await pool.query<Row[]>('SELECT skill FROM tkt_subcategory WHERE id = ?', [input.subcategoryId]);
    pick = await pickAssignee(pool, route.teamId, (sub[0]?.['skill'] as string | null | undefined) ?? null);
    const { list } = await candidates(pool, route.teamId);
    pick = { ...pick, members: list.map((m) => ({ userId: m.userId, name: m.name, open: m.open, limit: m.limit, away: m.away, skills: m.skills })) };
  }
  return { route, pick, methodLabel: pick ? METHOD_LABEL[pick.method] : null };
}

/** Deletes a category that nobody has used yet (a used one is kept for the tickets that carry it: hide it instead) */
export async function deleteSubcategory(id: number) {
  const [s] = await pool.query<Row[]>('SELECT id, name FROM tkt_subcategory WHERE id = ?', [id]);
  if (!s[0]) throw AppError.notFound('Category not found.');
  const [used] = await pool.query<Row[]>('SELECT COUNT(*) AS n FROM tkt_ticket WHERE subcategory_id = ?', [id]);
  if (Number(used[0]!['n']) > 0) throw AppError.conflict(`"${s[0]['name']}" is on ${used[0]!['n']} ticket(s), so it cannot be deleted. Switch it off ("Shown on the new ticket form") to hide it instead.`);
  await pool.query('DELETE FROM tkt_field WHERE subcategory_id = ?', [id]);
  await pool.query('DELETE FROM tkt_subcategory WHERE id = ?', [id]);
  return { deleted: true };
}

/** Deletes a team that never had a ticket (a team with history is kept, because the history names it: make it inactive instead) */
export async function deleteTeam(id: number) {
  const [t] = await pool.query<Row[]>('SELECT id, name FROM tkt_team WHERE id = ?', [id]);
  if (!t[0]) throw AppError.notFound('Team not found.');
  const [n] = await pool.query<Row[]>(
    `SELECT (SELECT COUNT(*) FROM tkt_ticket WHERE team_id = ?) + (SELECT COUNT(*) FROM tkt_period WHERE team_id = ?) + (SELECT COUNT(*) FROM tkt_event WHERE team_id = ?) AS n`, [id, id, id]);
  if (Number(n[0]!['n']) > 0) throw AppError.conflict(`"${t[0]['name']}" has handled tickets, so it cannot be deleted. Switch it to Inactive to stop using it.`);
  await withTx(async (conn) => {
    await conn.query('UPDATE tkt_category SET default_team_id = NULL WHERE default_team_id = ?', [id]);
    await conn.query('UPDATE tkt_subcategory SET default_team_id = NULL WHERE default_team_id = ?', [id]);
    await conn.query('DELETE FROM tkt_route_rule WHERE team_id = ?', [id]);
    await conn.query('DELETE FROM tkt_category_team WHERE team_id = ?', [id]);
    await conn.query('DELETE FROM tkt_team_member WHERE team_id = ?', [id]);
    await conn.query('DELETE FROM tkt_team WHERE id = ?', [id]);
  });
  return { deleted: true };
}
