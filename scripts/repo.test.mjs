// Repo-level checks: content pack, shelf entry, docs truth, hygiene, the pre-commit hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePack } from './validate-content-pack.mjs';
import { buildPack } from './build-content-pack.mjs';
import { portProblem, scanHosts } from '../server/src/safety.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function trackedTextFiles() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  return out.filter((f) => !/package-lock\.json$|node_modules/.test(f) && fs.existsSync(path.join(ROOT, f)));
}

test('content pack validates and is in sync with the scenario data', () => {
  const pack = JSON.parse(read('content-pack.json'));
  assert.deepEqual(validatePack(pack), []);
  assert.deepEqual(pack, buildPack(), 'run: node scripts/build-content-pack.mjs');
  const scenarios = JSON.parse(read('server/data/scenarios.json'));
  assert.deepEqual(pack.stories.map((s) => s.id), scenarios.map((s) => s.id));
  assert.equal(pack.demo.doctor, '/api/health');
});

test('content pack validation rejects a broken pack', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['no-such-term'];
  assert.ok(validatePack(pack).some((e) => /unknown term/.test(e)));
  delete pack.glossary;
  assert.ok(validatePack(pack).length > 0);
});

test('shelf entry matches the demo: id, port, health path, loopback url', () => {
  const [d] = JSON.parse(read('docs/shelf-entry.json')).demos;
  assert.equal(d.id, 'intent-par-inspector');
  assert.equal(d.healthPath, '/api/health');
  const u = new URL(d.url);
  assert.equal(u.hostname, 'localhost');
  assert.equal(portProblem(Number(u.port)), null);
  assert.equal(JSON.parse(read('content-pack.json')).demo.baseUrl, d.url);
});

test('README is true: default port, commands exist, endpoints are real', () => {
  const readme = read('README.md');
  const pkg = JSON.parse(read('package.json'));
  for (const s of ['doctor', 'start', 'test']) assert.ok(pkg.scripts[s], s);
  assert.match(readme, /localhost:4771/);
  assert.match(readme, /no web UI yet/i);
  for (const route of ['/as/par', '/as/authorize', '/as/consent', '/as/token', '/rs/execute', '/as/jwks', '/api/run-all']) assert.ok(readme.includes(route), route);
  const ports = [...new Set([...readme.matchAll(/localhost:(\d{4,5})/g)].map((m) => Number(m[1])))];
  for (const p of ports) assert.equal(portProblem(p), null, String(p));
});

test('no tracked file (tests excepted: they name bad hosts as negative cases) names a non-reserved host', () => {
  const offenders = [];
  for (const f of trackedTextFiles()) {
    if (/\.(png|jpg|ico)$/.test(f) || /^server\/test\//.test(f) || f === 'scripts/repo.test.mjs') continue; // tests name real-looking hosts on purpose, as negative cases
    const hosts = scanHosts(read(f)).filter((h) => /^[a-z0-9.-]+$/.test(h) && !/^(www\.)?(rfc-editor\.org|datatracker\.ietf\.org|json-schema\.org)$/.test(h));
    if (hosts.length) offenders.push(`${f}: ${hosts.join(', ')}`);
  }
  assert.deepEqual(offenders, []);
});

test('no forbidden string appears in any tracked file (list is read, never printed)', (t) => {
  const file = path.join(os.homedir(), '.config/demo-kit/forbidden-strings.txt');
  if (!fs.existsSync(file)) return t.skip('forbidden-strings.txt not present on this machine');
  const needles = fs.readFileSync(file, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean);
  let hits = 0;
  for (const f of trackedTextFiles()) { const text = read(f); for (const n of needles) if (text.includes(n)) hits++; }
  assert.equal(hits, 0, `${hits} forbidden-string hit(s) (values deliberately not shown)`);
});

test('the server source makes no outbound HTTP calls of its own', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'server/src'))) {
    const text = read(`server/src/${f}`);
    if (f === 'netguard.js') continue;
    assert.doesNotMatch(text, /\bfetch\(|https?\.request|https?\.get|axios|node-fetch|net\.connect|new WebSocket/, f);
  }
});

test('no purple in any style or token (house rule)', () => {
  for (const f of trackedTextFiles().filter((x) => /\.(css|html|jsx?|json)$/.test(x) && !/package/.test(x))) {
    assert.doesNotMatch(read(f), /\b(purple|violet|indigo)\b|#(?:[89ab][0-9a-f]){0}(?:7c3aed|8b5cf6|6d28d9)/i, f);
  }
});

test('pre-commit hook runs gitleaks and is the configured hooks path', () => {
  const hook = read('.githooks/pre-commit');
  assert.match(hook, /gitleaks protect --staged/);
  assert.ok(fs.statSync(path.join(ROOT, '.githooks/pre-commit')).mode & 0o111, 'hook must be executable');
  const hp = execFileSync('git', ['config', 'core.hooksPath'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(hp, '.githooks');
});

test('commits carry the co-author trailer (checked on existing history)', (t) => {
  let log = '';
  try { log = execFileSync('git', ['log', '--format=%B'], { cwd: ROOT, encoding: 'utf8' }); } catch { return t.skip('no commits yet'); }
  if (!log.trim()) return t.skip('no commits yet');
  const msgs = execFileSync('git', ['log', '--format=%H'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const h of msgs) assert.match(execFileSync('git', ['show', '-s', '--format=%B', h], { cwd: ROOT, encoding: 'utf8' }), /Co-Authored-By: Claude Sonnet 5\.5 <noreply@anthropic\.com>/, h);
});
