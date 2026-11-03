import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installNetguard } from '../src/netguard.js';
import { withServer } from './helpers.js';

let guard;
before(() => { guard = installNetguard(); });
after(() => { assert.deepEqual(guard.attempts, [], 'the app tried to leave the machine'); guard.restore(); });

const mode = (base, body) => fetch(`${base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('GET /api/info reports the mock-only source and no real availability', async () => {
  await withServer(async (base) => {
    const r = await fetch(`${base}/api/info`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { source: 'mock', realAvailable: false });
  });
});

test('POST /api/mode keeps Mock selected and refuses Real with the reason (409)', async () => {
  await withServer(async (base) => {
    assert.equal((await mode(base, { source: 'mock' })).status, 200);
    const real = await mode(base, { source: 'real' });
    assert.equal(real.status, 409);
    assert.match((await real.json()).message, /mock only/i);
    assert.equal((await (await fetch(`${base}/api/info`)).json()).source, 'mock');
  });
});

test('POST /api/mode rejects malformed bodies with 400', async () => {
  await withServer(async (base) => {
    for (const body of [{}, { source: 'live' }, { source: 'mock', extra: 1 }, []]) {
      assert.equal((await mode(base, body)).status, 400, JSON.stringify(body));
    }
    const raw = await fetch(`${base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'mock' });
    assert.equal(raw.status, 400);
  });
});
