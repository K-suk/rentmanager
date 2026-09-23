import test from 'node:test';
import assert from 'node:assert/strict';
import { dateOnly, jstToday, loanStatus, validateDueDate } from '../src/lib/dates.ts';
import { validateEquipment, validateEmployee, idempotencyKey } from '../src/lib/validation.ts';
import { testConfiguration } from '../scripts/db/test-guard.ts';
import { errorMessage } from '../src/lib/errors.ts';
test('JST due day 23:59 and next day 00:00; returned and extended state', () => {
  const before = new Date('2026-09-23T14:59:59.999Z'); const after = new Date('2026-09-23T15:00:00.000Z');
  assert.equal(jstToday(before), '2026-09-23'); assert.equal(jstToday(after), '2026-09-24');
  assert.equal(loanStatus('2026-09-23', null, before), 'active'); assert.equal(loanStatus('2026-09-23', null, after), 'overdue');
  assert.equal(loanStatus('2026-09-23', before, after), 'returned'); assert.equal(loanStatus('2026-09-25', null, after), 'active');
});
test('calendar validation rejects rolled dates and validates extension', () => {
  for (const day of ['2026-02-29', '2026-04-31', '2026-9-23', '0000-01-01', '2026-01-01T00:00:00Z']) assert.throws(() => dateOnly(day));
  assert.equal(dateOnly('2024-02-29'), '2024-02-29');
  const now = new Date('2026-09-23T12:00:00Z'); assert.equal(validateDueDate('2026-09-23', now), '2026-09-23');
  assert.throws(() => validateDueDate('2026-09-22', now)); assert.throws(() => validateDueDate('2026-09-23', now, '2026-09-23'));
});
test('FR bounds and normalization; never trim passwords', () => {
  assert.deepEqual(validateEquipment({ assetNumber: ' ab-01 ', name: ' PC ', category: 'パソコン' }), { assetNumber: 'AB-01', name: 'PC', category: 'パソコン', description: '' });
  for (const patch of [{assetNumber: 'a_1'}, {name: 'x'.repeat(101)}, {category: 'unknown'}, {description: 'x'.repeat(1001)}]) assert.throws(() => validateEquipment({assetNumber:'A', name:'PC', category:'その他', ...patch}));
  const base = {email:' TEST@EXAMPLE.COM ',name:' 社員 ',role:'employee',password:' 1234567890 '};
  assert.equal(validateEmployee(base).password, base.password); assert.equal(validateEmployee(base).email, 'test@example.com');
  for(const patch of [{email:'real@gmail.com'},{password:'x'.repeat(11)},{password:'x'.repeat(129)},{role:'owner'}, {name:''}]) assert.throws(()=>validateEmployee({...base,...patch}));
  assert.throws(()=>idempotencyKey('short')); assert.equal(idempotencyKey('a'.repeat(16)), 'a'.repeat(16));
  assert.ok(errorMessage('SERVICE_UNAVAILABLE').includes('再試行'));
});
test('destructive test guard rejects public/dev and incomplete identity', () => {
  const env = { DATABASE_URL:'postgres://test:unused@localhost/rentmanager_foundation_test', RENTMANAGER_ENVIRONMENT:'rentmanager-test', RENTMANAGER_TEST_ACK:'isolated-test-only', RENTMANAGER_TEST_ID:'rentmanager-foundation-test-20260923' };
  assert.equal(testConfiguration(env).database, 'rentmanager_foundation_test');
  for(const patch of [{RENTMANAGER_ENVIRONMENT:'rentmanager-public'}, {RENTMANAGER_ENVIRONMENT:'rentmanager-app-dev'}, {RENTMANAGER_TEST_ACK:''}, {RENTMANAGER_TEST_ID:''}, {DATABASE_URL:'postgres://test:unused@localhost/neondb'}]) assert.throws(()=>testConfiguration({...env,...patch}));
});
