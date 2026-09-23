import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
let instance: Pool | undefined;
export function db() {
  if (!instance) {
    const value = process.env.DATABASE_URL;
    if (!value || !process.env.RENTMANAGER_DB_HOST) throw new Error('Database configuration missing');
    const url = new URL(value);
    if (url.hostname !== process.env.RENTMANAGER_DB_HOST || !url.hostname.endsWith('.neon.tech')) throw new Error('Database scope mismatch');
    // Never let URL sslmode downgrade certificate validation.
    url.searchParams.delete('sslmode'); url.searchParams.delete('channel_binding');
    instance = new Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: true }, max: 4, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000 });
    if(process.env.VERCEL === '1') attachDatabasePool(instance);
    instance.on('error', () => console.error('database_pool_error'));
  }
  return instance;
}
export function origin() {
  const value = process.env.BETTER_AUTH_URL;
  if (!value) throw new Error('Auth origin missing');
  const url = new URL(value);
  if (url.origin !== value || (url.protocol !== 'https:' && !(url.hostname === 'localhost' && /^310[1-9]$/.test(url.port) && process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1'))) throw new Error('Auth origin invalid');
  return value;
}
export function secret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error('Auth secret missing');
  return value;
}
