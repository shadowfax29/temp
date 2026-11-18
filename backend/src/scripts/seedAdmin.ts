// Creates the first admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (run once after the migrations): npm run db:seed
import 'dotenv/config';
import { createPerson, hashPassword } from '../modules/access/people.service';
import type mysql from 'mysql2/promise';
import { pool } from '../config/db';

async function main() {
  const email = process.env['SEED_ADMIN_EMAIL']?.trim().toLowerCase();
  const password = process.env['SEED_ADMIN_PASSWORD'];
  if (!email || !password || password.length < 8) throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (8+ characters) in .env first.');
  const [role] = await pool.query<mysql.RowDataPacket[]>(`SELECT RoleID FROM AMRole WHERE UserType = 'SUPER_ADMIN' LIMIT 1`);
  if (!role[0]) throw new Error('The Admin role is missing: run npm run db:migrate first.');
  const [ex] = await pool.query<mysql.RowDataPacket[]>('SELECT UserID FROM Users WHERE UserEmail = ?', [email]);
  if (ex[0]) { console.log('That admin already exists.'); return; }
  await createPerson({ name: 'Admin', email, roleId: role[0]['RoleID'], passwordHash: await hashPassword(password) });
  console.log(`Admin ${email} created.`);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
