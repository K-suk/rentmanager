import { allowedAuthPaths, auth } from '../../../../lib/auth.ts';
import { csrf, clientIP, employee, failure, json, jsonBody, rateLimit } from '../../../../lib/security.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try {
    const path = new URL(request.url).pathname.slice('/api/auth'.length);
    if (!allowedAuthPaths.has(path)) return json({error:'ENDPOINT_DISABLED'},403);
    if ((path === '/get-session') !== (request.method === 'GET')) return json({error:'METHOD_NOT_ALLOWED'},405);
    if (request.method === 'POST') csrf(request);
    if (path === '/get-session') return json({employee:await employee(request.headers)});
    if (path === '/sign-in/email') await rateLimit('login', clientIP(request));
    const body = await jsonBody(request);
    const result = await auth().handler(new Request(request.url, {method: request.method, headers: request.headers, body: JSON.stringify(body)}));
    // Session tokens stay exclusively in HttpOnly cookies, never JSON.
    const headers = new Headers({'Cache-Control':'no-store'});
    for (const cookie of result.headers.getSetCookie()) headers.append('Set-Cookie',cookie);
    return Response.json(result.ok ? {ok:true} : {error:'AUTHENTICATION_FAILED'}, {status:result.status,headers});
  } catch(error) { return failure(error); }
}
export const GET=handle; export const POST=handle;
