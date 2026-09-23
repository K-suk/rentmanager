import { csrf, employee, failure, HttpError, json, jsonBody, rateLimit } from '../../../lib/security.ts';
import { provision } from '../../../lib/provision.ts';
import type { PoolClient } from 'pg';
import { db } from '../../../lib/db.ts';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function POST(request: Request) {
  try { csrf(request); const actor=await employee(request.headers,true); await rateLimit('write',actor.id); const result=await provision(await jsonBody(request),actor.id); return json(result,201); } catch(error) { return failure(error); }
}
export async function PATCH(request: Request) {
  let client: PoolClient | undefined;
  try {
    csrf(request); const actor=await employee(request.headers,true); await rateLimit('write',actor.id);
    const body=await jsonBody(request);
    if(typeof body.id!=='string' || typeof body.active!=='boolean' || !['admin','employee'].includes(body.role)) throw new HttpError(400,'INVALID_INPUT');
    client=await db().connect();
    await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(741001)');
    const currentActor=await client.query("SELECT 1 FROM employee WHERE auth_user_id=$1 AND active AND role='admin'",[actor.id]);
    if(!currentActor.rowCount) throw new HttpError(403,'EMPLOYEE_FORBIDDEN');
    const target=await client.query('SELECT * FROM employee WHERE auth_user_id=$1 FOR UPDATE',[body.id]);
    if(!target.rowCount) throw new HttpError(404,'EMPLOYEE_NOT_FOUND');
    if(!target.rows[0].active && body.active) throw new HttpError(403,'REACTIVATION_DISABLED');
    if(target.rows[0].protected) throw new HttpError(403,'PROTECTED_ADMIN');
    const admins=await client.query("SELECT count(*)::int AS count FROM employee WHERE active AND role='admin'");
    if(target.rows[0].active && target.rows[0].role==='admin' && (!body.active || body.role!=='admin') && admins.rows[0].count<=1) throw new HttpError(409,'LAST_ADMIN');
    await client.query('UPDATE employee SET active=$2,role=$3 WHERE auth_user_id=$1',[body.id,body.active,body.role]);
    await client.query('COMMIT'); return json({ok:true});
  } catch(error) { if(client) await client.query('ROLLBACK').catch(()=>{}); return failure(error); } finally { client?.release(); }
}
