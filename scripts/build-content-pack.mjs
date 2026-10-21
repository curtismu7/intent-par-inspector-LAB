// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the scenarios.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenarios = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/data/scenarios.json'), 'utf8'));
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function buildPack() {
  return {
    schema: 'demo-content-pack/1',
    id: 'intent-par-inspector',
    title: 'Intent / PAR Inspector',
    version,
    demo: {
      id: 'intent-par-inspector', name: 'Intent / PAR Inspector', catalog: 'C40',
      baseUrl: 'http://localhost:4771', doctor: '/api/health', tags: ['par', 'rfc-9126', 'intent-binding', 'rar', 'mock'],
    },
    glossary: [
      { id: 'par', term: 'Pushed Authorization Request (PAR)', definition: 'RFC 9126. The client sends the authorization request parameters straight to the authorization server over an authenticated back channel and gets back a short-lived, one-time request_uri. The browser then carries only client_id and request_uri.', aliases: ['pushed authorization request', 'RFC 9126'] },
      { id: 'request-uri', term: 'request_uri', definition: 'A reference to a pushed request, such as urn:ietf:params:oauth:request_uri:abc. It is short-lived (60 seconds here), single-use, and bound to the client that pushed it.' },
      { id: 'intent', term: 'Intent', definition: 'What the agent or user is asking to do: the action, the amount and currency, and the resource it applies to, plus a nonce. The authorization server binds it at PAR time and every later hop checks it is unchanged.' },
      { id: 'intent-binding', term: 'Intent binding', definition: 'Holding the intent on the server from PAR onward and tying it to the consent, the code and the token by hash, so a token only works for the exact thing the user approved.' },
      { id: 'authorization-details', term: 'authorization_details', definition: 'RFC 9396 Rich Authorization Requests. A JSON array that says in structured form what a token is for. This mock copies the bound intent into it.', aliases: ['RAR', 'RFC 9396'] },
      { id: 'require-par', term: 'Require PAR', definition: 'A client setting (require_pushed_authorization_requests in RFC 9126). When on, the authorization endpoint refuses any request that does not use a request_uri.' },
      { id: 'single-use-intent', term: 'Single-use intent', definition: 'A token issued for one intent executes it once. A second run, even of the same action, is refused by the resource server.' },
    ],
    sources: [
      { id: 'rfc9126', title: 'RFC 9126: OAuth 2.0 Pushed Authorization Requests', url: 'https://www.rfc-editor.org/rfc/rfc9126', kind: 'standard', use: 'PAR endpoint rules, request_uri lifetime and one-time use, require_pushed_authorization_requests', status: 'not-read', checked: '2026-10-21' },
      { id: 'rfc9396', title: 'RFC 9396: OAuth 2.0 Rich Authorization Requests', url: 'https://www.rfc-editor.org/rfc/rfc9396', kind: 'standard', use: 'authorization_details shape used for the bound intent', status: 'not-read', checked: '2026-10-21' },
      { id: 'rfc7636', title: 'RFC 7636: Proof Key for Code Exchange', url: 'https://www.rfc-editor.org/rfc/rfc7636', kind: 'standard', use: 'S256 code_challenge required by the mock', status: 'not-read', checked: '2026-10-21' },
    ],
    cards: [
      { id: 'try-happy', label: 'Run the happy path', description: 'Push, approve and execute with the intent intact.', group: 'try-it', action: { type: 'route', href: '/#scenario-S01' }, terms: ['par', 'request-uri', 'intent'], story: 'S01' },
      { id: 'try-hitl', label: 'Agent proposes, human approves', description: 'Mark approves one exact plane ticket; the token works for nothing else.', group: 'try-it', action: { type: 'route', href: '/#scenario-S02' }, terms: ['intent-binding', 'single-use-intent'], story: 'S02' },
      { id: 'try-tamper', label: 'Tamper with the request', description: 'Edit the amount, swap the resource, replay or expire the request_uri.', group: 'try-it', action: { type: 'route', href: '/#scenario-S03' }, terms: ['request-uri', 'intent-binding'], story: 'S03' },
      { id: 'try-contrast', label: 'Contrast: no PAR', description: 'The same attack on a client that is not required to push.', group: 'try-it', action: { type: 'route', href: '/#scenario-S13' }, terms: ['require-par'], story: 'S13' },
      { id: 'concept-par', label: 'What PAR changes', description: 'Why the browser stops carrying the request.', group: 'concept', action: { type: 'route', href: '/#concept-par' }, terms: ['par', 'authorization-details'] },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: scenarios.map((s) => ({ id: s.id, title: s.title, say: s.takeaway })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
  console.log('wrote content-pack.json');
}
