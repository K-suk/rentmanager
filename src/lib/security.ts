import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { auth } from './auth.ts';
import { db, origin, secret } from './db.ts';
import { HttpError } from './errors.ts';
export { HttpError } from './errors.ts';
export function csrf(request: Request) {
  if (request.headers.get('origin') !== origin() || request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'ORIGIN_REJECTED');
}
export function clientIP(request: Request) {
  // Vercel overwrites x-vercel-forwarded-for. Never trust client x-forwarded-for.
  if (process.env.VERCEL === '1') {
    const ip = request.headers.get('x-vercel-forwarded-for')?.trim();
    if (!ip || !isIP(ip)) throw new HttpError(503, 'IP_UNAVAILABLE');
    return ip;
  }
  if (new URL(origin()).hostname === 'localhost') return 'local-loopback';
  throw new HttpError(503, 'HOST_UNVERIFIED');
}
export async function rateLimit(kind: 'login' | 'write', identity: string) {
  const key = createHmac('sha256', secret()).update(`${kind}:${identity}`).digest('hex');
  const seconds = kind === 'login' ? 300 : 60;
  const limit = kind === 'login' ? 20 : 60;
  const result = await db().query(`INSERT INTO app_rate_limit(key, count, expires_at) VALUES($1,1,now()+$2*interval '1 second')
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN app_rate_limit.expires_at<=now() THEN 1 ELSE app_rate_limit.count+1 END,
    expires_at=CASE WHEN app_rate_limit.expires_at<=now() THEN now()+$2*interval '1 second' ELSE app_rate_limit.expires_at END
    RETURNING count`, [key, seconds]);
  if (result.rows[0].count > limit) throw new HttpError(429, 'RATE_LIMITED');
  // Bounded opportunistic cleanup; no IP or credential is stored.
  await db().query('DELETE FROM app_rate_limit WHERE key IN (SELECT key FROM app_rate_limit WHERE expires_at < now() LIMIT 100)');
}
export async function employee(headers: Headers, admin = false) {
  const session = await auth().api.getSession({ headers });
  if (!session) throw new HttpError(401, 'UNAUTHENTICATED');
  const result = await db().query('SELECT auth_user_id AS id,name,email,role,active,protected FROM employee WHERE auth_user_id=$1 AND active', [session.user.id]);
  const row = result.rows[0] as { id: string; name: string; email: string; role: string; active: boolean; protected: boolean } | undefined;
  if (!row || (admin && row.role !== 'admin')) throw new HttpError(403, 'EMPLOYEE_FORBIDDEN');
  return row;
}
export async function jsonBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED');
  // Read with a hard cap, including chunked bodies.
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'INVALID_INPUT');
  const parts: Uint8Array[] = []; let length = 0;
  for (;;) { const {value, done} = await reader.read(); if(done) break; length += value.length; if(length > 8192) { await reader.cancel(); throw new HttpError(413, 'BODY_TOO_LARGE'); } parts.push(value); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new HttpError(400, 'INVALID_JSON'); }
}
export function json(data: unknown, status=200) { return Response.json(data, {status, headers:{'Cache-Control':'no-store'}}); }
export function failure(error: unknown) {
  if (error instanceof HttpError) return Response.json({error:error.code, ...(error.fields ? {fields:error.fields} : {})}, {status:error.status, headers:{'Cache-Control':'no-store', ...(error.status === 429 ? {'Retry-After':'300'} : {})}});
  const traceId=randomUUID(); console.error(JSON.stringify({time:new Date().toISOString(),operation:'request',traceId}));
  return json({error:'SERVICE_UNAVAILABLE',traceId},503);
}
