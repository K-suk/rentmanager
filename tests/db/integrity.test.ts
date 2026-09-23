import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db.ts';
import { loadFixtures } from '../fixtures/data.ts';
import { borrowEquipment, returnLoan, extendLoan, createEquipment, updateEquipment, deleteEquipment, updateEmployee } from '../../src/lib/operations.ts';
import { provision } from '../../src/lib/provision.ts';
import { addDays } from '../../src/lib/dates.ts';
import { assertTestDatabase } from '../../scripts/db/test-guard.ts';
import { HttpError } from '../../src/lib/errors.ts';
const key = () => randomUUID();
const conflict = (error: unknown) => error instanceof HttpError && error.status === 409;
// Single top-level test: mutable fixtures are never run concurrently across suites.
test('isolated Postgres integration: constraints, transactions, races, snapshots and caps', async t => {
  await assertTestDatabase(db());
  const f = await loadFixtures(); const [admin,a,b] = f.employees;
  try {
    await t.test('two borrowers produce exactly one open loan; retry and mismatched key', async () => {
      const input = {equipmentId:f.equipment[4],dueDate:f.today,idempotencyKey:key()};
      const results = await Promise.allSettled([borrowEquipment(a,input),borrowEquipment(b,{...input,idempotencyKey:key()})]);
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1); for(const r of results) if(r.status==='rejected') assert.ok(conflict(r.reason));
      const owner = results[0].status==='fulfilled' ? a : b;
      const loan = (await db().query('SELECT *,due_date::text FROM loan WHERE equipment_id=$1 AND returned_at IS NULL',[input.equipmentId])).rows[0]; assert.equal(loan.borrower_id,owner);
      if(owner===a) { assert.equal((await borrowEquipment(a,input)).id,loan.id); await assert.rejects(borrowEquipment(a,{...input,dueDate:addDays(f.today,1)}),conflict); }
    });
    await t.test('borrow/delete race and deleted asset number reservation',async()=>{
      const id=f.equipment[5]; const results=await Promise.allSettled([borrowEquipment(a,{equipmentId:id,dueDate:f.today,idempotencyKey:key()}),deleteEquipment(admin,{id})]);
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1); for(const r of results) if(r.status==='rejected') assert.ok(conflict(r.reason));
      assert.equal((await db().query('SELECT 1 FROM equipment e JOIN loan l ON l.equipment_id=e.id WHERE e.deleted_at IS NOT NULL AND l.returned_at IS NULL')).rowCount,0);
      await deleteEquipment(admin,{id:f.equipment[6]}); await deleteEquipment(admin,{id:f.equipment[6]});
      await assert.rejects(createEquipment(admin,{assetNumber:'DEMO-007',name:'重複',category:'その他'}),conflict);
    });
    await t.test('extension retry, stale parallel extension, return/extend race and immutable first return',async()=>{
      const id=f.loans[0]; const initial=addDays(f.today,2); const input={loanId:id,expectedDueDate:initial,dueDate:addDays(f.today,3),idempotencyKey:key()};
      const first=await extendLoan(a,input); assert.deepEqual(await extendLoan(a,input),first);
      assert.equal((await db().query('SELECT count(*)::int AS n FROM loan_extension WHERE loan_id=$1',[id])).rows[0].n,1);
      const race=await Promise.allSettled([extendLoan(a,{...input,expectedDueDate:first.dueDate,dueDate:addDays(f.today,4),idempotencyKey:key()}),extendLoan(admin,{...input,expectedDueDate:first.dueDate,dueDate:addDays(f.today,5),idempotencyKey:key()})]);
      assert.equal(race.filter(x=>x.status==='fulfilled').length,1); for(const r of race) if(r.status==='rejected') assert.ok(conflict(r.reason));
      const current=(await db().query('SELECT due_date::text FROM loan WHERE id=$1',[id])).rows[0].due_date;
      const mixed=await Promise.allSettled([returnLoan(a,{loanId:id,expectedDueDate:current,idempotencyKey:key()}),extendLoan(admin,{loanId:id,expectedDueDate:current,dueDate:addDays(f.today,6),idempotencyKey:key()})]);
      assert.equal(mixed.filter(x=>x.status==='fulfilled').length,1); for(const r of mixed) if(r.status==='rejected') assert.ok(conflict(r.reason));
      const latest=(await db().query('SELECT due_date::text FROM loan WHERE id=$1',[id])).rows[0].due_date;
      const returned=await returnLoan(admin,{loanId:id,expectedDueDate:latest,idempotencyKey:key()});
      assert.deepEqual(await returnLoan(a,{loanId:id,expectedDueDate:initial,idempotencyKey:key()}),returned);
      await assert.rejects(extendLoan(a,{...input,idempotencyKey:key()}),conflict);
    });
    await t.test('server authorization and immediate disable/demotion',async()=>{
      await assert.rejects(returnLoan(a,{loanId:f.loans[1],expectedDueDate:addDays(f.today,-1),idempotencyKey:key()}),{code:'EMPLOYEE_FORBIDDEN'});
      await assert.rejects(borrowEquipment(a,{equipmentId:'invalid',dueDate:f.today,idempotencyKey:key()}),{code:'INVALID_INPUT'});
      await assert.rejects(borrowEquipment(a,{equipmentId:f.equipment[8],dueDate:f.today,idempotencyKey:key(),borrowerId:b}),{code:'INVALID_INPUT'});
      await assert.rejects(updateEmployee(admin,{id:a,active:true,role:'employee',email:'changed@example.com'}),{code:'INVALID_INPUT'});
      await assert.rejects(createEquipment(a,{assetNumber:'NO',name:'拒否',category:'その他'}),{code:'EMPLOYEE_FORBIDDEN'});
      await assert.rejects(updateEmployee(admin,{id:admin,active:false,role:'employee'}),{code:'PROTECTED_ADMIN'});
      await updateEmployee(admin,{id:b,active:false,role:'employee',name:'無効社員'});
      await assert.rejects(borrowEquipment(b,{equipmentId:f.equipment[8],dueDate:f.today,idempotencyKey:key()}),{code:'EMPLOYEE_FORBIDDEN'});
      await assert.rejects(updateEmployee(admin,{id:b,active:true,role:'employee'}),{code:'REACTIVATION_DISABLED'});
      await returnLoan(admin,{loanId:f.loans[1],expectedDueDate:addDays(f.today,-1),idempotencyKey:key()});
    });
    await t.test('DB snapshot integrity, FK, immutable returned history and atomic extension',async()=>{
      const id=f.loans[2]; await updateEquipment(admin,{id:f.equipment[2],assetNumber:'DEMO-003',name:'変更後',category:'その他'});
      assert.equal((await db().query('SELECT equipment_name_snapshot FROM loan WHERE id=$1',[id])).rows[0].equipment_name_snapshot,'架空備品3');
      const c=await db().connect();
      try {
        for(const [sql,args] of [
          ['UPDATE loan SET equipment_name_snapshot=$2 WHERE id=$1',[id,'改変']],
          ['UPDATE loan SET due_date=due_date+1 WHERE id=$1',[id]],
          ['DELETE FROM loan WHERE id=$1',[id]],
          ['UPDATE loan SET returned_by=$2 WHERE id=$1',[f.loans[0],b]],
          ['UPDATE employee SET name=$2 WHERE auth_user_id=$1',[admin,'改変']],
          ['DELETE FROM employee WHERE auth_user_id=$1',[a]],
          ['UPDATE equipment SET asset_number=$2 WHERE id=$1',[f.equipment[2],'NEW']],
          ['UPDATE "user" SET name=$2 WHERE id=$1',[admin,'改変']],
          ['DELETE FROM account WHERE "userId"=$1',[admin]],
        ] as [string,unknown[]][]) {
          await c.query('BEGIN'); let rejected=false;
          try { await c.query(sql,args); await c.query('SET CONSTRAINTS ALL IMMEDIATE'); } catch {rejected=true;}
          await c.query('ROLLBACK'); assert.ok(rejected,sql);
        }
      } finally {c.release();}
    });
    await t.test('multi-extension chain commits atomically; history-only and duplicate chains fail',async()=>{
      const id=f.loans[2]; const c=await db().connect();
      try {
        const old=(await c.query('SELECT due_date::text FROM loan WHERE id=$1',[id])).rows[0].due_date;
        await c.query('BEGIN'); await c.query('SELECT pg_advisory_xact_lock_shared(741000)'); await c.query('SELECT pg_advisory_xact_lock(741001)');
        for(let n=0;n<2;n++) {
          await c.query('INSERT INTO loan_extension(id,loan_id,old_due_date,new_due_date,actor_id,actor_name_snapshot,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7)',[key(),id,addDays(old,n),addDays(old,n+1),admin,'デモ管理者',key()]);
          await c.query('UPDATE loan SET due_date=$2 WHERE id=$1',[id,addDays(old,n+1)]);
        }
        await c.query('COMMIT');
        await c.query('BEGIN'); let rejected=false;
        try {
          await c.query('INSERT INTO loan_extension(id,loan_id,old_due_date,new_due_date,actor_id,actor_name_snapshot,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7)',[key(),id,addDays(old,2),addDays(old,3),admin,'デモ管理者',key()]);
          await c.query('SET CONSTRAINTS ALL IMMEDIATE');
        } catch {rejected=true;}
        await c.query('ROLLBACK'); assert.ok(rejected);
      } finally {c.release();}
    });
    await t.test('inactive employees still count toward cap20; concurrent active equipment cap100',async()=>{
      const count=(await db().query('SELECT count(*)::int AS n FROM employee')).rows[0].n;
      for(let n=count;n<19;n++) await provision({email:`cap${n}@example.com`,password:process.env.RENTMANAGER_FIXTURE_PASSWORD!,name:'架空上限',role:'employee'},admin);
      const employees=await Promise.allSettled([19,20].map(n=>provision({email:`cap${n}@example.com`,password:process.env.RENTMANAGER_FIXTURE_PASSWORD!,name:'架空上限',role:'employee'},admin)));
      assert.equal(employees.filter(x=>x.status==='fulfilled').length,1); for(const r of employees) if(r.status==='rejected') assert.equal(r.reason.code,'EMPLOYEE_LIMIT'); assert.equal((await db().query('SELECT count(*)::int AS n FROM employee')).rows[0].n,20);
      const active=(await db().query('SELECT count(*)::int AS n FROM equipment WHERE deleted_at IS NULL')).rows[0].n;
      for(let n=active;n<99;n++) await createEquipment(admin,{assetNumber:`CAP-${n}`,name:'架空上限',category:'その他'});
      const equipment=await Promise.allSettled([99,100].map(n=>createEquipment(admin,{assetNumber:`CAP-${n}`,name:'架空上限',category:'その他'})));
      assert.equal(equipment.filter(x=>x.status==='fulfilled').length,1); for(const r of equipment) if(r.status==='rejected') assert.equal(r.reason.code,'EQUIPMENT_LIMIT'); assert.equal((await db().query('SELECT count(*)::int AS n FROM equipment WHERE deleted_at IS NULL')).rows[0].n,100);
    });
  } finally { await db().end(); }
});
