// Runs a story against a fresh mock authorization server and records every message as a trace.
// Time is virtual: a "wait" step moves the mock clock, it never sleeps.
import { randomBytes } from 'node:crypto';
import { createMockAS, CLIENTS, ISSUER, RS_AUDIENCE, pkceChallenge } from './as.js';
import { intentHash } from './intent.js';
import { forgePayload, decodeJwt } from './jwt.js';
import { SCENARIOS, baseIntent, getScenario, getVertical, renderScenario } from './stories.js';

const EXPECTED_VERDICT = { completes: 'completed', blocked: 'blocked', 'attack-succeeds': 'attack-succeeded' };
const hex = (n) => randomBytes(n).toString('hex');
const ACTORS = { par: ['agent', 'as'], authorize: ['browser', 'as'], consent: ['browser', 'as'], token: ['agent', 'as'], execute: ['agent', 'rs'] };
const PATH = { par: '/as/par', authorize: '/as/authorize', consent: '/as/consent', token: '/as/token', execute: '/rs/execute' };
const METHOD = { par: 'POST', authorize: 'GET', consent: 'POST', token: 'POST', execute: 'POST' };

const form = (o) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])).toString();

function rawRequest({ method, path, query, headers, body, formBody }) {
  const qs = Object.keys(query || {}).length ? `?${form(query)}` : '';
  const lines = [`${method} ${path}${qs} HTTP/1.1`, 'Host: as.example.invalid', ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)];
  return `${lines.join('\n')}${formBody ? `\n\n${formBody}` : ''}`;
}
function rawResponse(r) {
  const reason = { 200: 'OK', 201: 'Created', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found' }[r.status] || '';
  return `HTTP/1.1 ${r.status} ${reason}\n${Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${JSON.stringify(r.body, null, 2)}`;
}

export function runScenario(scenarioId, verticalId, { now = () => Date.now() } = {}) {
  const base = getScenario(scenarioId);
  const vertical = getVertical(verticalId);
  if (!base) throw new Error(`unknown scenario ${scenarioId}`);
  if (!vertical) throw new Error(`unknown vertical ${verticalId}`);
  const scenario = renderScenario(base, vertical);
  const intent0 = baseIntent(vertical);

  let offset = 0;
  const clock = () => now() + offset;
  const as = createMockAS({ now: clock });
  const traceId = hex(16);
  const verifier = randomBytes(32).toString('base64url');
  const ctx = { requestUri: null, txn: null, code: null, token: null, shown: null, authClient: 'agent-app', parClient: 'agent-app' };
  const messages = [];
  const steps = [];
  const userHint = vertical.cast.user.toLowerCase();
  const state = hex(6);
  const merge = (override) => (override === null ? null : { ...intent0, ...(override || {}) });
  const clientCreds = (id) => ({ client_id: id, client_secret: CLIENTS[id].secret });

  function send(op, label, req, say) {
    const traceparent = `00-${traceId}-${hex(8)}-01`;
    const headers = { traceparent, ...(req.headers || {}) };
    const formBody = req.body && Object.keys(req.body).length && req.method !== 'GET' && !headers['content-type']?.includes('json') ? form(req.body) : null;
    if (formBody) headers['content-type'] = 'application/x-www-form-urlencoded';
    const resp = as.handle({ method: req.method, path: req.path, query: req.query || {}, headers, body: req.body || {} });
    const [from, to] = ACTORS[op];
    messages.push({
      seq: messages.length + 1, op, label, from, to, traceparent, spanId: traceparent.split('-')[2], at: new Date(clock()).toISOString(),
      request: { method: req.method, path: req.path, query: req.query || {}, headers, body: req.body || {}, raw: rawRequest({ method: req.method, path: req.path, query: req.query, headers, body: req.body, formBody }) },
      response: { status: resp.status, headers: resp.headers, body: resp.body, raw: rawResponse(resp) },
      say: say || null,
    });
    return resp;
  }

  const LABELS = { par: 'Push the authorization request (PAR)', authorize: 'Open /authorize in the browser', consent: 'User decides on the intent', token: 'Redeem the code for a token', execute: 'Use the token on the resource' };
  let stopped = false;

  for (const step of scenario.steps) {
    if (stopped) break;
    const expectStatus = step.expect?.status ?? null;
    let resp;
    if (step.op === 'wait') {
      offset += step.seconds * 1000;
      steps.push({ op: 'wait', say: step.say || null, seconds: step.seconds, ok: true, status: null, reason: null, mockTime: new Date(clock()).toISOString() });
      continue;
    }
    if (step.op === 'par') {
      const client = step.client || 'agent-app'; ctx.parClient = client;
      const intent = merge(step.intent);
      const body = {
        ...clientCreds(client), response_type: 'code', redirect_uri: CLIENTS[client].redirect_uris[0], scope: 'intent', state,
        code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256', login_hint: userHint, ...(intent ? { intent } : {}), ...(step.set || {}),
      };
      resp = send('par', LABELS.par, { method: 'POST', path: PATH.par, body }, step.say);
      if (resp.status === 201) ctx.requestUri = resp.body.request_uri;
    } else if (step.op === 'authorize') {
      const client = step.client || (step.mode === 'inline' ? 'agent-app' : ctx.parClient);
      ctx.authClient = client;
      let query;
      if (step.mode === 'inline') {
        query = { client_id: client, response_type: 'code', redirect_uri: CLIENTS[client].redirect_uris[0], scope: 'intent', state, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256', login_hint: userHint, intent: merge(step.intent) };
      } else {
        query = { client_id: client, request_uri: ctx.requestUri };
        if (step.extra) query = { ...query, ...Object.fromEntries(Object.entries(step.extra).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify({ ...intent0, ...v }) : v])) };
      }
      resp = send('authorize', LABELS.authorize, { method: 'GET', path: PATH.authorize, query }, step.say);
      if (resp.status === 200) { ctx.txn = resp.body.txn; ctx.shown = resp.body; if (step.mode === 'inline') ctx.parClient = client; }
    } else if (step.op === 'consent') {
      const shown = ctx.shown?.intent;
      const hash = step.tamper ? intentHash({ ...shown, ...step.tamper }) : ctx.shown?.intent_hash;
      resp = send('consent', LABELS.consent, { method: 'POST', path: PATH.consent, body: { txn: ctx.txn, decision: step.decision || 'approve', approved_intent_hash: hash } }, step.say);
      if (resp.status === 200 && resp.body.code) ctx.code = resp.body.code;
    } else if (step.op === 'token') {
      const client = step.client || ctx.parClient;
      const body = { ...clientCreds(client), grant_type: 'authorization_code', code: ctx.code, redirect_uri: CLIENTS[client].redirect_uris[0], code_verifier: verifier, ...(step.intent ? { intent: { ...ctx.shown.intent, ...step.intent } } : {}) };
      resp = send('token', LABELS.token, { method: 'POST', path: PATH.token, body }, step.say);
      if (resp.status === 200) ctx.token = resp.body.access_token;
    } else if (step.op === 'execute') {
      let tok = ctx.token;
      if (step.forge) tok = forgePayload(tok, step.forge);
      const claimed = ctx.shown.intent;
      const body = { action: claimed.action, amount: claimed.amount, currency: claimed.currency, resource: claimed.resource, nonce: claimed.nonce, ...(step.request || {}) };
      resp = send('execute', LABELS.execute, { method: 'POST', path: PATH.execute, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body }, step.say);
    } else throw new Error(`unknown op ${step.op}`);

    const reason = resp.body?.reason ?? null;
    const ok = expectStatus ? resp.status === expectStatus && (!step.expect.reason || reason === step.expect.reason) : resp.status >= 200 && resp.status < 300;
    steps.push({ op: step.op, say: step.say || null, ok, status: resp.status, reason, expected: step.expect || null, messageSeq: messages.length });
    if (!ok) stopped = true;
  }

  const allOk = steps.every((s) => s.ok);
  const last = messages[messages.length - 1];
  const blockedAt = steps.find((s) => s.status >= 400 && s.ok) || null;
  let verdict;
  if (!allOk) verdict = 'unexpected';
  else if (scenario.outcome === 'attack-succeeds') verdict = 'attack-succeeded';
  else verdict = blockedAt ? 'blocked' : 'completed';
  const tokenIssued = messages.find((m) => m.op === 'token' && m.response.status === 200);
  return {
    schema: 'intent-par-run/1',
    scenario: { id: scenario.id, slug: scenario.slug, title: scenario.title, kind: scenario.kind, takeaway: scenario.takeaway, expectedOutcome: scenario.outcome },
    vertical: { id: vertical.id, name: vertical.name, cast: vertical.cast },
    traceId, issuer: ISSUER, audience: RS_AUDIENCE,
    intent: intent0,
    verdict, pass: allOk && verdict === EXPECTED_VERDICT[scenario.outcome],
    blockedAt: blockedAt ? { op: blockedAt.op, status: blockedAt.status, reason: blockedAt.reason } : null,
    steps, messages,
    token: tokenIssued ? { raw: tokenIssued.response.body.access_token, decoded: decodeJwt(tokenIssued.response.body.access_token), note: 'Mock-issued: signed with a throwaway key that exists only in this process.' } : null,
    lastStatus: last?.response.status ?? null,
  };
}

export function runAll(verticalId, opts) {
  return SCENARIOS.map((s) => {
    const r = runScenario(s.id, verticalId, opts);
    return { id: s.id, slug: s.slug, title: s.title, expectedOutcome: s.outcome, verdict: r.verdict, pass: r.pass, blockedAt: r.blockedAt };
  });
}
