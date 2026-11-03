// Mock token signing. A throwaway ES256 key made at process start; nothing here is a real credential and the tokens
// are valid only against the in-process mock authorization server. The key never leaves memory.
import { createECDH, createPrivateKey, createPublicKey, sign, verify, createHash } from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

// The key is made with ECDH + createPrivateKey — never with the EC crypto keygen job, which on Node 20 (20.20.2)
// can abort the whole process (SIGABRT in uv_mutex_lock, KeyPairGenConfig destructor) when a later allocation triggers a GC.
// The public JWK is built from the raw point, so no KeyObject export (another allocation point) is needed either.
export function createKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const point = ecdh.getPublicKey(); // 0x04 || X(32) || Y(32)
  const pub = { kty: 'EC', crv: 'P-256', x: b64u(point.subarray(1, 33)), y: b64u(point.subarray(33, 65)) };
  const privateKey = createPrivateKey({ key: { ...pub, d: b64u(ecdh.getPrivateKey()) }, format: 'jwk' });
  const publicKey = createPublicKey({ key: pub, format: 'jwk' });
  const kid = `mock-${createHash('sha256').update(JSON.stringify(pub)).digest('hex').slice(0, 12)}`;
  return { privateKey, publicKey, kid, jwks: { keys: [{ ...pub, kid, use: 'sig', alg: 'ES256' }] } };
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
