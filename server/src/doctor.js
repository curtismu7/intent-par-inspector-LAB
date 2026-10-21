// Preflight checks shared by `npm run doctor` and GET /api/health. Never prints a secret, needs no network.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import { assertBindAllowed, bindHost, portProblem, scanHosts } from './safety.js';
import { netguardSelfTest } from './netguard.js';
import { storyCorpus, VERTICALS } from './stories.js';
import { runAll } from './runner.js';

export async function runChecks({ env = process.env } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 20 ? 'pass' : 'fail', `v${process.versions.node} (need >= 20)`);

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.INTENT_BIND ? ' (INTENT_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = env.PORT === undefined || env.PORT === '' ? 4771 : Number(env.PORT);
  const problem = portProblem(port);
  add('port-range', problem ? 'fail' : 'pass', problem || `${port} is inside 4700-5299 and not reserved`);

  const bad = storyCorpus().map(({ where, text }) => ({ where, hosts: scanHosts(text) })).filter((x) => x.hosts.length);
  add('story-hosts', bad.length ? 'fail' : 'pass', bad.length ? `non-reserved hosts: ${bad.map((b) => `${b.where}: ${b.hosts.join(', ')}`).join('; ')}` : 'every host in every story is .invalid, .example or loopback');

  const ng = await netguardSelfTest();
  add('netguard', ng.ok ? 'pass' : 'fail', ng.ok ? `blocked fetch, socket, socket-by-IP, dns lookup, dns resolve and udp to a non-loopback host (${ng.blocked}/6)` : ng.detail);

  try {
    const results = VERTICALS.flatMap((v) => runAll(v.id));
    const failed = results.filter((r) => !r.pass);
    add('scenarios', failed.length ? 'fail' : 'pass', failed.length ? `scenarios not behaving as written: ${failed.map((f) => f.id).join(', ')}` : `${results.length} scenario runs across ${VERTICALS.length} verticals all behave as written`);
  } catch (e) { add('scenarios', 'fail', e.message); }

  add('tenant', 'pass', 'mock only: no tenant, no credentials, no outbound network');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
