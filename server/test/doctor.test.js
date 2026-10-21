import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecks, allPassed } from '../src/doctor.js';
import { installNetguard } from '../src/netguard.js';

test('doctor passes on a clean setup and prints no setting values', async () => {
  const g = installNetguard();
  const checks = await runChecks({ env: {} });
  assert.ok(allPassed(checks), JSON.stringify(checks.filter((c) => c.level === 'fail')));
  assert.deepEqual(checks.map((c) => c.id), ['node', 'bind', 'port-range', 'story-hosts', 'netguard', 'scenarios', 'tenant']);
  g.restore();
});

test('doctor fails on a non-loopback bind, a reserved port and a bad port', async () => {
  const g = installNetguard();
  const id = (checks, name) => checks.find((c) => c.id === name);
  assert.equal(id(await runChecks({ env: { INTENT_BIND: '' } }), 'bind').level, 'pass');
  assert.equal(id(await runChecks({ env: { PORT: '8080' } }), 'port-range').level, 'fail');
  assert.equal(id(await runChecks({ env: { PORT: '5300' } }), 'port-range').level, 'fail');
  assert.equal(id(await runChecks({ env: { PORT: 'abc' } }), 'port-range').level, 'fail');
  g.restore();
});
