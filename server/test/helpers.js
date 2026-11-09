import http from 'node:http';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createMockAS, CLIENTS, pkceChallenge } from '../src/as.js';

export const INTENT = { action: 'payments.transfer', amount: 80, currency: 'USD', resource: 'https://bank.example.invalid/accounts/chk-001', description: 'Pay the electricity bill' };
export const VERIFIER = 'v'.repeat(43);

export function clock(start = 1_800_000_000_000) {
  let t = start;
  return { now: () => t, advance: (s) => { t += s * 1000; } };
}

export function parBody(over = {}, client = 'agent-app') {
  return {
    client_id: client, client_secret: CLIENTS[client].secret, response_type: 'code', redirect_uri: CLIENTS[client].redirect_uris[0], scope: 'intent', state: 'st1',
    code_challenge: pkceChallenge(VERIFIER), code_challenge_method: 'S256', login_hint: 'mark', intent: JSON.stringify(INTENT), ...over,
  };
}

// Drives the AS core through a full flow and returns the pieces.
export function flow(as, { client = 'agent-app', intent = INTENT } = {}) {
  const par = as.handle({ method: 'POST', path: '/as/par', body: parBody({ intent: JSON.stringify(intent) }, client) });
  const authz = as.handle({ method: 'GET', path: '/as/authorize', query: { client_id: client, request_uri: par.body.request_uri } });
  const consent = as.handle({ method: 'POST', path: '/as/consent', body: { txn: authz.body.txn, decision: 'approve', approved_intent_hash: authz.body.intent_hash } });
  const token = as.handle({ method: 'POST', path: '/as/token', body: { client_id: client, client_secret: CLIENTS[client].secret, grant_type: 'authorization_code', code: consent.body.code, redirect_uri: CLIENTS[client].redirect_uris[0], code_verifier: VERIFIER } });
  return { par, authz, consent, token };
}

export async function withServer(fn, { proxyHosts } = {}) {
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, as: createMockAS(), ...(proxyHosts ? { proxyHosts } : {}) }) });
  try { await fn(url.replace(/\/$/, '')); } finally { health.stop(); await new Promise((r) => server.close(r)); }
}

// fetch cannot set Host; node:http can.
export function rawHttp(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, agent: false }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
export { createMockAS };
