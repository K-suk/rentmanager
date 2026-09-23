import { createHash } from 'node:crypto';
import { testConfiguration } from '../db/test-guard.ts';
import { readdir, readFile } from 'node:fs/promises';
import { getMigrations } from 'better-auth/db/migration';
import { migrationScope } from './guard.ts';
import { db } from '../../src/lib/db.ts';
import { auth } from '../../src/lib/auth.ts';
try {
  migrationScope();
  const environment=process.env.RENTMANAGER_ENVIRONMENT;
  if(!['rentmanager-app-dev','rentmanager-public','rentmanager-test'].includes(environment || '')) throw new Error('Environment required');
  if(environment==='rentmanager-test') testConfiguration();
  const protection=await readFile(new URL('./protection.sql',import.meta.url),'utf8');
  const client=await db().connect();
  try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(741002)'); await client.query("CREATE TABLE IF NOT EXISTS app_environment(key text PRIMARY KEY,value text NOT NULL)"); await client.query("INSERT INTO app_environment(key,value) VALUES('purpose',$1) ON CONFLICT DO NOTHING",[environment]); const marker=await client.query("SELECT value FROM app_environment WHERE key='purpose'"); if(marker.rows[0].value!==environment) throw new Error('Environment mismatch'); const plan=await getMigrations(auth().options);
    if(plan.unsafeChanges.length || plan.schemaProblems.length) throw new Error('Unsafe migration');
    const sql=await plan.compileMigrations();
    if(sql.trim()) await client.query(sql); await client.query(protection);
    if(environment==='rentmanager-test') {
      const testId=testConfiguration().id;
      await client.query("INSERT INTO app_environment(key,value) VALUES('test_id',$1) ON CONFLICT DO NOTHING",[testId]);
      const marker=await client.query("SELECT value FROM app_environment WHERE key='test_id'");
      if(marker.rows[0].value!==testId) throw new Error('Test identity mismatch');
    }
    await client.query('CREATE TABLE IF NOT EXISTS app_migration(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    const directory=new URL('../../db/migrations/',import.meta.url);
    for(const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()) {
      const source=await readFile(new URL(name,directory),'utf8'); const hash=createHash('sha256').update(source).digest('hex');
      const previous=await client.query('SELECT sha256 FROM app_migration WHERE name=$1',[name]);
      if(previous.rowCount) { if(previous.rows[0].sha256!==hash) throw new Error('Migration checksum mismatch'); continue; }
      await client.query(source); await client.query('INSERT INTO app_migration(name,sha256) VALUES($1,$2)',[name,hash]);
    }
    await client.query('COMMIT'); }
  catch { await client.query('ROLLBACK'); throw new Error('Migration failed'); } finally { client.release(); }
  console.log('PASS versioned schema, auth compatibility and protected identity guards');
} catch { console.error('FAIL auth migration; details suppressed'); process.exitCode=1; }
finally { try { await db().end(); } catch { /* no secret-bearing exception output */ } }
