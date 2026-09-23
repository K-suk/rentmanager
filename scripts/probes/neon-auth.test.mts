import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Network-free child process tests: a fetch stub throws before any unexpected URL
// or POST. Canary strings model secrets; none may reach stdout or stderr.
const script = new URL('./neon-auth.mts', import.meta.url).pathname;
const canary = 'SECRET_CANARY_MUST_NOT_BE_LOGGED';
function run(mode: string, scenario: string, overrides: Record<string, string> = {}) {
  const preload = `
  const scenario = ${JSON.stringify(scenario)};
  const secret = ${JSON.stringify(canary)};
  let password = secret;
  let name = 'Original fixture';
  let passwordChanges = 0;
  let profileChanges = 0;
  const fixture = () => ({id: 'fixture-id', email: 'rm-probe-test@example.com', name});
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    let data;
    if (scenario === 'network-error') throw new Error(secret);
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      if (path.endsWith('/sign-in/email') && !scenario.includes('signup')) {
        if (body.password !== password) return Response.json({error: secret}, {status: 401});
        return Response.json({user: {...fixture(), id: scenario === 'wrong-user' ? 'someone-else' : 'fixture-id'}}, {
          headers: scenario === 'empty-cookie' ? {} : {'set-cookie': 'session=' + secret + '; HttpOnly; Secure; SameSite=Lax'}
        });
      }
      if (path.endsWith('/change-password') && scenario.startsWith('password-')) {
        passwordChanges++;
        if (body.currentPassword !== password) return Response.json({error: secret}, {status: 401});
        if (passwordChanges === 2 && scenario === 'password-restore-fails') return Response.json({error: secret}, {status: 500});
        password = body.newPassword;
        return Response.json({token: secret});
      }
      if (path.endsWith('/update-user') && scenario.startsWith('profile-')) {
        profileChanges++;
        if (profileChanges !== 2 || scenario !== 'profile-restore-lies') name = body.name;
        return Response.json({token: secret});
      }
      if (!['accepted-signup', 'rejected-signup'].includes(scenario) || !path.endsWith('/sign-up/email')) {
        console.error('UNEXPECTED_POST'); throw new Error(secret);
      }
      return new Response(JSON.stringify({ token: secret, password: secret }), {
        status: scenario === 'accepted-signup' ? 200 : 403,
        headers: { 'set-cookie': 'session=' + secret }
      });
    }
    if (path === '/api/v2/projects/test-project') data = {project: {id: 'test-project', name: scenario === 'wrong-project' ? 'other-project' : 'rentmanager'}};
    else if (path.endsWith('/branches/br-probe')) data = {branch: {id: 'br-probe', name: scenario === 'wrong-branch' ? 'production' : 'rentmanager-auth-probe-test', default: scenario === 'default-branch'}};
    else if (path.endsWith('/email_and_password')) data = {enabled: true, disable_sign_up: true, require_email_verification: false, send_verification_email_on_sign_up: scenario === 'email-enabled', send_verification_email_on_sign_in: false};
    else if (path.endsWith('/auth') && path.startsWith('/api/')) data = {auth_provider: 'better_auth', base_url: scenario === 'wrong-url' ? 'https://other.neon.tech/auth' : 'https://test.neon.tech/auth'};
    else if (path.endsWith('/open-api/generate-schema')) data = {paths: {'/sign-up/email': {}}};
    else if (path.endsWith('/get-session')) data = {user: fixture(), session: {token: secret}};
    else { console.error('UNEXPECTED_URL'); throw new Error(secret); }
    return new Response(JSON.stringify({...data, token: secret, password: secret}));
  };`;
  const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, script, mode], {
    encoding: 'utf8', env: { PATH: process.env.PATH,
      NEON_API_KEY: canary, NEON_PROJECT_ID: 'test-project', NEON_BRANCH_ID: 'br-probe',
      NEON_AUTH_BASE_URL: 'https://test.neon.tech/auth', PROBE_ORIGIN: 'http://localhost:3101',
      PROBE_EMAIL: 'rm-probe-test@example.com', PROBE_PASSWORD: canary, PROBE_USER_ID: 'fixture-id',
      PROBE_DISPOSABLE_BRANCH_ACK: 'rentmanager-auth-probe-only', ...overrides },
  });
  assert.ok(!result.stdout.includes(canary) && !result.stderr.includes(canary));
  assert.ok(!result.stderr.includes('UNEXPECTED_'));
  return result;
}
for (const scenario of ['wrong-project', 'wrong-branch', 'default-branch', 'wrong-url', 'email-enabled', 'network-error']) {
  test(`abort without POST or secret output: ${scenario}`, () => {
    const r = run('signup', scenario);
    assert.equal(r.status, 2);
    assert.match(r.stdout, /"check":"aborted"/);
  });
}
test('missing explicit mutation acknowledgment fails closed', () => {
  assert.equal(run('signup', 'safe', { PROBE_DISPOSABLE_BRANCH_ACK: '' }).status, 2);
});
test('inspection is read-only and never declares behavioral success', () => {
  const r = run('inspect', 'safe');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /read_only_configuration_is_not_behavior/);
});
test('successful forbidden signup is a failure; response secrets remain private', () => {
  const r = run('signup', 'accepted-signup');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL_ACCEPTED/);
});
test('403 alone is not proof of registration policy', () => {
  const r = run('signup', 'rejected-signup');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /UNVERIFIED_REJECTION/);
});
for (const scenario of ['wrong-user', 'empty-cookie']) {
  test(`refuse changes without a verified fixture session: ${scenario}`, () => {
    const r = run('password', scenario);
    assert.equal(r.status, 2);
    assert.match(r.stdout, /"check":"aborted"/);
    assert.doesNotMatch(r.stdout, /direct_password_change/);
  });
}
test('password attack proves changed login and restores original credential', () => {
  const r = run('password', 'password-success');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /"check":"changed_password_login","status":200,"accepted":true/);
  assert.match(r.stdout, /"check":"restore_password","status":200,"restored":true/);
});
test('failed password restoration is machine visible and never reports success', () => {
  const r = run('password', 'password-restore-fails');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /"check":"restore_password","status":500,"restored":false/);
});
test('profile restoration requires fresh readback, not merely a 200 response', () => {
  const r = run('profile', 'profile-restore-lies');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /"check":"restore_profile","status":200,"restored":false/);
});
test('profile restoration verifies original profile through readback', () => {
  const r = run('profile', 'profile-success');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /"check":"restore_profile","status":200,"restored":true/);
});
test('deletion refuses to start unless email non-delivery has been attested', () => {
  const r = run('delete', 'safe', { PROBE_DELETE_FIXTURE_ACK: 'delete-only-this-disposable-fixture' });
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stdout, /direct_login/);
});
