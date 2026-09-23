import { migrationScope } from './guard.ts';
import { provision } from '../../src/lib/provision.ts';
import { db } from '../../src/lib/db.ts';
try {
  migrationScope();
  const result=await provision({email:process.env.BOOTSTRAP_ADMIN_EMAIL || '',password:process.env.BOOTSTRAP_ADMIN_PASSWORD || '',name:'デモ管理者',role:'admin'},null,true);
  console.log(result.created?'PASS protected admin created':'PASS protected admin retained');
} catch { console.error('FAIL bootstrap; details suppressed'); process.exitCode=1; }
finally { try { await db().end(); } catch { /* no secret-bearing exception output */ } }
