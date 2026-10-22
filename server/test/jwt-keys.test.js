import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createKeys, signJwt, verifyJwt } from '../src/jwt.js';

// Regression: on Node 20.20.2, crypto.generateKeyPairSync('ec') leaves a KeyGenJob whose GC finalizer aborts the whole process
// (SIGABRT in uv_mutex_lock, seen on the CI runner as doctor.test.js dying with no report). The abort depends on GC timing and
// cannot be forced from a test, so the guard below pins the cause (no keygen job in jwt.js) and the second test pins the behaviour.
test('jwt.js does not use the crypto keygen job that aborts Node 20 on GC', () => {
  const src = readFileSync(new URL('../src/jwt.js', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /generateKeyPair(Sync)?\b/);
});

test('createKeys survives repeated key creation with GC pressure and still signs/verifies', () => {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  let last;
  for (let i = 0; i < 50; i++) {
    last = createKeys();
    gc();
    last.publicKey.export({ format: 'jwk' });
    gc();
  }
  const [jwk] = last.jwks.keys;
  assert.equal(jwk.kty, 'EC');
  assert.equal(jwk.crv, 'P-256');
  assert.equal(jwk.d, undefined, 'the private scalar never appears in the JWKS');
  const token = signJwt({ sub: 'u' }, last);
  assert.equal(verifyJwt(token, last).ok, true);
  assert.equal(verifyJwt(token, createKeys()).ok, false);
});
