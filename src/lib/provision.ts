import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { db } from './db.ts';
import { HttpError } from './security.ts';
import { validateEmployee, type EmployeeInput } from './validation.ts';
export { validateEmployee, type EmployeeInput } from './validation.ts';
export async function provision(input: EmployeeInput, actorId: string | null, bootstrap=false) {
  const value=validateEmployee(input);
  const password=await hashPassword(value.password);
  const client=await db().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock_shared(741000)');
    await client.query("SELECT pg_advisory_xact_lock(741001)");
    if(bootstrap) {
      const existing=await client.query('SELECT auth_user_id FROM employee WHERE protected');
      if(existing.rowCount) { await client.query('ROLLBACK'); return {created:false}; }
    } else {
      const actor=await client.query("SELECT 1 FROM employee WHERE auth_user_id=$1 AND active AND role='admin'",[actorId]);
      if(!actor.rowCount) throw new HttpError(403,'EMPLOYEE_FORBIDDEN');
    }
    const count=await client.query('SELECT count(*)::int AS count FROM employee');
    if(count.rows[0].count>=20) throw new HttpError(409,'EMPLOYEE_LIMIT');
    const exists=await client.query('SELECT 1 FROM "user" WHERE email=$1',[value.email]);
    if(exists.rowCount) throw new HttpError(409,'EMAIL_EXISTS');
    const id=randomUUID();
    await client.query('INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',[id,value.name,value.email]);
    await client.query('INSERT INTO account (id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,now(),now())',[randomUUID(),id,password]);
    await client.query('INSERT INTO employee(auth_user_id,name,email,role,protected) VALUES($1,$2,$3,$4,$5)',[id,value.name,value.email,bootstrap?'admin':value.role,bootstrap]);
    await client.query('COMMIT'); return {created:true,id};
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
