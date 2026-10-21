// Runtime netguard: zero real outbound. Every non-loopback socket, DNS lookup, fetch and UDP send is refused and recorded.
// The mock authorization server is in-process, so nothing in this app has a reason to leave the machine.
import dns from 'node:dns';
import net from 'node:net';
import dgram from 'node:dgram';
import { isLoopbackHost } from './safety.js';

let active = null;

export function installNetguard() {
  if (active) return active;
  const attempts = [];
  const real = {
    connect: net.Socket.prototype.connect, lookup: dns.lookup, fetch: globalThis.fetch, send: dgram.Socket.prototype.send,
  };
  const hostOf = (args) => {
    const a = args[0];
    if (a && typeof a === 'object' && !Array.isArray(a)) return a.path ? 'unix-socket' : (a.host || 'localhost');
    if (typeof a === 'string' && Number.isNaN(Number(a))) return 'unix-socket';
    return typeof args[1] === 'string' ? args[1] : 'localhost';
  };
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const host = hostOf(args);
    if (!isLoopbackHost(host)) { attempts.push(`socket:${host}`); throw new Error(`network blocked: ${host}`); }
    return real.connect.apply(this, args);
  };
  dns.lookup = function guardedLookup(host, ...rest) {
    if (!isLoopbackHost(host)) {
      attempts.push(`dns:${host}`);
      const cb = rest.find((r) => typeof r === 'function');
      return cb?.(new Error(`network blocked: ${host}`));
    }
    return real.lookup.call(dns, host, ...rest);
  };
  globalThis.fetch = async function guardedFetch(input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!isLoopbackHost(url.hostname)) { attempts.push(`fetch:${url.hostname}`); throw new Error(`network blocked: ${url.hostname}`); }
    return real.fetch(input, init);
  };
  dgram.Socket.prototype.send = function guardedSend(...args) {
    const addr = args.find((a) => typeof a === 'string' && Number.isNaN(Number(a)));
    if (!addr || !isLoopbackHost(addr)) { attempts.push(`udp:${addr ?? 'unknown'}`); throw new Error(`network blocked: ${addr}`); }
    return real.send.apply(this, args);
  };
  active = {
    attempts,
    restore() {
      net.Socket.prototype.connect = real.connect; dns.lookup = real.lookup; globalThis.fetch = real.fetch; dgram.Socket.prototype.send = real.send;
      active = null;
    },
  };
  return active;
}

// Proves the guard works by trying to leave and checking that every attempt is refused and recorded.
// Installs the guard if it is not already on. Returns { ok, blocked, detail }. Never touches the network: the guard throws first.
export async function netguardSelfTest() {
  const guard = installNetguard();
  const before = guard.attempts.length;
  const tried = [];
  const refused = async (label, fn) => { try { await fn(); tried.push(`${label}: NOT blocked`); } catch (e) { tried.push(/network blocked/.test(e.message) ? `${label}: blocked` : `${label}: failed differently (${e.message})`); } };
  await refused('fetch', () => fetch('http://self-test.invalid/'));
  await refused('socket', () => new Promise((_, rej) => { const s = new net.Socket(); s.on('error', rej); try { s.connect(80, 'self-test.invalid'); } catch (e) { rej(e); } }));
  await refused('dns', () => new Promise((res, rej) => dns.lookup('self-test.invalid', (e) => (e ? rej(e) : res()))));
  await refused('udp', () => { const s = dgram.createSocket('udp4'); try { s.send('x', 9, 'self-test.invalid'); } finally { s.close(); } });
  const blocked = guard.attempts.length - before;
  guard.attempts.length = before; // self-test attempts are not real attempts
  return { ok: tried.every((t) => t.endsWith(': blocked')) && blocked === 4, blocked, detail: tried.join('; ') };
}
