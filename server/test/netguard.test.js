import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { installNetguard, netguardSelfTest } from '../src/netguard.js';

test('self-test: every route out is refused and recorded, none reaches the network', async () => {
  const r = await netguardSelfTest();
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.blocked, 5);
  assert.match(r.detail, /fetch: blocked.*socket: blocked.*socket-ip: blocked.*dns: blocked.*udp: blocked/);
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

test('raw IP-literal sockets are refused and recorded as socket:<ip>', async () => {
  const g = installNetguard();
  assert.throws(() => net.connect({ host: '192.0.2.1', port: 80 }), /network blocked: 192\.0\.2\.1/);
  assert.throws(() => net.connect(80, '192.0.2.2'), /network blocked: 192\.0\.2\.2/);
  assert.throws(() => http.get({ host: '192.0.2.3', port: 80 }), /network blocked: 192\.0\.2\.3/);
  assert.deepEqual(g.attempts.filter((a) => a.startsWith('socket:')), ['socket:192.0.2.1', 'socket:192.0.2.2', 'socket:192.0.2.3']);
  g.restore();
});

test('a wildcard bind (container INTENT_BIND=0.0.0.0) can listen, but connecting to it is still refused', async () => {
  const g = installNetguard();
  const srv = net.createServer((c) => c.end());
  await new Promise((res, rej) => { srv.once('error', rej); srv.listen(0, '0.0.0.0', res); });
  const { port } = srv.address();
  assert.deepEqual(g.attempts, [], 'listening is not an outbound attempt');
  await assert.rejects(new Promise((res, rej) => { try { const s = net.connect({ host: '0.0.0.0', port }); s.on('error', rej); s.on('connect', res); } catch (e) { rej(e); } }), /network blocked/);
  assert.ok(g.attempts.includes('socket:0.0.0.0'));
  await new Promise((r) => srv.close(r));
  g.restore();
});
