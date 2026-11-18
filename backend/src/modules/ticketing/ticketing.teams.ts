/**
 * Teams in the standalone tool are made by the admin (members picked by hand), so there is nothing to follow or sync.
 * These small functions keep the names the service already uses.
 */
import type mysql from 'mysql2/promise';
import type { pool } from '../../config/db';

type Db = mysql.PoolConnection | typeof pool;

export interface SyncResult { added: number; removed: number; lead: number | null }
export async function syncDepartmentTeam(_db: Db, _teamId: number): Promise<SyncResult | null> { return null; }
export async function freshenDepartmentTeams(_force = false): Promise<void> { /* nothing to refresh */ }

/** Who may raise a ticket to which team: everyone who may raise tickets can choose any active team */
export async function raisableTeams(_db: Db, _userId: number): Promise<{ all: boolean; ids: number[]; choose: boolean }> {
  return { all: true, ids: [], choose: true };
}
