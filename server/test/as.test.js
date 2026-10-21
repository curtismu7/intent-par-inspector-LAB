import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAS, CLIENTS, PAR_TTL_S, ISSUER } from '../src/as.js';
import { verifyJwt, decodeJwt, forgePayload } from '../src/jwt.js';
import { intentHash } from '../src/intent.js';
import { INTENT, VERIFIER, parBody, flow, clock } from './helpers.js';

const mk = () => { const c = clock(); return { c, as: createMockAS({ now: c.now }) }; };
const H = (as, method, path, extra) => as.handle({ method, path, ...extra });

test('PAR: 201 with a request_uri, expires_in 60, server-assigned nonce, intent hash', () => {
  const { as } = mk();
  const r = H(as, 'POST', '/as/par', { body: parBody() });
  assert.equal(r.status, 201);
  assert.match(r.body.request_uri, /^urn:ietf:params:oauth:request_uri:/);
  assert.equal(r.body.expires_in, PAR_TTL_S);
  assert.ok(r.body.intent_hash);
});

test('PAR: client authentication (wrong secret, unknown client, Basic works)', () => {
  const { as } = mk();
  assert.equal(H(as, 'POST', '/as/par', { body: parBody({ client_secret: 'nope' }) }).body.reason, 'client_auth_failed');
  assert.equal(H(as, 'POST', '/as/par', { body: parBody({ client_id: 'ghost' }) }).status, 401);
  const b = parBody(); delete b.client_secret;
  const basic = `Basic ${Buffer.from(`agent-app:${CLIENTS['agent-app'].secret}`).toString('base64')}`;
  assert.equal(H(as, 'POST', '/as/par', { body: b, headers: { authorization: basic } }).status, 201);
});

test('PAR: validation refusals carry a reason', () => {
  const { as } = mk();
  const reason = (over) => H(as, 'POST', '/as/par', { body: parBody(over) }).body.reason;
  assert.equal(reason({ intent: undefined }), 'intent_required');
  assert.equal(reason({ intent: '{not json' }), 'intent_invalid');
  assert.equal(reason({ intent: JSON.stringify({ ...INTENT, amount: -5 }) }), 'intent_invalid');
  assert.equal(reason({ intent: JSON.stringify({ ...INTENT, resource: 'https://real-bank.com/x' }) }), 'intent_invalid');
  assert.equal(reason({ redirect_uri: 'https://evil.example.invalid/cb' }), 'redirect_uri_unregistered');
  assert.equal(reason({ code_challenge_method: 'plain' }), 'pkce_required');
  assert.equal(reason({ request_uri: 'urn:x' }), 'request_uri_in_par');
  assert.equal(reason({ admin: '1' }), 'unknown_param');
  assert.equal(reason({ response_type: 'token' }), 'bad_response_type');
});

test('authorize: resolves a request_uri once, shows the bound intent', () => {
  const { as } = mk();
  const { par, authz } = flow(as);
  assert.equal(authz.status, 200);
  assert.equal(authz.body.binding, 'par');
  assert.equal(authz.body.intent.amount, 80);
  assert.equal(authz.body.intent_hash, par.body.intent_hash);
  assert.equal(authz.body.intent_hash, intentHash(authz.body.intent));
});

test('authorize: replay, expiry, wrong client, unknown, params beside request_uri', () => {
  const { as, c } = mk();
  const par = () => H(as, 'POST', '/as/par', { body: parBody() }).body.request_uri;
  const az = (query) => H(as, 'GET', '/as/authorize', { query });
  let u = par();
  assert.equal(az({ client_id: 'agent-app', request_uri: u }).status, 200);
  assert.equal(az({ client_id: 'agent-app', request_uri: u }).body.reason, 'request_uri_reused');
  u = par(); c.advance(PAR_TTL_S + 1);
  assert.equal(az({ client_id: 'agent-app', request_uri: u }).body.reason, 'request_uri_expired');
  u = par();
  assert.equal(az({ client_id: 'partner-app', request_uri: u }).body.reason, 'client_mismatch');
  assert.equal(az({ client_id: 'agent-app', request_uri: u }).status, 200, 'wrong-client attempt must not burn the request_uri');
  assert.equal(az({ client_id: 'agent-app', request_uri: 'urn:ietf:params:oauth:request_uri:zzz' }).body.reason, 'request_uri_unknown');
  u = par();
  assert.equal(az({ client_id: 'agent-app', request_uri: u, amount: '5000' }).body.reason, 'params_outside_par');
  assert.equal(az({ client_id: 'agent-app', request_uri: u }).status, 200, 'refused extras must not burn the request_uri');
});

test('authorize without request_uri: refused when PAR is required, bound as inline for a legacy client', () => {
  const { as } = mk();
  const q = (client) => ({ client_id: client, response_type: 'code', redirect_uri: CLIENTS[client].redirect_uris[0], code_challenge: parBody().code_challenge, code_challenge_method: 'S256', intent: JSON.stringify(INTENT) });
  const strict = H(as, 'GET', '/as/authorize', { query: q('agent-app') });
  assert.equal(strict.status, 400); assert.equal(strict.body.reason, 'par_required');
  const loose = H(as, 'GET', '/as/authorize', { query: q('legacy-web') });
  assert.equal(loose.status, 200); assert.equal(loose.body.binding, 'inline');
});

test('consent: hash must match, one decision, deny, expiry', () => {
  const { as, c } = mk();
  const open = () => { const p = H(as, 'POST', '/as/par', { body: parBody() }); return H(as, 'GET', '/as/authorize', { query: { client_id: 'agent-app', request_uri: p.body.request_uri } }).body; };
  let a = open();
  const post = (body) => H(as, 'POST', '/as/consent', { body });
  assert.equal(post({ txn: a.txn, decision: 'approve' }).body.reason, 'approved_intent_hash_required');
  assert.equal(post({ txn: a.txn, decision: 'approve', approved_intent_hash: 'wrong' }).body.reason, 'consent_intent_mismatch');
  assert.equal(post({ txn: a.txn, decision: 'approve', approved_intent_hash: a.intent_hash }).status, 200);
  assert.equal(post({ txn: a.txn, decision: 'approve', approved_intent_hash: a.intent_hash }).body.reason, 'txn_reused');
  a = open();
  assert.match(post({ txn: a.txn, decision: 'deny' }).body.redirect_to, /error=access_denied/);
  a = open(); c.advance(121);
  assert.equal(post({ txn: a.txn, decision: 'approve', approved_intent_hash: a.intent_hash }).body.reason, 'txn_expired');
  assert.equal(post({ txn: 'nope', decision: 'approve' }).body.reason, 'txn_unknown');
});

test('token: carries the bound intent, signed, mock-marked; PKCE and code reuse enforced', () => {
  const { as } = mk();
  const { authz, consent, token } = flow(as);
  assert.equal(token.status, 200);
  const v = verifyJwt(token.body.access_token, as.keys);
  assert.ok(v.ok);
  const p = v.payload;
  assert.equal(p.iss, ISSUER); assert.equal(p.mock, true); assert.equal(p.intent_hash, authz.body.intent_hash);
  assert.deepEqual(p.intent, authz.body.intent);
  assert.equal(p.authorization_details[0].type, 'intent_action');
  assert.equal(p.authorization_details[0].amount.value, 80);
  assert.equal(p.authorization_details[0].identifier, authz.body.intent.nonce);
  assert.equal(v.header.typ, 'at+jwt');
  const again = H(as, 'POST', '/as/token', { body: { client_id: 'agent-app', client_secret: CLIENTS['agent-app'].secret, grant_type: 'authorization_code', code: consent.body.code, redirect_uri: CLIENTS['agent-app'].redirect_uris[0], code_verifier: VERIFIER } });
  assert.equal(again.body.reason, 'code_reused');
});

test('token: wrong verifier, wrong client, wrong redirect, expired code, changed intent', () => {
  const { as, c } = mk();
  const code = () => { const p = H(as, 'POST', '/as/par', { body: parBody() }); const a = H(as, 'GET', '/as/authorize', { query: { client_id: 'agent-app', request_uri: p.body.request_uri } }).body; return { code: H(as, 'POST', '/as/consent', { body: { txn: a.txn, decision: 'approve', approved_intent_hash: a.intent_hash } }).body.code, intent: a.intent }; };
  const tok = (body) => H(as, 'POST', '/as/token', { body: { client_id: 'agent-app', client_secret: CLIENTS['agent-app'].secret, grant_type: 'authorization_code', redirect_uri: CLIENTS['agent-app'].redirect_uris[0], code_verifier: VERIFIER, ...body } }).body;
  assert.equal(tok({ code: code().code, code_verifier: 'w'.repeat(43) }).reason, 'pkce_failed');
  assert.equal(tok({ code: code().code, redirect_uri: 'https://agent.example.invalid/other' }).reason, 'redirect_uri_mismatch');
  const x = code();
  assert.equal(H(as, 'POST', '/as/token', { body: { client_id: 'partner-app', client_secret: CLIENTS['partner-app'].secret, grant_type: 'authorization_code', code: x.code, redirect_uri: CLIENTS['partner-app'].redirect_uris[0], code_verifier: VERIFIER } }).body.reason, 'client_mismatch');
  const e = code(); c.advance(61);
  assert.equal(tok({ code: e.code }).reason, 'code_expired');
  const y = code();
  const r = tok({ code: y.code, intent: JSON.stringify({ ...y.intent, amount: 800 }) });
  assert.equal(r.error, 'invalid_authorization_details'); assert.equal(r.reason, 'intent_mismatch');
  assert.deepEqual(r.mismatches.map((m) => m.field), ['amount']);
  assert.equal(tok({ code: 'code_unknown' }).reason, 'code_unknown');
  assert.equal(tok({ code: 'x', grant_type: 'password' }).reason, 'bad_grant_type');
});

test('resource server: exact intent runs once; any difference is refused with the field named', () => {
  const { as } = mk();
  const { authz, token } = flow(as);
  const bearer = { authorization: `Bearer ${token.body.access_token}` };
  const exec = (body, headers = bearer) => H(as, 'POST', '/rs/execute', { headers, body });
  const i = authz.body.intent;
  const ex = (o) => exec({ action: i.action, amount: i.amount, currency: i.currency, resource: i.resource, ...o });
  assert.equal(ex({ amount: 8000 }).body.reason, 'intent_mismatch');
  assert.deepEqual(ex({ amount: 8000, resource: 'https://bank.example.invalid/accounts/sav-002' }).body.mismatches.map((m) => m.field), ['amount', 'resource']);
  assert.equal(ex({ currency: 'EUR' }).status, 403);
  assert.equal(ex({ action: 'payments.transfer_all' }).status, 403);
  const ok = ex({});
  assert.equal(ok.status, 200); assert.equal(ok.body.receipt.binding, 'par');
  assert.equal(ex({}).body.reason, 'intent_already_consumed');
});

test('resource server: missing, malformed, forged and expired tokens are 401', () => {
  const { as, c } = mk();
  const { token } = flow(as);
  const t = token.body.access_token;
  const exec = (tok) => H(as, 'POST', '/rs/execute', { headers: tok ? { authorization: `Bearer ${tok}` } : {}, body: { ...INTENT } });
  assert.equal(exec(null).body.reason, 'token_missing');
  assert.equal(exec('abc').body.reason, 'malformed');
  const forged = forgePayload(t, { intent: { ...decodeJwt(t).payload.intent, amount: 8000 } });
  const r = exec(forged);
  assert.equal(r.status, 401); assert.equal(r.body.reason, 'bad_signature');
  assert.match(r.headers['www-authenticate'], /invalid_token/);
  const other = createMockAS({ now: c.now });
  assert.equal(H(other, 'POST', '/rs/execute', { headers: { authorization: `Bearer ${t}` }, body: INTENT }).body.reason, 'bad_signature', 'a token from another AS key is not accepted');
  c.advance(301);
  assert.equal(exec(t).body.reason, 'token_expired');
});

test('jwks publishes the throwaway public key only', () => {
  const { as } = mk();
  const k = H(as, 'GET', '/as/jwks').body.keys[0];
  assert.equal(k.alg, 'ES256'); assert.equal(k.d, undefined); assert.match(k.kid, /^mock-/);
});

test('unknown endpoint is 404', () => {
  assert.equal(H(mk().as, 'GET', '/nope').status, 404);
});
