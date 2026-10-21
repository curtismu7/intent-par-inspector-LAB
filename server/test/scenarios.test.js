import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, runAll } from '../src/runner.js';
import { SCENARIOS, VERTICALS, getScenario, render, castTokens, storyCorpus } from '../src/stories.js';
import { scanHosts } from '../src/safety.js';
import { verifyJwt, createKeys } from '../src/jwt.js';

const EXPECT = {
  S01: ['completed', null], S02: ['blocked', 'intent_mismatch'], S03: ['blocked', 'params_outside_par'], S04: ['blocked', 'consent_intent_mismatch'],
  S05: ['blocked', 'intent_mismatch'], S06: ['blocked', 'intent_mismatch'], S07: ['blocked', 'intent_mismatch'], S08: ['blocked', 'request_uri_reused'],
  S09: ['blocked', 'request_uri_expired'], S10: ['blocked', 'client_mismatch'], S11: ['blocked', 'intent_required'], S12: ['blocked', 'par_required'],
  S13: ['attack-succeeded', null], S14: ['blocked', 'bad_signature'], S15: ['blocked', 'unknown_param'],
};

test('every scenario, in every vertical, behaves as written', () => {
  for (const v of VERTICALS) for (const s of SCENARIOS) {
    const r = runScenario(s.id, v.id);
    assert.equal(r.pass, true, `${s.id}/${v.id}: ${JSON.stringify(r.steps.filter((x) => !x.ok))}`);
    const [verdict, reason] = EXPECT[s.id];
    assert.equal(r.verdict, verdict, `${s.id}/${v.id}`);
    assert.equal(r.blockedAt?.reason ?? null, reason, `${s.id}/${v.id}`);
  }
});

test('the scenario list is exactly the one under test', () => {
  assert.deepEqual(SCENARIOS.map((s) => s.id), Object.keys(EXPECT));
  assert.deepEqual(VERTICALS.map((v) => v.id).sort(), ['banking', 'retail', 'travel']);
  assert.equal(runAll('travel').length, SCENARIOS.length);
});

test('tamper coverage: amount, resource, replay, expiry, wrong client, missing intent, inline when PAR required', () => {
  const reasons = new Set(runAll('banking').map((r) => r.blockedAt?.reason));
  for (const need of ['params_outside_par', 'consent_intent_mismatch', 'intent_mismatch', 'request_uri_reused', 'request_uri_expired', 'client_mismatch', 'intent_required', 'par_required', 'bad_signature', 'unknown_param']) assert.ok(reasons.has(need), need);
});

test('HITL story (travel): Mark approves one exact plane ticket and nothing else', () => {
  const r = runScenario('hitl-approve-exact', 'travel');
  assert.equal(r.vertical.cast.user, 'Mark');
  assert.match(r.intent.description, /plane ticket/);
  assert.deepEqual(r.steps.map((s) => s.op + ':' + s.status), ['par:201', 'authorize:200', 'consent:200', 'token:200', 'execute:200', 'execute:403', 'execute:403']);
  assert.deepEqual(r.steps.slice(-2).map((s) => s.reason), ['intent_mismatch', 'intent_already_consumed']);
  const say = r.steps.map((s) => s.say).join(' ');
  assert.match(say, /Mark/); assert.match(say, /Travel Agent/); assert.doesNotMatch(say, /\{\{/);
});

test('contrast story: without PAR the edited amount ends up in the token', () => {
  const r = runScenario('S13', 'banking');
  assert.equal(r.verdict, 'attack-succeeded');
  assert.equal(r.messages[0].response.body.binding, 'inline');
  assert.equal(r.token.decoded.payload.intent.amount, 800);
  assert.equal(r.token.decoded.payload.binding, 'inline');
});

test('trace envelope: W3C traceparent on every message, one trace id, unique spans, raw text present', () => {
  const r = runScenario('S01', 'travel');
  assert.equal(r.messages.length, 5);
  const spans = new Set();
  r.messages.forEach((m, i) => {
    assert.match(m.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    assert.equal(m.traceparent.split('-')[1], r.traceId);
    assert.equal(m.request.headers.traceparent, m.traceparent);
    spans.add(m.spanId);
    assert.equal(m.seq, i + 1);
    assert.match(m.request.raw, /^(GET|POST) \/\S+ HTTP\/1\.1\nHost: as\.example\.invalid\n/);
    assert.match(m.request.raw, /traceparent: 00-/);
    assert.match(m.response.raw, /^HTTP\/1\.1 \d{3}/);
    assert.ok(m.at && m.from && m.to && m.label);
  });
  assert.equal(spans.size, 5);
  assert.deepEqual(r.messages.map((m) => `${m.from}>${m.to}`), ['agent>as', 'browser>as', 'browser>as', 'agent>as', 'agent>rs']);
  assert.match(r.messages[0].request.raw, /\n\nclient_id=agent-app&/);
  assert.match(r.messages[3].response.raw, /"access_token"/);
});

test('raw tokens are shown, and only mock-issued ones: signed by this run key, example.invalid issuer, mock claim', () => {
  const r = runScenario('S01', 'retail');
  assert.ok(r.token.raw.split('.').length === 3);
  assert.equal(r.token.decoded.payload.mock, true);
  assert.match(r.token.decoded.payload.iss, /\.invalid$/);
  assert.match(r.token.decoded.header.kid, /^mock-/);
  assert.equal(verifyJwt(r.token.raw, createKeys()).ok, false, 'a different key cannot validate it');
});

test('expiry runs on a virtual clock: no real waiting', () => {
  const t0 = Date.now();
  const r = runScenario('S09', 'travel');
  assert.ok(Date.now() - t0 < 2000);
  assert.ok(r.steps.find((s) => s.op === 'wait').mockTime);
  assert.ok(new Date(r.messages.at(-1).at) - new Date(r.messages[0].at) >= 61000);
});

test('tokens: whole-token values keep their type, partial tokens interpolate, unknown tokens stay visible', () => {
  const t = castTokens(VERTICALS[0]);
  assert.equal(render('{{amount_tampered}}', t), t.amount * 10);
  assert.equal(render('pay {{currency}} {{amount}}', t), `pay ${t.currency} ${t.amount}`);
  assert.equal(render('{{nope}}', t), '{{nope}}');
  assert.deepEqual(render({ a: ['{{user}}'] }, t), { a: [t.user] });
});

test('no rendered story leaves a token unfilled', () => {
  for (const v of VERTICALS) for (const s of SCENARIOS) {
    const r = runScenario(s.id, v.id);
    assert.doesNotMatch(JSON.stringify(r.steps) + JSON.stringify(r.intent), /\{\{/, `${s.id}/${v.id}`);
  }
});

test('story data names only reserved hosts', () => {
  for (const { where, text } of storyCorpus()) assert.deepEqual(scanHosts(text), [], where);
  assert.ok(getScenario('hitl-approve-exact'));
});

test('unknown scenario or vertical throws', () => {
  assert.throws(() => runScenario('S99', 'travel'), /unknown scenario/);
  assert.throws(() => runScenario('S01', 'nope'), /unknown vertical/);
});
