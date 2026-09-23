import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { db } from '../../src/lib/db.ts';
import { assertTestDatabase } from './test-guard.ts';
async function protectedIdentity() {
  const result = await db().query(`SELECT jsonb_build_object('employee',to_jsonb(e),'user',to_jsonb(u),'accounts',
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM account a WHERE a."userId"=e.auth_user_id)) AS identity
    FROM employee e JOIN "user" u ON u.id=e.auth_user_id WHERE e.protected`);
  assert.equal(result.rowCount, 1); return result.rows[0].identity;
}
try {
  const purpose = (await db().query("SELECT value FROM app_environment WHERE key='purpose'")).rows[0]?.value;
  if (!['rentmanager-app-dev', 'rentmanager-test'].includes(purpose) || purpose !== process.env.RENTMANAGER_ENVIRONMENT) throw new Error('Scope');
  if (purpose === 'rentmanager-test') await assertTestDatabase(db());
  const before = await protectedIdentity();
  for (let n = 0; n < 2; n++) {
    const child = spawnSync(process.execPath, ['scripts/auth/migrate.ts'], { stdio: 'inherit', env: process.env });
    if (child.status !== 0) throw new Error('Migration failed');
    assert.deepEqual(await protectedIdentity(), before);
  }
  console.log('PASS two migrations preserved full protected employee, user, account IDs and credential hashes (values suppressed)');
} catch { console.error('FAIL upgrade retention verification; details suppressed'); process.exitCode = 1; }
finally { await db().end(); }
