export function migrationScope() {
  if(process.env.RENTMANAGER_MIGRATE_ACK !== 'rentmanager-dedicated-only') throw new Error('Explicit migration scope required');
  if(!['rentmanager-app-dev','rentmanager-test','rentmanager-public'].includes(process.env.RENTMANAGER_ENVIRONMENT || '')) throw new Error('Environment required');
  const pooled=new URL(process.env.DATABASE_URL || 'invalid');
  const direct=new URL(process.env.DATABASE_URL_UNPOOLED || 'invalid');
  if(pooled.hostname !== process.env.RENTMANAGER_DB_HOST || direct.hostname !== pooled.hostname.replace('-pooler.','.') || direct.pathname !== pooled.pathname || direct.username !== pooled.username) throw new Error('Migration scope mismatch');
  process.env.DATABASE_URL=direct.toString();
  process.env.RENTMANAGER_DB_HOST=direct.hostname;
}
