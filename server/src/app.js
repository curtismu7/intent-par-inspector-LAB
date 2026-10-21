// One Express app. /api = demo API (catalog, run a story), /as + /rs = the live mock authorization and resource server,
// for curl and Postman. Loopback Host check and same-origin writes on everything. Serves web/dist when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites, scanHosts } from './safety.js';
import { createHealth } from './health.js';
import { randomBytes } from 'node:crypto';
import { createMockAS, CLIENTS, ISSUER, PAR_TTL_S, pkceChallenge } from './as.js';
import { runScenario, runAll } from './runner.js';
import { SCENARIOS, VERTICALS, getScenario, getVertical, storyCorpus, renderScenario, baseIntent } from './stories.js';

const WEB_DIST = process.env.WEB_DIST || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, message, status = 400) => res.status(status).json({ error: status === 404 ? 'not_found' : 'bad_request', message });

export function createApp({ health = createHealth(), as: initialAs = createMockAS() } = {}) {
  let as = initialAs; // POST /api/reset swaps in a fresh one
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '8kb' }));
  api.use('/health', health.router);
  api.get('/catalog', (req, res) => {
    const v = getVertical(req.query.vertical || VERTICALS[0].id);
    if (!v) return bad(res, 'unknown vertical');
    res.json({
      verticals: VERTICALS.map(({ id, name, cast }) => ({ id, name, cast })),
      vertical: v.id, intent: baseIntent(v), issuer: ISSUER, parTtlSeconds: PAR_TTL_S,
      clients: Object.entries(CLIENTS).map(([id, c]) => ({ id, name: c.name, requirePar: c.require_par, redirectUri: c.redirect_uris[0] })),
      scenarios: SCENARIOS.map((s) => { const r = renderScenario(s, v); return { id: r.id, slug: r.slug, kind: r.kind, title: r.title, takeaway: r.takeaway, expectedOutcome: r.outcome, steps: r.steps.length }; }),
    });
  });
  // Hand-driven builder: a fresh PKCE pair plus the chosen mock client's throwaway credentials, so the SE can push a request and
  // see client authentication in the raw message. The catalog itself never carries secrets. Mock clients only; the secret means nothing elsewhere.
  api.get('/builder', (req, res) => {
    const id = req.query.client || 'agent-app';
    const c = CLIENTS[id];
    if (!c) return bad(res, 'unknown client');
    const verifier = randomBytes(32).toString('base64url');
    res.json({ client_id: id, client_secret: c.secret, redirect_uri: c.redirect_uris[0], code_verifier: verifier, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256', mock: true });
  });
  api.post('/run', (req, res) => {
    const { scenario, vertical = VERTICALS[0].id } = req.body || {};
    if (typeof scenario !== 'string' || !getScenario(scenario)) return bad(res, 'scenario must be a known id or slug');
    if (typeof vertical !== 'string' || !getVertical(vertical)) return bad(res, 'unknown vertical');
    res.json(runScenario(scenario, vertical));
  });
  api.post('/run-all', (req, res) => {
    const { vertical = VERTICALS[0].id } = req.body || {};
    if (typeof vertical !== 'string' || !getVertical(vertical)) return bad(res, 'unknown vertical');
    const results = runAll(vertical);
    res.json({ vertical, total: results.length, passed: results.filter((r) => r.pass).length, results });
  });
  // Reset: forget every pushed request, code and spent token, and mint a new throwaway key. Same-origin writes only (middleware above).
  api.post('/reset', (_req, res) => { as = createMockAS(); res.json({ ok: true, reset: 'mock authorization server state cleared' }); });
  api.get('/safety-scan', (_req, res) => {
    const offenders = storyCorpus().map(({ where, text }) => ({ where, hosts: scanHosts(text) })).filter((x) => x.hosts.length);
    res.json({ ok: offenders.length === 0, offenders });
  });
  api.use((_req, res) => bad(res, 'no such endpoint', 404));
  api.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
    if (err.type === 'entity.parse.failed') return bad(res, 'request body is not valid JSON');
    console.error('[intent-par-inspector] api error:', err.message);
    return res.status(500).json({ error: 'server_error' });
  });
  app.use('/api', api);

  // The live mock AS/RS. Form or JSON bodies, as a real AS would take (forms) and as Postman users prefer (JSON).
  const mock = express.Router();
  mock.use(express.urlencoded({ extended: false, limit: '8kb' }), express.json({ limit: '8kb' }));
  mock.all(['/as/par', '/as/authorize', '/as/consent', '/as/token', '/as/jwks', '/rs/execute'], (req, res) => {
    const out = as.handle({ method: req.method, path: req.path, query: req.query, headers: req.headers, body: req.body || {} });
    res.status(out.status).set(out.headers).json(out.body);
  });
  mock.use((err, _req, res, _next) => (!(err.status >= 400 && err.status < 500) ? res.status(500).json({ error: 'server_error', reason: 'internal', error_description: 'the mock server hit an unexpected error' }) : res.status(err.status).json({ error: 'invalid_request', reason: 'unparseable_body', error_description: 'request body could not be parsed' })));
  app.use(mock);

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/|as\/|rs\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
