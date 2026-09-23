import assert from 'node:assert/strict';
import { loadFixtures } from '../../tests/fixtures/data.ts';
import { db } from '../../src/lib/db.ts';
try {
  const fixture = await loadFixtures(process.argv.includes('--200') ? 200 : 4);
  const counts=(await db().query(`SELECT (SELECT count(*)::int FROM employee) AS employees,
    (SELECT count(*)::int FROM equipment) AS equipment,(SELECT count(*)::int FROM loan) AS loans,
    (SELECT count(*)::int FROM loan WHERE returned_at IS NULL AND due_date < (now() AT TIME ZONE 'Asia/Tokyo')::date) AS overdue,
    (SELECT count(*)::int FROM loan_extension) AS extensions`)).rows[0];
  assert.deepEqual(counts,{employees:4,equipment:20,loans:fixture.loans.length,overdue:1,extensions:1});
  console.log(`PASS fixture: ${fixture.employees.length} employees, ${fixture.equipment.length} equipment, ${fixture.loans.length} loans`); }
catch { console.error('FAIL fixture; scope or database check failed (details suppressed)'); process.exitCode = 1; }
finally { await db().end(); }
