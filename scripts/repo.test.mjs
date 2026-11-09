// Repo-level checks: content pack, shelf entry, docs truth, hygiene, the pre-commit hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePack } from './validate-content-pack.mjs';
import { buildPack } from './build-content-pack.mjs';
import { portProblem, scanHosts } from '../server/src/safety.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function trackedTextFiles() {
  // Outside a git clone (e.g. the air-test sync, which ships no .git) walk the tree
  // with the same exclusions; git's ignore list does not exist there anyway.
  let out;
  const git = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT });
  if (git.status === 0) {
    out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  } else {
    out = [];
    const skip = new Set(['node_modules', 'dist', '.git', 'coverage']);
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!skip.has(e.name)) walk(path.join(d, e.name)); }
        else out.push(path.relative(ROOT, path.join(d, e.name)));
      }
    };
    walk(ROOT);
  }
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
  for (const f of ['scripts/run.sh', 'scripts/reset.mjs', 'docs/talk-track.md', 'docs/live-checks.md', 'docker-compose.yml', 'Dockerfile']) assert.ok(read('README.md').includes(f.replace(/^docs\//, 'docs/')), f);
  const readme = read('README.md');
  const pkg = JSON.parse(read('package.json'));
  for (const s of ['doctor', 'start', 'test']) assert.ok(pkg.scripts[s], s);
  assert.match(readme, /localhost:4771/);
  assert.match(readme, /step IP2, integration/i);
  for (const route of ['/api/builder']) assert.ok(readme.includes(route), route);
  for (const route of ['/as/par', '/as/authorize', '/as/consent', '/as/token', '/rs/execute', '/as/jwks', '/api/run-all']) assert.ok(readme.includes(route), route);
  const ports = [...new Set([...readme.matchAll(/localhost:(\d{4,5})/g)].map((m) => Number(m[1])))];
  for (const p of ports) assert.equal(portProblem(p), null, String(p));
});

test('no tracked file (tests excepted: they name bad hosts as negative cases) names a non-reserved host', () => {
  const offenders = [];
  for (const f of trackedTextFiles()) {
    if (/\.(png|jpg|ico)$/.test(f) || /^server\/test\//.test(f) || f === 'scripts/repo.test.mjs' || f === 'scripts/check-forbidden-strings.test.mjs') continue; // tests name real-looking hosts on purpose, as negative cases
    const hosts = scanHosts(read(f)).filter((h) => /^[a-z0-9.-]+$/.test(h) && h !== '0.0.0.0' && !/^(www\.)?(rfc-editor\.org|datatracker\.ietf\.org|json-schema\.org|github\.com|raw\.githubusercontent\.com)$/.test(h));
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
    // CSS comments are prose (the shared stylesheet's comment says "no purple"); only the rules are checked.
    assert.doesNotMatch(read(f).replace(/\/\*[\s\S]*?\*\//g, ''), /\b(purple|violet|indigo)\b|#(?:[89ab][0-9a-f]){0}(?:7c3aed|8b5cf6|6d28d9)/i, f);
  }
});

test('pre-commit hook runs gitleaks and is the configured hooks path', (t) => {
  const hook = read('.githooks/pre-commit');
  assert.match(hook, /gitleaks protect --staged/);
  assert.ok(fs.statSync(path.join(ROOT, '.githooks/pre-commit')).mode & 0o111, 'hook must be executable');
  const cfg = spawnSync('git', ['config', 'core.hooksPath'], { cwd: ROOT, encoding: 'utf8' });
  if (cfg.status !== 0) return t.skip('not a git clone (hooks path is set per clone)');
  assert.equal(cfg.stdout.trim(), '.githooks');
});

test('content pack also validates against the kit schema when it is on this machine', (t) => {
  const candidates = [path.join(os.homedir(), 'Development/learning-hub/server/schema/content-pack.schema.json'), path.join(os.homedir(), 'Development/AI-DEMO2/planning/standalone-research/content-pack/content-pack.schema.json')];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) return t.skip('kit schema not present on this machine');
  assert.deepEqual(validatePack(JSON.parse(read('content-pack.json')), JSON.parse(fs.readFileSync(found, 'utf8'))), []);
});

test('shelf entry points at this repo compose file', () => {
  const [d] = JSON.parse(read('docs/shelf-entry.json')).demos;
  assert.ok(path.isAbsolute(d.composeFile) && d.composeFile.endsWith('/docker-compose.yml'));
  // The clone may live anywhere (CI checkouts, other machines), so pin the repo-relative tail and that the file exists in this repo.
  assert.ok(d.composeFile.endsWith('/intent-par-inspector/docker-compose.yml'), 'shelf entry must end with /intent-par-inspector/docker-compose.yml');
  assert.ok(fs.existsSync(path.join(ROOT, 'docker-compose.yml')));
});

test('CI workflow: hosted runner, Node 26 only, gitleaks and the forbidden-strings gate', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /pull_request/);
  assert.match(ci, /ubuntu-latest/);
  assert.doesNotMatch(ci.split('\n').filter((l) => /runs-on:/.test(l)).join('\n'), /self-hosted|macOS|RUNS_ON/);
  assert.match(ci, /node: \[26\]/);
  assert.match(ci, /gitleaks detect/);
  assert.match(ci, /secrets\.FORBIDDEN_STRINGS/);
  assert.match(ci, /npm run check:forbidden/);
});

test('dockerignore keeps secrets and modules out of the image build context', () => {
  const di = read('.dockerignore');
  for (const x of ['**/node_modules', '.env', '.git']) assert.ok(di.split('\n').includes(x), x);
});

test('reset script refuses a non-loopback host and the reset endpoint exists', async () => {
  const { reset } = await import('./reset.mjs');
  await assert.rejects(() => reset('http://as.example.invalid:4771'), /loopback only/);
  assert.match(read('server/src/app.js'), /api\.post\('\/reset'/);
});
