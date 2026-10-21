// The mock authorization server and its resource server, in one process. Request in, response out, no sockets:
// handle({ method, path, query, headers, body }) -> { status, headers, body }. The Express router and the scenario
// runner both call it, so what the SE sees in the trace is exactly what the HTTP endpoints return.
//
// What is real: RFC 9126 PAR rules (one-time short-lived request_uri, client authentication, no request_uri inside a PAR,
// require_pushed_authorization_requests), PKCE S256, RFC 9396 style authorization_details, JWT signing and verification.
// What is mock: the user (consent is a JSON call), the clients and their secrets, the key (throwaway), the issuer (.invalid).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createKeys, signJwt, verifyJwt } from './jwt.js';
import { normalizeIntent, validateIntent, intentHash, diffIntent, toAuthorizationDetails, INTENT_FIELDS } from './intent.js';

export const ISSUER = 'https://as.example.invalid';
export const RS_AUDIENCE = 'https://rs.example.invalid';
export const PAR_TTL_S = 60;
export const TXN_TTL_S = 120;
export const CODE_TTL_S = 60;
export const TOKEN_TTL_S = 300;
export const REQUEST_URI_PREFIX = 'urn:ietf:params:oauth:request_uri:';

// Mock clients. Secrets are throwaway strings that only mean something to this mock.
export const CLIENTS = {
  'agent-app': { name: 'Agent app', secret: 'mock-secret-agent-app', redirect_uris: ['https://agent.example.invalid/callback'], require_par: true },
  'partner-app': { name: 'Partner app', secret: 'mock-secret-partner-app', redirect_uris: ['https://partner.example.invalid/callback'], require_par: true },
  'legacy-web': { name: 'Legacy web app (PAR not required)', secret: 'mock-secret-legacy-web', redirect_uris: ['https://legacy.example.invalid/callback'], require_par: false },
};

const PAR_PARAMS = new Set(['client_id', 'client_secret', 'response_type', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'intent', 'login_hint']);
const INLINE_PARAMS = new Set(['client_id', 'response_type', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'intent', 'login_hint', 'request_uri']);

const res = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-mock': 'true', ...headers }, body });
const fail = (status, error, reason, description, extra = {}) => res(status, { error, reason, error_description: description, ...extra });
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
export const pkceChallenge = (verifier) => createHash('sha256').update(verifier).digest('base64url');

export function createMockAS({ now = () => Date.now(), keys = createKeys(), rand = (n) => randomBytes(n).toString('base64url'), clients = CLIENTS } = {}) {
  const pars = new Map();
  const txns = new Map();
  const codes = new Map();
  const spent = new Set(); // token jti values that have already executed
  const sec = () => Math.floor(now() / 1000);

  function authClient(body, headers) {
    let id = body.client_id; let secret = body.client_secret;
    const basic = /^Basic (.+)$/i.exec(headers.authorization || '');
    if (basic) { const [i, ...s] = Buffer.from(basic[1], 'base64').toString().split(':'); id = id || i; secret = s.join(':'); }
    const client = clients[id];
    if (!client || secret === undefined || !safeEq(secret, client.secret)) return { error: fail(401, 'invalid_client', 'client_auth_failed', 'client authentication failed') };
    return { id, client };
  }

  function parseIntent(raw) {
    if (raw === undefined || raw === '') return { missing: true };
    let value = raw;
    if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { return { bad: 'intent is not valid JSON' }; } }
    const intent = normalizeIntent(value);
    const problems = validateIntent(intent);
    return problems.length ? { bad: problems.join('; ') } : { intent };
  }

  function bind(intent) {
    const bound = { ...intent, nonce: intent.nonce || rand(12) };
    return { intent: bound, hash: intentHash(bound) };
  }

  // POST /as/par
  function par({ body, headers }) {
    const auth = authClient(body, headers);
    if (auth.error) return auth.error;
    if (body.request_uri !== undefined) return fail(400, 'invalid_request', 'request_uri_in_par', 'a pushed request must not itself contain request_uri (RFC 9126 section 2.1)');
    const unknown = Object.keys(body).filter((k) => !PAR_PARAMS.has(k));
    if (unknown.length) return fail(400, 'invalid_request', 'unknown_param', `parameters not accepted at PAR: ${unknown.join(', ')}`, { unknown });
    if (body.response_type !== 'code') return fail(400, 'unsupported_response_type', 'bad_response_type', 'response_type must be code');
    if (!auth.client.redirect_uris.includes(body.redirect_uri)) return fail(400, 'invalid_request', 'redirect_uri_unregistered', 'redirect_uri is not registered for this client');
    if (!body.code_challenge || body.code_challenge_method !== 'S256') return fail(400, 'invalid_request', 'pkce_required', 'code_challenge with method S256 is required');
    const parsed = parseIntent(body.intent);
    if (parsed.missing) return fail(400, 'invalid_request', 'intent_required', 'this authorization server requires an intent: what is being asked, for how much, on what resource');
    if (parsed.bad) return fail(400, 'invalid_request', 'intent_invalid', parsed.bad);
    const { intent, hash } = bind(parsed.intent);
    const request_uri = `${REQUEST_URI_PREFIX}${rand(18)}`;
    const exp = sec() + PAR_TTL_S;
    pars.set(request_uri, { client_id: auth.id, redirect_uri: body.redirect_uri, scope: body.scope || '', state: body.state, code_challenge: body.code_challenge, login_hint: body.login_hint, intent, hash, exp, used: false });
    return res(201, { request_uri, expires_in: PAR_TTL_S, intent_hash: hash });
  }

  function startTxn({ client_id, redirect_uri, scope, state, code_challenge, login_hint, intent, hash, binding }) {
    const txn = `txn_${rand(12)}`;
    txns.set(txn, { client_id, redirect_uri, scope, state, code_challenge, login_hint, intent, hash, binding, exp: sec() + TXN_TTL_S, done: false });
    const client = clients[client_id];
    return res(200, {
      consent_required: true, txn, client: client.name, binding, intent, intent_hash: hash, expires_in: TXN_TTL_S,
      note: binding === 'par' ? 'Intent came from the pushed request: the browser could not edit it.' : 'Intent came from browser query parameters: anyone holding the link could have edited it.',
    });
  }

  // GET /as/authorize
  function authorize({ query }) {
    const client = clients[query.client_id];
    if (!client) return fail(400, 'invalid_request', 'client_unknown', 'client_id is missing or unknown');
    const hasUri = query.request_uri !== undefined;
    if (!hasUri) {
      if (client.require_par) return fail(400, 'invalid_request', 'par_required', 'this client must use a pushed authorization request: send request_uri, not inline parameters');
      const unknown = Object.keys(query).filter((k) => !INLINE_PARAMS.has(k));
      if (unknown.length) return fail(400, 'invalid_request', 'unknown_param', `unknown parameters: ${unknown.join(', ')}`, { unknown });
      if (query.response_type !== 'code') return fail(400, 'unsupported_response_type', 'bad_response_type', 'response_type must be code');
      if (!client.redirect_uris.includes(query.redirect_uri)) return fail(400, 'invalid_request', 'redirect_uri_unregistered', 'redirect_uri is not registered for this client');
      if (!query.code_challenge || query.code_challenge_method !== 'S256') return fail(400, 'invalid_request', 'pkce_required', 'code_challenge with method S256 is required');
      const parsed = parseIntent(query.intent);
      if (parsed.missing) return fail(400, 'invalid_request', 'intent_required', 'this authorization server requires an intent');
      if (parsed.bad) return fail(400, 'invalid_request', 'intent_invalid', parsed.bad);
      const { intent, hash } = bind(parsed.intent);
      return startTxn({ client_id: query.client_id, redirect_uri: query.redirect_uri, scope: query.scope || '', state: query.state, code_challenge: query.code_challenge, login_hint: query.login_hint, intent, hash, binding: 'inline' });
    }
    const extra = Object.keys(query).filter((k) => k !== 'client_id' && k !== 'request_uri');
    if (extra.length) return fail(400, 'invalid_request', 'params_outside_par', `with request_uri only client_id and request_uri are honoured; refused: ${extra.join(', ')}`, { refused: extra });
    const stored = pars.get(query.request_uri);
    if (!stored) return fail(400, 'invalid_request_uri', 'request_uri_unknown', 'request_uri is unknown');
    if (stored.client_id !== query.client_id) return fail(400, 'invalid_request_uri', 'client_mismatch', 'request_uri was pushed by a different client');
    if (stored.used) return fail(400, 'invalid_request_uri', 'request_uri_reused', 'request_uri is one-time use and has already been resolved');
    if (sec() >= stored.exp) return fail(400, 'invalid_request_uri', 'request_uri_expired', `request_uri expired (lifetime ${PAR_TTL_S}s)`);
    stored.used = true;
    return startTxn({ ...stored, binding: 'par' });
  }

  // POST /as/consent: the user's decision on exactly the intent that was shown.
  function consent({ body }) {
    const t = txns.get(body.txn);
    if (!t) return fail(400, 'invalid_request', 'txn_unknown', 'no such consent transaction');
    if (t.done) return fail(400, 'invalid_request', 'txn_reused', 'this consent transaction is already decided');
    if (sec() >= t.exp) return fail(400, 'invalid_request', 'txn_expired', 'consent transaction expired');
    if (body.decision === 'deny') {
      t.done = true;
      return res(200, { error: 'access_denied', redirect_to: `${t.redirect_uri}?error=access_denied${t.state ? `&state=${t.state}` : ''}` });
    }
    if (body.decision !== 'approve') return fail(400, 'invalid_request', 'decision_invalid', 'decision must be approve or deny');
    if (!body.approved_intent_hash) return fail(400, 'invalid_request', 'approved_intent_hash_required', 'consent must name the hash of the intent the user was shown');
    if (body.approved_intent_hash !== t.hash) return fail(400, 'invalid_request', 'consent_intent_mismatch', 'the approved intent hash does not match the intent bound to this request', { bound_intent_hash: t.hash, approved_intent_hash: body.approved_intent_hash });
    t.done = true;
    const code = `code_${rand(18)}`;
    codes.set(code, { ...t, used: false, exp: sec() + CODE_TTL_S });
    return res(200, { code, state: t.state, redirect_to: `${t.redirect_uri}?code=${code}${t.state ? `&state=${t.state}` : ''}`, approved_intent_hash: t.hash });
  }

  // POST /as/token
  function token({ body, headers }) {
    const auth = authClient(body, headers);
    if (auth.error) return auth.error;
    if (body.grant_type !== 'authorization_code') return fail(400, 'unsupported_grant_type', 'bad_grant_type', 'grant_type must be authorization_code');
    const c = codes.get(body.code);
    if (!c) return fail(400, 'invalid_grant', 'code_unknown', 'authorization code is unknown');
    if (c.client_id !== auth.id) return fail(400, 'invalid_grant', 'client_mismatch', 'code was issued to a different client');
    if (c.used) return fail(400, 'invalid_grant', 'code_reused', 'authorization code is one-time use');
    c.used = true;
    if (sec() >= c.exp) return fail(400, 'invalid_grant', 'code_expired', 'authorization code expired');
    if (body.redirect_uri !== c.redirect_uri) return fail(400, 'invalid_grant', 'redirect_uri_mismatch', 'redirect_uri differs from the authorization request');
    if (!body.code_verifier || pkceChallenge(body.code_verifier) !== c.code_challenge) return fail(400, 'invalid_grant', 'pkce_failed', 'code_verifier does not match the code_challenge');
    if (body.intent !== undefined) {
      let asked = body.intent;
      if (typeof asked === 'string') { try { asked = JSON.parse(asked); } catch { asked = null; } }
      const norm = normalizeIntent(asked) || {};
      const diffs = diffIntent(c.intent, norm, { all: true });
      if (diffs.length || !asked) return fail(400, 'invalid_authorization_details', 'intent_mismatch', 'the intent in the token request differs from the intent bound at PAR; a token request may not widen or change it', { mismatches: diffs });
    }
    const iat = sec();
    const jti = `jti_${rand(10)}`;
    const payload = {
      iss: ISSUER, sub: c.login_hint || 'mock-user', aud: RS_AUDIENCE, client_id: auth.id, iat, exp: iat + TOKEN_TTL_S, jti, scope: c.scope,
      authorization_details: toAuthorizationDetails(c.intent),
      intent: Object.fromEntries(INTENT_FIELDS.filter((f) => c.intent[f] !== undefined).map((f) => [f, c.intent[f]])),
      intent_hash: c.hash, binding: c.binding, mock: true,
    };
    return res(200, { access_token: signJwt(payload, keys), token_type: 'Bearer', expires_in: TOKEN_TTL_S, authorization_details: payload.authorization_details, intent_hash: c.hash });
  }

  // POST /rs/execute: the mock resource server. A token carries one intent; it does that and nothing else, once.
  function execute({ body, headers }) {
    const m = /^Bearer (.+)$/i.exec(headers.authorization || '');
    const unauthorized = (reason) => ({ ...fail(401, 'invalid_token', reason, `token rejected: ${reason}`), headers: { ...fail(401, 'x', 'x', 'x').headers, 'www-authenticate': `Bearer error="invalid_token", error_description="${reason}"` } });
    if (!m) return unauthorized('token_missing');
    const v = verifyJwt(m[1], keys);
    if (!v.ok) return unauthorized(v.reason);
    const p = v.payload;
    if (p.iss !== ISSUER || p.aud !== RS_AUDIENCE || !p.mock) return fail(401, 'invalid_token', 'wrong_issuer_or_audience', 'token is not from this mock authorization server for this resource server');
    if (sec() >= p.exp) return fail(401, 'invalid_token', 'token_expired', 'token expired');
    const mismatches = diffIntent(p.intent, normalizeIntent(body) || {});
    if (mismatches.length) return fail(403, 'insufficient_authorization', 'intent_mismatch', 'this token was issued for a different action: what is being attempted is not the intent that was approved', { mismatches, bound_intent_hash: p.intent_hash });
    if (spent.has(p.jti)) return fail(403, 'insufficient_authorization', 'intent_already_consumed', 'the intent in this token has already been executed once');
    spent.add(p.jti);
    return res(200, { executed: true, receipt: { id: `rcpt_${rand(8)}`, action: p.intent.action, amount: p.intent.amount, currency: p.intent.currency, resource: p.intent.resource, on_behalf_of: p.sub, binding: p.binding, intent_hash: p.intent_hash } });
  }

  const routes = {
    'POST /as/par': par, 'GET /as/authorize': authorize, 'POST /as/consent': consent, 'POST /as/token': token, 'POST /rs/execute': execute,
    'GET /as/jwks': () => res(200, keys.jwks),
  };
  function handle(req) {
    const fn = routes[`${req.method} ${req.path}`];
    if (!fn) return fail(404, 'not_found', 'no_such_endpoint', 'no such endpoint');
    return fn({ query: {}, headers: {}, body: {}, ...req });
  }
  return { handle, keys, clock: { now }, stats: () => ({ pars: pars.size, txns: txns.size, codes: codes.size, spent: spent.size }) };
}
