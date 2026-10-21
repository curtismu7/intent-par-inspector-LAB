import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { installNetguard, netguardSelfTest } from '../src/netguard.js';

test('self-test: every route out is refused and recorded, none reaches the network', async () => {
  const r = await netguardSelfTest();
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.blocked, 4);
  assert.match(r.detail, /fetch: blocked.*socket: blocked.*dns: blocked.*udp: blocked/);
  installNetguard().restore();
});

test('a real outbound attempt is blocked and appears in attempts', async () => {
  const g = installNetguard();
  await assert.rejects(fetch('https://example.invalid/'), /network blocked/);
  await assert.rejects(new Promise((res, rej) => { const q = http.get('http://other.invalid/', res); q.on('error', rej); }), /network blocked|ENOTFOUND|blocked/);
  assert.ok(g.attempts.some((a) => a === 'fetch:example.invalid'));
  assert.ok(g.attempts.some((a) => a.includes('other.invalid')));
  g.restore();
});

test('loopback still works under the guard', async () => {
  const g = installNetguard();
  const server = http.createServer((_q, s) => s.end('ok'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(await res.text(), 'ok');
  await new Promise((r) => server.close(r));
  assert.deepEqual(g.attempts, []);
  g.restore();
});

test('restore puts the real functions back', async () => {
  const before = net.Socket.prototype.connect;
  const g = installNetguard();
  assert.notEqual(net.Socket.prototype.connect, before);
  g.restore();
  assert.equal(net.Socket.prototype.connect, before);
});
