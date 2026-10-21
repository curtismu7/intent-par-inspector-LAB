import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackHost, assertBindAllowed, bindHost, portProblem, resolvePort, isReservedHost, scanHosts, hostCheck, sameOriginWrites } from '../src/safety.js';

test('loopback names', () => {
  for (const h of ['localhost', '127.0.0.1', '127.9.9.9', '::1', '[::1]']) assert.ok(isLoopbackHost(h), h);
  for (const h of ['0.0.0.0', '192.168.1.5', 'example.com', 'localhost.evil.invalid']) assert.ok(!isLoopbackHost(h), h);
});

test('bind: loopback only unless INTENT_BIND is set', () => {
  assert.equal(bindHost({}), '127.0.0.1');
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /loopback only/);
  assert.equal(assertBindAllowed('127.0.0.1', {}), '127.0.0.1');
  assert.equal(assertBindAllowed('0.0.0.0', { INTENT_BIND: '0.0.0.0' }), '0.0.0.0');
});

test('ports: 4700-5299 only, never a reserved one', () => {
  assert.equal(portProblem(4771), null);
  assert.equal(portProblem(4700), null); assert.equal(portProblem(5299), null);
  for (const p of [8080, 5173, 3900, 4000, 4400, 4510, 4600, 4601, 18080, 19080, 19090, 4699, 5300, 5301, 5900]) assert.ok(portProblem(p), String(p));
  assert.ok(portProblem(NaN));
  assert.equal(resolvePort({}), 4771);
  assert.equal(resolvePort({ PORT: '4800' }), 4800);
  assert.throws(() => resolvePort({ PORT: '5300' }));
});

test('reserved hosts and the host scan', () => {
  assert.ok(isReservedHost('a.b.invalid')); assert.ok(isReservedHost('example.com')); assert.ok(!isReservedHost('sub.example.com'));
  assert.deepEqual(scanHosts('https://as.example.invalid/x and mail a@example.org and http://localhost:4771/'), []);
  assert.deepEqual(scanHosts('see https://real.com/x and 10.1.2.3'), ['10.1.2.3', 'real.com']);
});

const run = (mw, req) => { const out = {}; const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } }; mw(req, res, () => { out.next = true; }); return out; };

test('hostCheck refuses a non-loopback Host (DNS rebinding)', () => {
  assert.ok(run(hostCheck, { headers: { host: 'localhost:4771' } }).next);
  assert.ok(run(hostCheck, { headers: { host: '[::1]:4771' } }).next);
  assert.equal(run(hostCheck, { headers: { host: 'evil.example.invalid:4771' } }).status, 403);
  assert.equal(run(hostCheck, { headers: {} }).status, 403);
});

test('sameOriginWrites: GET passes, cross-origin and cross-site writes refused', () => {
  const h = { host: 'localhost:4771' };
  assert.ok(run(sameOriginWrites, { method: 'GET', headers: { ...h, origin: 'http://evil.example.invalid' } }).next);
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: h }).next, 'no Origin (curl) is allowed');
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'http://localhost:4771' } }).next);
  assert.equal(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'http://localhost:9999' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'null' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'DELETE', headers: { ...h, 'sec-fetch-site': 'cross-site' } }).status, 403);
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: { ...h, 'sec-fetch-site': 'same-origin' } }).next);
});
