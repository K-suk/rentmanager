import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db.ts';
import { provision } from '../../src/lib/provision.ts';
import { addDays, jstToday } from '../../src/lib/dates.ts';
import { validateEmployee } from '../../src/lib/validation.ts';
import { assertTestDatabase } from '../../scripts/db/test-guard.ts';
export async function loadFixtures(histories = 4) {
  await assertTestDatabase(db());
  if (![4, 200].includes(histories)) throw new Error('Fixture size must be 4 or 200');
  validateEmployee({name:'fixture',email:'fixture@example.com',role:'employee',password:process.env.RENTMANAGER_FIXTURE_PASSWORD});
  const admin = (await db().query('SELECT auth_user_id AS id FROM employee WHERE protected')).rows[0];
  if (!admin) throw new Error('Bootstrap protected admin first');
  const cleanup = await db().connect();
  try {
    await cleanup.query('BEGIN'); await cleanup.query('SELECT pg_advisory_xact_lock(741000)');
    await cleanup.query('TRUNCATE app_operation,loan_extension,loan,equipment');
    const disposable = (await cleanup.query('SELECT auth_user_id FROM employee WHERE NOT protected')).rows.map(row => row.auth_user_id);
    await cleanup.query('DELETE FROM app_fixture_identity WHERE auth_user_id=ANY($1::text[])',[disposable]);
    await cleanup.query('DELETE FROM session WHERE "userId"=ANY($1::text[])',[disposable]);
    await cleanup.query('DELETE FROM employee WHERE auth_user_id=ANY($1::text[]) AND NOT protected',[disposable]);
    await cleanup.query('DELETE FROM account WHERE "userId"=ANY($1::text[])',[disposable]);
    await cleanup.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[disposable]);
    await cleanup.query('COMMIT');
  } catch(error) { await cleanup.query('ROLLBACK'); throw error; } finally {cleanup.release();}
  const employees = [admin.id as string];
  for (let n = 1; n <= 3; n++) {
    const email = `fixture${n}@example.com`;
    const existing = (await db().query('SELECT auth_user_id AS id FROM employee WHERE email=$1', [email])).rows[0];
    if (existing) employees.push(existing.id);
    else {
      const created = await provision({ name: `架空社員${n}`, email, password: process.env.RENTMANAGER_FIXTURE_PASSWORD || '', role: 'employee' }, admin.id);
      employees.push(created.id!);
    }
  }
  const client = await db().connect(); const equipment: string[] = []; const loans: string[] = [];
  try {
    await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(741000)');
    // Explicitly isolated test DB only. Never truncate employee or Auth tables.
    await client.query('TRUNCATE app_operation,loan_extension,loan,equipment');
    for (let n = 0; n < 20; n++) {
      const id = randomUUID(); equipment.push(id);
      await client.query("INSERT INTO equipment(id,asset_number,name,category) VALUES($1,$2,$3,'パソコン')", [id, `DEMO-${String(n + 1).padStart(3, '0')}`, `架空備品${n + 1}`]);
    }
    const today = jstToday();
    for (let n = 0; n < histories; n++) {
      const id = randomUUID(); loans.push(id); const returned = n >= 3; const due = addDays(today, n === 1 ? -1 : 2);
      await client.query(`INSERT INTO loan(id,equipment_id,borrower_id,borrowed_at,due_date,returned_at,returned_by,asset_number_snapshot,equipment_name_snapshot,borrower_name_snapshot)
        VALUES($1,$2,$3,now()-interval '7 days',$4,CASE WHEN $5 THEN now()-interval '1 day' END,CASE WHEN $5 THEN $6 END,'','','')`, [id, equipment[n % 20], employees[1 + n % 3], due, returned, employees[0]]);
      if (n === 2) {
        await client.query('INSERT INTO loan_extension(id,loan_id,old_due_date,new_due_date,actor_id,actor_name_snapshot,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), id, due, addDays(today, 5), employees[0], 'デモ管理者', randomUUID()]);
        await client.query('UPDATE loan SET due_date=$2 WHERE id=$1', [id, addDays(today, 5)]);
      }
    }
    await client.query('COMMIT'); return { employees, equipment, loans, today };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
