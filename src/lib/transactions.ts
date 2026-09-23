import type { PoolClient } from 'pg';
import { db } from './db.ts';
import { HttpError } from './errors.ts';
export type Actor = { id: string; name: string; role: 'admin' | 'employee'; active: boolean; protected: boolean; email: string };
// Global order: reset shared -> employee advisory -> capacity advisory (if needed)
// -> equipment row -> loan row. No network calls inside the transaction.
export async function transaction<T>(actorId: string, admin: boolean, work: (client: PoolClient, actor: Actor) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock_shared(741000)');
    await client.query('SELECT pg_advisory_xact_lock(741001)');
    const result = await client.query('SELECT auth_user_id AS id,name,email,role,active,protected FROM employee WHERE auth_user_id=$1 AND active', [actorId]);
    const actor = result.rows[0] as Actor | undefined;
    if (!actor || (admin && actor.role !== 'admin')) throw new HttpError(403, 'EMPLOYEE_FORBIDDEN');
    const value = await work(client, actor);
    await client.query('COMMIT'); return value;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof HttpError) throw error;
    const pg = error as { code?: string; constraint?: string; message?: string };
    if (pg.code === '23505') throw new HttpError(409, pg.constraint === 'equipment_asset_number_key' ? 'ASSET_NUMBER_EXISTS' : 'CONFLICT');
    if (pg.code === '40001' || pg.code === '40P01') throw new HttpError(409, 'CONFLICT');
    if (pg.code === 'P0001' && ['EQUIPMENT_LIMIT','EMPLOYEE_LIMIT','LAST_ADMIN'].includes(pg.message ?? '')) throw new HttpError(409, pg.message!);
    throw error;
  } finally { client.release(); }
}
