import { loadFixtures } from '../../tests/fixtures/data.ts';
import { db } from '../../src/lib/db.ts';
try { const fixture = await loadFixtures(process.argv.includes('--200') ? 200 : 4); console.log(`PASS fixture: ${fixture.employees.length} employees, ${fixture.equipment.length} equipment, ${fixture.loans.length} loans`); }
catch { console.error('FAIL fixture; scope or database check failed (details suppressed)'); process.exitCode = 1; }
finally { await db().end(); }
