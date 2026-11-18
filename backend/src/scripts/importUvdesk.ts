/**
 * Loads a UVdesk data dump into the uv_ tables of this database:  npm run db:import-uvdesk -- path\to\dump.sql
 * Reads the file line by line (a mysqldump keeps each INSERT on one line), runs only the INSERT statements, and empties the uv_ tables first, so it can be run again.
 * It never prints what is in the data, only how many rows each table received.
 */
import fs from 'fs';
import readline from 'readline';
import mysql from 'mysql2/promise';
import { env } from '../config/env';

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) throw new Error('Give the path of the UVdesk dump: npm run db:import-uvdesk -- C:\\path\\dump.sql');
  const db = await mysql.createConnection({ host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, multipleStatements: false });
  await db.query('SET NAMES utf8mb4');
  await db.query("SET SESSION sql_mode = ''");
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  await db.query('SET UNIQUE_CHECKS = 0');

  const [tables] = await db.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME LIKE 'uv\\_%' OR TABLE_NAME IN ('agent_activity','announcement','migration_versions','recaptcha'))`);
  for (const t of tables) await db.query('TRUNCATE TABLE `' + t['n'] + '`');
  console.log(`Emptied ${tables.length} tables.`);

  const counts = new Map<string, number>();
  let statements = 0;
  const started = Date.now();
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.startsWith('INSERT INTO ')) continue;
    const table = /^INSERT INTO `([^`]+)`/.exec(line)?.[1] ?? '?';
    const [res] = await db.query<mysql.ResultSetHeader>(line);
    counts.set(table, (counts.get(table) ?? 0) + res.affectedRows);
    if (++statements % 40 === 0) console.log(`  ${statements} statements, ${Math.round((Date.now() - started) / 1000)}s`);
  }
  await db.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s. Rows loaded:`);
  for (const [t, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(36)} ${n}`);
  await db.end();
}

main().catch((e) => { console.error('Import failed:', e.message); process.exit(1); });
