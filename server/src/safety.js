// Safety rules. Pure functions plus three tiny middlewares. No I/O.
//  1. Loopback bind only unless INTENT_BIND is set on purpose.
//  2. Host header must be a loopback name (DNS-rebinding defence).
//  3. A write must be same-origin: a cross-origin Origin, or a cross-site Sec-Fetch-Site, is refused.
//  4. Every host that appears in any shipped text is reserved (.invalid / .example / apex of example.com|net|org).
//  5. Ports are 4700-5299 and never one of the forbidden ones.

export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

export function bindHost(env = process.env) { return env.INTENT_BIND || '127.0.0.1'; }

export function assertBindAllowed(host, env = process.env) {
  if (isLoopbackHost(host) || env.INTENT_BIND) return host;
  throw new Error(`refusing to bind ${host}: loopback only. Set INTENT_BIND to opt in.`);
}

const FORBIDDEN_PORTS = new Set([8080, 5173, 3900, 4000, 4400, 4510, 4600, 4601, 18080, 19080, 19090]);
export function portProblem(port) {
  if (!Number.isInteger(port)) return 'PORT is not an integer';
  if (FORBIDDEN_PORTS.has(port)) return `port ${port} is reserved for something else`;
  if (port < 4700 || port > 5299) return `port ${port} is outside 4700-5299`;
  return null;
}
export function resolvePort(env = process.env) {
  const port = env.PORT === undefined || env.PORT === '' ? 4771 : Number(env.PORT);
  const problem = portProblem(port);
  if (problem) throw new Error(problem);
  return port;
}

export function isReservedHost(host) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  return /(^|\.)(invalid|example)$/.test(h) || /^example\.(com|net|org)$/.test(h);
}

const NETWORK_URL = /\b(?:https?|wss?|ftp|sftp|ssh|smtp|tcp|udp):\/\/([^\s/?#"'<>\\]+)/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const stripAuthority = (a) => a.replace(/^[^@]*@/, '').replace(/:\d+$/, '');

// Every hostname or IP found in text that is not reserved. Loopback names in URLs are allowed. Empty = clean.
export function scanHosts(text) {
  const found = new Set();
  const s = String(text);
  for (const m of s.matchAll(NETWORK_URL)) found.add(stripAuthority(m[1]).toLowerCase());
  for (const m of s.matchAll(EMAIL)) found.add(m[1].toLowerCase());
  for (const m of s.matchAll(IPV4)) found.add(m[0]);
  return [...found].filter((h) => !isReservedHost(h) && !isLoopbackHost(h)).sort();
}

// The family lab-proxy (https://local.ping-devops.com:8443) sends Host `<name>:<this lab's port>` for a name listed in
// LAB_ALLOWED_HOSTS (a comma list of host names, no ports). Loopback always works; unset means loopback only. index.js
// parses it before the server starts and passes the set to createApp.
export function labProxyHosts(env = process.env, port = resolvePort(env)) {
  return new Set(String(env.LAB_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).map((n) => `${n}:${port}`));
}

// Behind the lab-proxy the browser's Origin is the proxy's (https://local.ping-devops.com:8443) while Host is this lab's own
// name. X-Forwarded-Host/-Proto are believed only when Host is one of proxyHosts (never loopback), so a request that did not
// come through the proxy cannot use them.
export function isProxiedSameOrigin(headers, proxyHosts) {
  const xfh = String(headers['x-forwarded-host'] || '').trim().toLowerCase();
  const xfp = String(headers['x-forwarded-proto'] || '').trim().toLowerCase();
  return proxyHosts.has(String(headers.host || '').toLowerCase()) && xfh !== '' && (xfp === 'https' || xfp === 'http')
    && headers.origin === `${xfp}://${xfh}`;
}

export function makeHostCheck(proxyHosts = new Set()) {
  return function hostCheck(req, res, next) {
    const raw = String(req.headers.host || '');
    const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.replace(/:\d+$/, '');
    if (!isLoopbackHost(host) && !proxyHosts.has(raw.toLowerCase())) return res.status(403).json({ error: 'bad_host', message: 'Host must be a loopback name' });
    next();
  };
}
export const hostCheck = makeHostCheck();

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export function makeSameOriginWrites(proxyHosts = new Set()) {
  return function sameOriginWrites(req, res, next) {
    if (!WRITE.has(req.method)) return next();
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === req.headers.host; } catch { /* malformed */ }
      if (!ok && !isProxiedSameOrigin(req.headers, proxyHosts)) return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
    }
    next();
  };
}
export const sameOriginWrites = makeSameOriginWrites();
