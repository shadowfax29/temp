/** Ticket categories on the UVdesk table uv_ticket_type (code, description, is_active). Tickets show the description. The needed skill sits in type_settings. */
import type mysql from 'mysql2/promise';
import { pool } from '../../config/db';
import { AppError } from '../../utils/AppError';
import { cleanName } from '../../utils/names';

type Row = mysql.RowDataPacket;

/** The page works with "groups that hold categories"; there is now just one list, so it is returned as a single group */
export async function listCategories() {
  const [rows] = await pool.query<Row[]>(
    `SELECT ty.id, ty.description, ty.is_active, s.skill, (SELECT COUNT(*) FROM uv_ticket t WHERE t.type_id = ty.id) AS used
     FROM uv_ticket_type ty LEFT JOIN type_settings s ON s.type_id = ty.id ORDER BY ty.description`);
  return [{
    id: 0, name: 'All categories', prefix: '', description: null, active: true, departmentId: null, departmentName: null, ownerUserId: null, ownerName: null, defaultTeamId: null,
    ticketCount: rows.reduce((n, r) => n + Number(r['used']), 0), teams: [], rules: [],
    subcategories: rows.map((r) => ({ id: r['id'] as number, name: String(r['description'] ?? '').trim(), active: Number(r['is_active']) === 1, sortOrder: 0, defaultTeamId: null, skill: (r['skill'] as string | null) ?? null, fields: [], used: Number(r['used']) })),
  }];
}

export async function saveCategory(_groupId: number, input: { name: string; active?: boolean; skill?: string | null }, id?: number) {
  let name = input.name.replace(/\s+/g, ' ').trim();
  if (id) {
    const [cur] = await pool.query<Row[]>('SELECT description FROM uv_ticket_type WHERE id = ?', [id]);
    if (!cur[0]) throw AppError.notFound('Category not found.');
    // a category that came from UVdesk keeps its name as it is; only a changed name is held to the naming rules
    if (String(cur[0]['description']).replace(/\s+/g, ' ').trim() !== name) name = cleanName('category', input.name);
  } else name = cleanName('category', input.name);
  const [dup] = await pool.query<Row[]>('SELECT id FROM uv_ticket_type WHERE TRIM(description) = ? AND id <> ?', [name, id ?? 0]);
  if (dup[0]) throw AppError.conflict(`A category named "${name}" already exists.`);
  const skill = input.skill?.trim() || null;
  let typeId = id ?? 0;
  try {
    if (id) await pool.query('UPDATE uv_ticket_type SET description = ?, is_active = ? WHERE id = ?', [name, input.active === false ? 0 : 1, id]);
    else { const [r] = await pool.query<mysql.ResultSetHeader>('INSERT INTO uv_ticket_type (code, description, is_active) VALUES (?,?,?)', [name, name, input.active === false ? 0 : 1]); typeId = r.insertId; }
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw AppError.conflict(`A category named "${name}" already exists.`);
    throw e;
  }
  await pool.query('INSERT INTO type_settings (type_id, skill) VALUES (?,?) ON DUPLICATE KEY UPDATE skill = VALUES(skill)', [typeId, skill]);
  return { id: typeId };
}

export async function deleteCategory(id: number) {
  const [t] = await pool.query<Row[]>('SELECT description FROM uv_ticket_type WHERE id = ?', [id]);
  if (!t[0]) throw AppError.notFound('Category not found.');
  const [n] = await pool.query<Row[]>('SELECT COUNT(*) AS n FROM uv_ticket WHERE type_id = ?', [id]);
  if (Number(n[0]!['n']) > 0) throw AppError.conflict(`"${String(t[0]['description']).trim()}" is on ${n[0]!['n']} ticket(s), so it cannot be deleted. Switch it off ("Shown when raising a ticket") to hide it instead.`);
  await pool.query('DELETE FROM uv_ticket_type WHERE id = ?', [id]);
  return { deleted: true };
}
