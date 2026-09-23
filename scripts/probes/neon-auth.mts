/** Node >=22.18; no dependencies. Never print response bodies or credentials. */
import { randomBytes, randomUUID } from 'node:crypto';

type Json = Record<string, any>;
type Result = { status: number; data: Json; cookies: string[] };
const mode = process.argv[2] ?? 'inspect';
const allowed = ['inspect', 'signup', 'login', 'profile', 'password', 'delete', 'admin-create'];
const output = (check: string, fields: Json) => console.log(JSON.stringify({ check, ...fields }));
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('configuration');
  return value;
}
function ensure(condition: unknown): asserts condition {
  if (!condition) throw new Error('precondition');
}
async function http(url: string, body?: Json, headers: Record<string, string> = {}): Promise<Result> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  let data: Json = {};
  try { data = await response.json(); } catch { /* Report status, never raw HTML. */ }
  return { status: response.status, data: data ?? {}, cookies: response.headers.getSetCookie() };
}
const ok = (r: Result) => r.status >= 200 && r.status < 300;
// Do not call an arbitrary 4xx a policy success: invalid bodies, CSRF, stale cookies,
// unavailable paths, and rate limits all require separate diagnosis.
function attackResult(name: string, r: Result) {
  output(name, { status: r.status, verdict: ok(r) ? 'FAIL_ACCEPTED' : 'UNVERIFIED_REJECTION' });
  process.exitCode = ok(r) ? 1 : 2;
}

async function main() {
  ensure(allowed.includes(mode));
  const project = required('NEON_PROJECT_ID');
  const branch = required('NEON_BRANCH_ID');
  ensure(/^[a-z0-9-]+$/.test(project) && /^br-[a-z0-9-]+$/.test(branch));
  const management = `https://console.neon.tech/api/v2/projects/${project}`;
  const managementHeaders = { Authorization: `Bearer ${required('NEON_API_KEY')}` };
  // Read-only control-plane attestation; no project/branch creation or updates.
  const p = await http(management, undefined, managementHeaders);
  const b = await http(`${management}/branches/${branch}`, undefined, managementHeaders);
  ensure(ok(p) && ok(b));
  ensure(p.data.project?.id === project && p.data.project?.name === 'rentmanager');
  ensure(b.data.branch?.id === branch);
  ensure(/^rentmanager-auth-probe-[a-z0-9-]+$/.test(b.data.branch?.name ?? ''));
  ensure(b.data.branch?.default === false);
  const root = `${management}/branches/${branch}/auth`;
  const a = await http(root, undefined, managementHeaders);
  ensure(ok(a) && a.data.auth_provider === 'better_auth');
  const base = required('NEON_AUTH_BASE_URL').replace(/\/$/, '');
  ensure(a.data.base_url?.replace(/\/$/, '') === base);
  const url = new URL(base);
  ensure(url.protocol === 'https:' && url.hostname.endsWith('.neon.tech'));
  ensure(!url.username && !url.password && !url.search && !url.hash);
  output('scope', { dedicatedProject: true, disposableNonDefaultBranch: true, authUrlMatches: true });

  const c = await http(`${root}/email_and_password`, undefined, managementHeaders);
  ensure(ok(c));
  const config = c.data;
  const flags = ['enabled', 'disable_sign_up', 'require_email_verification',
    'send_verification_email_on_sign_up', 'send_verification_email_on_sign_in'];
  output('email_password_configuration', Object.fromEntries(flags.map(k => [k,
    typeof config[k] === 'boolean' ? config[k] : 'unknown'])));
  const schema = await http(`${base}/open-api/generate-schema`);
  const paths = ['/sign-up/email', '/sign-in/email', '/update-user', '/change-password',
    '/change-email', '/delete-user', '/admin/create-user', '/admin/remove-user',
    '/admin/set-user-password', '/request-password-reset', '/send-verification-email'];
  output('endpoint_inventory', { status: schema.status,
    paths: Object.fromEntries(paths.map(path => [path, Boolean(schema.data.paths?.[path])])) });
  if (mode === 'inspect') {
    output('overall', { verdict: 'UNVERIFIED', reason: 'read_only_configuration_is_not_behavior' });
    return;
  }
  ensure(required('PROBE_DISPOSABLE_BRANCH_ACK') === 'rentmanager-auth-probe-only');
  // These prevent accidental email during sign-in/signup; they do not prove all
  // reset/OTP/invitation endpoints are disabled. Do not send those requests here.
  ensure(config.enabled === true && config.require_email_verification === false);
  ensure(config.send_verification_email_on_sign_up === false && config.send_verification_email_on_sign_in === false);
  if (mode === 'delete') {
    ensure(required('PROBE_DELETE_FIXTURE_ACK') === 'delete-only-this-disposable-fixture');
    ensure(required('PROBE_NO_EMAIL_POLICY_ACK') === 'verified-no-email-delivery');
  }
  const origin = required('PROBE_ORIGIN');
  ensure(new URL(origin).origin === origin);
  const originMode = process.env.PROBE_ORIGIN_MODE ?? 'trusted';
  ensure(['trusted', 'omit', 'untrusted'].includes(originMode));
  const headers: Record<string, string> = originMode === 'omit' ? {} : {
    Origin: originMode === 'untrusted' ? 'https://probe.invalid' : origin,
  };
  const request = (path: string, body?: Json, cookie = '') => http(`${base}${path}`, body,
    { ...headers, ...(cookie ? { Cookie: cookie } : {}) });
  const password = randomBytes(24).toString('base64url');
  const newEmail = `rm-probe-${randomUUID()}@example.com`;
  if (mode === 'signup') {
    const r = await request('/sign-up/email', { email: newEmail, password, name: 'Disposable probe' });
    attackResult('direct_signup', r);
    output('cleanup', { disposableBranchMayContainNewFixture: ok(r), automaticCleanup: false });
    return;
  }
  const email = required('PROBE_EMAIL');
  const currentPassword = required('PROBE_PASSWORD');
  const userId = required('PROBE_USER_ID');
  ensure(/^rm-probe-[a-z0-9-]+@example\.com$/.test(email));
  const signedIn = await request('/sign-in/email', { email, password: currentPassword });
  ensure(ok(signedIn) && signedIn.data.user?.id === userId && signedIn.data.user?.email === email);
  const cookie = signedIn.cookies.map(v => v.split(';')[0]).join('; ');
  ensure(cookie.length > 0);
  const session = await request('/get-session', undefined, cookie);
  ensure(ok(session) && session.data.user?.id === userId);
  output('direct_login', { status: signedIn.status, sessionValidated: true, originMode,
    cookieAttributes: signedIn.cookies.map(v => ({
      httpOnly: /;\s*httponly(?:;|$)/i.test(v), secure: /;\s*secure(?:;|$)/i.test(v),
      sameSite: /;\s*samesite=(strict|lax|none)/i.exec(v)?.[1]?.toLowerCase() ?? 'absent',
    })) });
  if (mode === 'login') return;
  if (mode === 'profile') {
    const r = await request('/update-user', { name: 'Disposable changed probe' }, cookie);
    attackResult('direct_profile_update', r);
    if (ok(r)) {
      const restore = await request('/update-user', { name: signedIn.data.user.name }, cookie);
      const readback = await request('/get-session?disableCookieCache=true', undefined, cookie);
      output('restore_profile', { status: restore.status, restored: ok(restore) && ok(readback)
        && readback.data.user?.id === userId && readback.data.user?.name === signedIn.data.user.name });
    }
  } else if (mode === 'password') {
    const r = await request('/change-password', { currentPassword, newPassword: password, revokeOtherSessions: false }, cookie);
    attackResult('direct_password_change', r);
    if (ok(r)) {
      const test = await request('/sign-in/email', { email, password });
      output('changed_password_login', { status: test.status, accepted: ok(test) && test.data.user?.id === userId });
      const updatedCookie = test.cookies.map(v => v.split(';')[0]).join('; ') || cookie;
      const restore = await request('/change-password', { currentPassword: password, newPassword: currentPassword, revokeOtherSessions: false }, updatedCookie);
      const restoredLogin = await request('/sign-in/email', { email, password: currentPassword });
      output('restore_password', { status: restore.status, restored: ok(restore) && ok(restoredLogin) && restoredLogin.data.user?.id === userId });
    }
  } else if (mode === 'delete') {
    const r = await request('/delete-user', { password: currentPassword }, cookie);
    attackResult('direct_self_delete', r);
    const test = await request('/sign-in/email', { email, password: currentPassword });
    output('post_delete_login', { status: test.status, accepted: ok(test) });
  } else if (mode === 'admin-create') {
    const r = await request('/admin/create-user', { email: newEmail, password, name: 'Disposable created probe', role: 'user' }, cookie);
    output('direct_admin_create', { status: r.status, accepted: ok(r) });
    if (!ok(r)) process.exitCode = 2;
    if (ok(r)) {
      const test = await request('/sign-in/email', { email: newEmail, password });
      output('created_user_login_without_verification', { status: test.status,
        accepted: ok(test) && Boolean(test.data.user?.id) });
      if (!ok(test) || !test.data.user?.id) process.exitCode = 2;
    }
    output('cleanup', { disposableBranchMayContainNewFixture: ok(r), automaticCleanup: false });
  }
}

main().catch(() => {
  // Exceptions can contain URLs, credentials, or response bodies. Never serialize them.
  output('aborted', { verdict: 'UNVERIFIED', reason: 'configuration_scope_network_or_precondition' });
  process.exitCode = 2;
});
