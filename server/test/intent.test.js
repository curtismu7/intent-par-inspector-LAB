import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIntent, validateIntent, intentHash, diffIntent, inert, toAuthorizationDetails } from '../src/intent.js';
import { INTENT } from './helpers.js';

test('hash is stable, order-independent and sensitive to every field', () => {
  const a = { ...INTENT, nonce: 'abcdefgh1' };
  const reordered = { nonce: 'abcdefgh1', resource: a.resource, description: a.description, currency: a.currency, amount: a.amount, action: a.action };
  assert.equal(intentHash(a), intentHash(reordered));
  for (const [k, v] of [['action', 'payments.other'], ['amount', 81], ['currency', 'EUR'], ['resource', 'https://bank.example.invalid/x'], ['nonce', 'abcdefgh2'], ['description', 'other']]) {
    assert.notEqual(intentHash({ ...a, [k]: v }), intentHash(a), k);
  }
});

test('normalise accepts numeric strings and upper-cases currency; rejects non-objects', () => {
  assert.equal(normalizeIntent({ ...INTENT, amount: '80', currency: 'usd' }).amount, 80);
  assert.equal(normalizeIntent({ ...INTENT, currency: 'usd' }).currency, 'USD');
  assert.equal(normalizeIntent(null), null);
  assert.equal(normalizeIntent([1]), null);
  assert.deepEqual(validateIntent(null), ['intent must be a JSON object']);
});

test('validate: each bad field is named', () => {
  const bad = (o) => validateIntent(normalizeIntent({ ...INTENT, ...o })).join('|');
  assert.match(bad({ action: 'Pay Now' }), /action/);
  assert.match(bad({ amount: 0 }), /amount/);
  assert.match(bad({ amount: 1.234 }), /amount/);
  assert.match(bad({ amount: 'abc' }), /amount/);
  assert.match(bad({ currency: 'US' }), /currency/);
  assert.match(bad({ resource: 'x' }), /resource/);
  assert.match(bad({ resource: 'https://real.example.com/x' }), /not reserved/);
  assert.match(bad({ nonce: 'a b' }), /nonce/);
  assert.equal(bad({}), '');
  assert.match(validateIntent(normalizeIntent(INTENT), { requireNonce: true }).join(), /nonce is required/);
});

test('descriptions are made inert: control and bidi characters removed', () => {
  assert.equal(inert('pay‮ now\u0000​'), 'pay now');
  assert.equal(normalizeIntent({ ...INTENT, description: 'a‮b' }).description, 'ab');
});

test('diff lists only enforced fields that differ', () => {
  assert.deepEqual(diffIntent(INTENT, { ...INTENT, amount: 90, description: 'x', nonce: 'zzzzzzzz' }).map((d) => d.field), ['amount']);
  assert.deepEqual(diffIntent(INTENT, { amount: 80 }), []);
});

test('authorization_details follows RFC 9396 shape', () => {
  const [d] = toAuthorizationDetails({ ...INTENT, nonce: 'abcdefgh1' });
  assert.deepEqual([d.type, d.actions, d.locations, d.amount, d.identifier], ['intent_action', ['payments.transfer'], [INTENT.resource], { value: 80, currency: 'USD' }, 'abcdefgh1']);
});
