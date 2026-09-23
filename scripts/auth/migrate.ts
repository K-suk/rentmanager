import { readFile } from 'node:fs/promises';
import { getMigrations } from 'better-auth/db/migration';
import { migrationScope } from './guard.ts';
import { db } from '../../src/lib/db.ts';
import { auth } from '../../src/lib/auth.ts';
try {
  migrationScope();
  const environment=process.env.RENTMANAGER_ENVIRONMENT;
  if(!['rentmanager-app-dev','rentmanager-public'].includes(environment || '')) throw new Error('Environment required');
  const plan=await getMigrations(auth().options);
  if(plan.unsafeChanges.length || plan.schemaProblems.length) throw new Error('Unsafe migration');
  const sql=await plan.compileMigrations();
  const protection=await readFile(new URL('./protection.sql',import.meta.url),'utf8');
  const client=await db().connect();
  try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(741002)'); await client.query("CREATE TABLE IF NOT EXISTS app_environment(key text PRIMARY KEY,value text NOT NULL)"); await client.query("INSERT INTO app_environment(key,value) VALUES('purpose',$1) ON CONFLICT DO NOTHING",[environment]); const marker=await client.query("SELECT value FROM app_environment WHERE key='purpose'"); if(marker.rows[0].value!==environment) throw new Error('Environment mismatch'); if(sql.trim()) await client.query(sql); await client.query(protection); await client.query('COMMIT'); }
  catch { await client.query('ROLLBACK'); throw new Error('Migration failed'); } finally { client.release(); }
  console.log('PASS auth schema and protected identity guards');
} catch { console.error('FAIL auth migration; details suppressed'); process.exitCode=1; }
finally { try { await db().end(); } catch { /* no secret-bearing exception output */ } }
