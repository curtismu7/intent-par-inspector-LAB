// Mock token signing. A throwaway ES256 key made at process start; nothing here is a real credential and the tokens
// are valid only against the in-process mock authorization server. The key never leaves memory.
import { generateKeyPairSync, sign, verify, createHash } from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

export function createKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = `mock-${createHash('sha256').update(JSON.stringify(jwk)).digest('hex').slice(0, 12)}`;
  return { privateKey, publicKey, kid, jwks: { keys: [{ ...jwk, kid, use: 'sig', alg: 'ES256' }] } };
}

export function signJwt(payload, keys) {
  const header = { alg: 'ES256', typ: 'at+jwt', kid: keys.kid };
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const sig = sign('sha256', Buffer.from(input), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64u(sig)}`;
}

// { ok:true, header, payload } or { ok:false, reason }.
export function verifyJwt(token, keys) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  let header; let payload;
  try { header = JSON.parse(fromB64u(parts[0])); payload = JSON.parse(fromB64u(parts[1])); } catch { return { ok: false, reason: 'malformed' }; }
  if (header.alg !== 'ES256') return { ok: false, reason: 'bad_alg' };
  const good = verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: keys.publicKey, dsaEncoding: 'ieee-p1363' }, fromB64u(parts[2]));
  return good ? { ok: true, header, payload } : { ok: false, reason: 'bad_signature' };
}

// Re-encodes the payload with changes but keeps the old signature: what an attacker editing a token can do.
export function forgePayload(token, changes) {
  const [h, p, s] = token.split('.');
  const payload = { ...JSON.parse(fromB64u(p)), ...changes };
  return `${h}.${b64u(JSON.stringify(payload))}.${s}`;
}

export function decodeJwt(token) {
  const [h, p] = String(token).split('.');
  try { return { header: JSON.parse(fromB64u(h)), payload: JSON.parse(fromB64u(p)) }; } catch { return null; }
}
