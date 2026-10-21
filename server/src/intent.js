// The intent: what the agent or user is asking to do. Normalised, validated, hashed.
// The hash is the binding: whatever the user approved is the hash, and every later hop compares against it.
import { createHash } from 'node:crypto';
import { scanHosts } from './safety.js';

export const INTENT_FIELDS = ['action', 'amount', 'currency', 'resource', 'nonce', 'description'];
// The fields a resource server compares at execution time. The nonce is the single-use handle, the description is display text.
export const ENFORCED_FIELDS = ['action', 'amount', 'currency', 'resource'];

// Inert text: control and bidi characters removed so a description cannot reshape the page or the trace.
export const inert = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim();

export function normalizeIntent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  if (raw.action !== undefined) out.action = String(raw.action);
  if (raw.amount !== undefined) out.amount = typeof raw.amount === 'string' && raw.amount.trim() !== '' ? Number(raw.amount) : raw.amount;
  if (raw.currency !== undefined) out.currency = String(raw.currency).toUpperCase();
  if (raw.resource !== undefined) out.resource = String(raw.resource);
  if (raw.nonce !== undefined) out.nonce = String(raw.nonce);
  if (raw.description !== undefined) out.description = inert(raw.description);
  return out;
}

// Returns a list of problems; empty = valid. `requireNonce` is false at PAR time, where the server assigns one.
export function validateIntent(i, { requireNonce = false } = {}) {
  const errors = [];
  if (!i) return ['intent must be a JSON object'];
  if (typeof i.action !== 'string' || !/^[a-z][a-z0-9_.:-]{1,63}$/.test(i.action)) errors.push('action must be a lowercase identifier such as payments.transfer');
  if (typeof i.amount !== 'number' || !Number.isFinite(i.amount) || i.amount <= 0 || i.amount > 1e9 || Math.round(i.amount * 100) !== i.amount * 100) errors.push('amount must be a positive number with at most 2 decimals');
  if (typeof i.currency !== 'string' || !/^[A-Z]{3}$/.test(i.currency)) errors.push('currency must be a 3-letter code');
  if (typeof i.resource !== 'string' || i.resource.length < 3 || i.resource.length > 200) errors.push('resource must be a string of 3 to 200 characters');
  else if (scanHosts(i.resource).length) errors.push('resource names a host that is not reserved (.invalid, .example)');
  if (i.description !== undefined && (typeof i.description !== 'string' || i.description.length > 160)) errors.push('description must be at most 160 characters');
  if (i.nonce !== undefined && !/^[A-Za-z0-9_-]{8,64}$/.test(i.nonce)) errors.push('nonce must be 8 to 64 URL-safe characters');
  if (requireNonce && !i.nonce) errors.push('nonce is required');
  return errors;
}

// Canonical form: fixed field order, so the same intent always hashes the same.
export function canonicalIntent(i) {
  return JSON.stringify(INTENT_FIELDS.map((k) => [k, i[k] ?? null]));
}
export const intentHash = (i) => createHash('sha256').update(canonicalIntent(i)).digest('base64url');

// Field-by-field differences, bound against attempted, over the enforced fields (or all with { all: true }).
export function diffIntent(bound, attempted, { all = false } = {}) {
  return (all ? INTENT_FIELDS : ENFORCED_FIELDS)
    .filter((f) => attempted[f] !== undefined && String(attempted[f]) !== String(bound[f]))
    .map((f) => ({ field: f, bound: bound[f], attempted: attempted[f] }));
}

// RFC 9396 style authorization_details carrying the intent.
export function toAuthorizationDetails(i) {
  return [{
    type: 'intent_action',
    actions: [i.action],
    locations: [i.resource],
    amount: { value: i.amount, currency: i.currency },
    identifier: i.nonce,
    ...(i.description ? { description: i.description } : {}),
  }];
}
