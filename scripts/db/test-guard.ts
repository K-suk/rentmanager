import type { Pool } from 'pg';
export function testConfiguration(env: Record<string, string | undefined> = process.env) {
  const url = new URL(env.DATABASE_URL || 'invalid');
  if (env.RENTMANAGER_ENVIRONMENT !== 'rentmanager-test' || env.RENTMANAGER_TEST_ACK !== 'isolated-test-only' || !/^rentmanager[-_][a-z0-9_-]+[-_]test(?:[-_][a-z0-9_-]+)?$/.test(env.RENTMANAGER_TEST_ID || '') || !/^\/rentmanager_[a-z0-9_]*test$/.test(url.pathname)) throw new Error('Isolated test identity required');
  return { id: env.RENTMANAGER_TEST_ID!, database: decodeURIComponent(url.pathname.slice(1)) };
}
export async function assertTestDatabase(pool: Pool) {
  const expected = testConfiguration();
  const result = await pool.query("SELECT current_database() AS database, (SELECT value FROM app_environment WHERE key='purpose') AS purpose, (SELECT value FROM app_environment WHERE key='test_id') AS test_id");
  const row = result.rows[0];
  if (row.database !== expected.database || row.purpose !== 'rentmanager-test' || row.test_id !== expected.id) throw new Error('Test database marker mismatch');
}
