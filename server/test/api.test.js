import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installNetguard } from '../src/netguard.js';
import { withServer, rawHttp, parBody, VERIFIER } from './helpers.js';
import { CLIENTS } from '../src/as.js';

let guard;
before(() => { guard = installNetguard(); });
after(() => { assert.deepEqual(guard.attempts, [], 'the app tried to leave the machine'); guard.restore(); });

const json = (r) => r.json();
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('GET /api/health is demo-health/1, no-store, nothing extra', async () => {
  await withServer(async (base) => {
    const r = await fetch(`${base}/api/health`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const b = await r.json();
    assert.deepEqual(Object.keys(b).sort(), ['at', 'demo', 'runtime', 'schema', 'state']);
    assert.equal(b.schema, 'demo-health/1'); assert.equal(b.state, 'ready'); assert.equal(b.runtime, 'offline');
    assert.deepEqual(Object.keys(b.demo).sort(), ['id', 'name', 'version']);
    assert.equal(b.demo.id, 'intent-par-inspector'); assert.ok(b.demo.name.length <= 80 && b.demo.id.length <= 64);
    assert.ok(JSON.stringify(b).length < 4096);
    assert.ok(!Number.isNaN(Date.parse(b.at)));
    const w = await fetch(`${base}/api/health`, { method: 'POST' });
    assert.equal(w.status, 405); assert.equal(w.headers.get('allow'), 'GET');
  });
});

test('health reports broken when a check fails, unknown when checks throw', async () => {
  const { createHealth } = await import('../src/health.js');
  const broken = createHealth({ runChecks: async () => [{ id: 'x', level: 'fail', detail: 'd' }], intervalMs: 3_600_000 });
  await broken.ready; broken.stop();
  const get = (h) => new Promise((res) => h.router.handle({ method: 'GET', url: '/', headers: {}, get() {} }, { set() {}, json: res, status() { return this; } }, () => {}));
  assert.equal((await get(broken)).state, 'broken');
  const boom = createHealth({ runChecks: async () => { throw new Error('x'); }, intervalMs: 3_600_000 });
  await boom.ready; boom.stop();
  assert.equal((await get(boom)).state, 'unknown');
});

test('catalog: verticals, scenarios and clients', async () => {
  await withServer(async (base) => {
    const b = await fetch(`${base}/api/catalog?vertical=banking`).then(json);
    assert.equal(b.vertical, 'banking'); assert.equal(b.scenarios.length, 15); assert.equal(b.verticals.length, 3);
    assert.equal(b.clients.find((c) => c.id === 'legacy-web').requirePar, false);
    assert.ok(!JSON.stringify(b).includes('mock-secret'), 'catalog must not carry client secrets');
    assert.equal((await fetch(`${base}/api/catalog?vertical=zzz`)).status, 400);
  });
});

test('POST /api/run returns the trace; bad input is 400', async () => {
  await withServer(async (base) => {
    const r = await post(`${base}/api/run`, { scenario: 'S08', vertical: 'travel' }).then(json);
    assert.equal(r.verdict, 'blocked'); assert.equal(r.blockedAt.reason, 'request_uri_reused');
    assert.equal((await post(`${base}/api/run`, { scenario: 'S99' })).status, 400);
    assert.equal((await post(`${base}/api/run`, { scenario: 'S01', vertical: 'zz' })).status, 400);
    assert.equal((await post(`${base}/api/run`, { scenario: { $ne: 1 } })).status, 400);
    const bad = await fetch(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(bad.status, 400);
    const all = await post(`${base}/api/run-all`, { vertical: 'retail' }).then(json);
    assert.deepEqual([all.total, all.passed], [15, 15]);
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  });
});

test('live mock AS over HTTP: form-encoded PAR -> authorize -> consent -> token -> execute', async () => {
  await withServer(async (base) => {
    const form = (o) => new URLSearchParams(o).toString();
    const par = await fetch(`${base}/as/par`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(parBody()) });
    assert.equal(par.status, 201);
    const { request_uri } = await par.json();
    const az = await fetch(`${base}/as/authorize?${form({ client_id: 'agent-app', request_uri })}`).then(json);
    assert.equal(az.binding, 'par');
    const again = await fetch(`${base}/as/authorize?${form({ client_id: 'agent-app', request_uri })}`);
    assert.equal(again.status, 400); assert.equal((await again.json()).reason, 'request_uri_reused');
    const cs = await post(`${base}/as/consent`, { txn: az.txn, decision: 'approve', approved_intent_hash: az.intent_hash }).then(json);
    const tk = await fetch(`${base}/as/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ client_id: 'agent-app', client_secret: CLIENTS['agent-app'].secret, grant_type: 'authorization_code', code: cs.code, redirect_uri: CLIENTS['agent-app'].redirect_uris[0], code_verifier: VERIFIER }) }).then(json);
    assert.ok(tk.access_token);
    const i = az.intent;
    const ex = await post(`${base}/rs/execute`, { action: i.action, amount: i.amount, currency: i.currency, resource: i.resource }, { authorization: `Bearer ${tk.access_token}` });
    assert.equal(ex.status, 200);
    const nope = await fetch(`${base}/rs/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(nope.status, 401); assert.match(nope.headers.get('www-authenticate'), /Bearer/);
    const jwks = await fetch(`${base}/as/jwks`).then(json);
    assert.equal(jwks.keys[0].d, undefined);
    const junk = await fetch(`${base}/as/par`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
    assert.equal(junk.status, 400);
  });
});

test('Host check: a non-loopback Host header is refused on every route (DNS rebinding)', async () => {
  await withServer(async (base) => {
    for (const path of ['/api/health', '/api/catalog', '/api/builder', '/as/jwks']) {
      const r = await rawHttp(`${base}${path}`, { headers: { host: 'rebind.example.invalid' } });
      assert.equal(r.status, 403, path);
    }
    assert.equal((await rawHttp(`${base}/api/health`, { headers: { host: `localhost:${new URL(base).port}` } })).status, 200);
  });
});

test('same-origin writes: cross-origin and cross-site POSTs are refused, with no side effect', async () => {
  await withServer(async (base) => {
    const port = new URL(base).port;
    const body = JSON.stringify({ scenario: 'S01' });
    const h = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) };
    for (const extra of [{ origin: 'http://evil.example.invalid' }, { origin: 'null' }, { origin: `http://localhost:${Number(port) + 1}` }, { 'sec-fetch-site': 'cross-site' }]) {
      const r = await rawHttp(`${base}/api/run`, { method: 'POST', headers: { host: `localhost:${port}`, ...h, ...extra }, body });
      assert.equal(r.status, 403, JSON.stringify(extra));
      const a = await rawHttp(`${base}/as/par`, { method: 'POST', headers: { host: `localhost:${port}`, ...h, ...extra }, body });
      assert.equal(a.status, 403, `as/par ${JSON.stringify(extra)}`);
    }
    const ok = await rawHttp(`${base}/api/run`, { method: 'POST', headers: { host: `localhost:${port}`, ...h, origin: `http://localhost:${port}` }, body });
    assert.equal(ok.status, 200);
  });
});

test('oversized body is 413 and the server stays up', async () => {
  await withServer(async (base) => {
    const r = await post(`${base}/api/run`, { scenario: 'S01', pad: 'x'.repeat(20000) });
    assert.equal(r.status, 413);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  });
});

test('security headers: no x-powered-by, nosniff', async () => {
  await withServer(async (base) => {
    const r = await fetch(`${base}/api/health`);
    assert.equal(r.headers.get('x-powered-by'), null);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });
});

test('builder: fresh PKCE pair and mock client credentials; the pair is valid at the mock AS; unknown client refused', async () => {
  await withServer(async (base) => {
    const a = await fetch(`${base}/api/builder?client=partner-app`).then((r) => r.json());
    const b = await fetch(`${base}/api/builder?client=partner-app`).then((r) => r.json());
    assert.equal(a.client_id, 'partner-app');
    assert.equal(a.mock, true);
    assert.notEqual(a.code_verifier, b.code_verifier);
    assert.equal(a.code_challenge, (await import('../src/as.js')).pkceChallenge(a.code_verifier));
    assert.equal((await fetch(`${base}/api/builder?client=nope`)).status, 400);
    const cat = await fetch(`${base}/api/catalog`).then((r) => r.json());
    assert.ok(cat.clients.every((c) => c.redirectUri && c.secret === undefined));
    const par = await fetch(`${base}/as/par`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      client_id: a.client_id, client_secret: a.client_secret, response_type: 'code', redirect_uri: a.redirect_uri, scope: 'intent',
      code_challenge: a.code_challenge, code_challenge_method: 'S256', intent: { action: 'payments.transfer', amount: 5, currency: 'USD', resource: 'https://bank.example.invalid/a' } }) });
    assert.equal(par.status, 201);
  });
});

test('POST /api/reset forgets pushed request_uris and spent state; cross-origin reset is refused', async () => {
  const { parBody } = await import('./helpers.js');
  await withServer(async (base) => {
    const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const par = await (await post('/as/par', parBody())).json();
    assert.match(par.request_uri, /^urn:/);
    const evil = await post('/api/reset', {}, { origin: 'https://evil.example.invalid' });
    assert.ok(evil.status >= 400, 'cross-origin reset refused');
    const ok = await post('/api/reset', {});
    assert.equal(ok.status, 200);
    const authz = await fetch(`${base}/as/authorize?client_id=agent-app&request_uri=${encodeURIComponent(par.request_uri)}`);
    assert.ok(authz.status >= 400, 'request_uri pushed before the reset is gone');
  });
});

test('POST /as/par with an inherited-key client_id is 401 invalid_client, not a misleading 400', async () => {
  await withServer(async (base) => {
    const r = await fetch(`${base}/as/par`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: 'client_id=constructor&client_secret=undefined&response_type=code' });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, 'invalid_client');
  });
});
