import { useCallback, useMemo, useState } from "react";
import { callMock, getBuilder } from "./api.js";
import { OPS, fromManual } from "./session.js";

export function defaultForm(catalog) {
  const client = catalog.clients.find((c) => c.id === "agent-app") || catalog.clients[0];
  const user = catalog.verticals.find((v) => v.id === catalog.vertical)?.cast.user || "user";
  const { action, amount, currency, resource, description } = catalog.intent;
  return { client: client.id, redirect_uri: client.redirectUri, response_type: "code", scope: "intent", state: "demo-state", login_hint: user.toLowerCase(), sendIntent: true, intent: { action, amount: String(amount), currency, resource, description } };
}

const tamperedIntent = (intent) => ({ ...intent, amount: Number(intent.amount) * 10 });

/** The hand-driven flow: push, authorize, consent, token, execute. Every call goes to this page's own origin and is recorded as a trace message. */
export function useWorkbench(catalog) {
  const [form, setForm] = useState(() => defaultForm(catalog));
  const [messages, setMessages] = useState([]);
  const [ctx, setCtx] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const send = useCallback(async (spec, { fresh = false } = {}) => {
    setBusy(true); setError(null);
    try {
      const msg = await callMock({ ...OPS[spec.op], ...spec });
      setMessages((m) => (fresh ? [msg] : [...m, msg]));
      return msg;
    } catch (e) { setError(e.message || "request failed"); return null; } finally { setBusy(false); }
  }, []);

  const push = useCallback(async () => {
    setBusy(true); setError(null);
    let b;
    try { b = await getBuilder(form.client); } catch (e) { setError(e.message); setBusy(false); return null; }
    const opt = (v) => (v === "" ? undefined : v);
    const body = {
      client_id: b.client_id, client_secret: b.client_secret, response_type: form.response_type, redirect_uri: opt(form.redirect_uri), scope: opt(form.scope), state: opt(form.state),
      code_challenge: b.code_challenge, code_challenge_method: b.code_challenge_method, login_hint: opt(form.login_hint), ...(form.sendIntent ? { intent: form.intent } : {}),
    };
    const msg = await send({ op: "par", method: "POST", path: "/as/par", body }, { fresh: true });
    setCtx(msg && msg.response.status === 201 ? { client: b.client_id, secret: b.client_secret, redirectUri: body.redirect_uri, verifier: b.code_verifier, requestUri: msg.response.body.request_uri, expiresIn: msg.response.body.expires_in, intentHash: msg.response.body.intent_hash } : {});
    return msg;
  }, [form, send]);

  const authorize = useCallback(async ({ tamper = false } = {}) => {
    if (!ctx.requestUri) return null;
    const query = { client_id: ctx.client, request_uri: ctx.requestUri, ...(tamper ? { intent: tamperedIntent(form.intent) } : {}) };
    const msg = await send({ op: "authorize", method: "GET", path: "/as/authorize", query });
    if (msg?.response.status === 200) setCtx((c) => ({ ...c, txn: msg.response.body.txn, shown: msg.response.body, code: null, token: null }));
    return msg;
  }, [ctx, form.intent, send]);

  const decide = useCallback(async (decision, { tamper = false } = {}) => {
    if (!ctx.shown) return null;
    const h = ctx.shown.intent_hash;
    const msg = await send({ op: "consent", method: "POST", path: "/as/consent", body: { txn: ctx.txn, decision, approved_intent_hash: tamper ? h.slice(1) + h[0] : h } });
    if (msg?.response.body?.code) setCtx((c) => ({ ...c, code: msg.response.body.code }));
    return msg;
  }, [ctx, send]);

  const redeem = useCallback(async () => {
    if (!ctx.code) return null;
    const body = { client_id: ctx.client, client_secret: ctx.secret, grant_type: "authorization_code", code: ctx.code, redirect_uri: ctx.redirectUri, code_verifier: ctx.verifier };
    return send({ op: "token", method: "POST", path: "/as/token", body });
  }, [ctx, send]);

  const execute = useCallback(async ({ amount } = {}) => {
    const issued = [...messages].reverse().find((m) => m.op === "token" && m.response.status === 200);
    if (!issued || !ctx.shown) return null;
    const i = ctx.shown.intent;
    const body = { action: i.action, amount: amount === undefined || amount === "" ? i.amount : amount, currency: i.currency, resource: i.resource, nonce: i.nonce };
    return send({ op: "execute", method: "POST", path: "/rs/execute", json: true, headers: { authorization: `Bearer ${issued.response.body.access_token}` }, body });
  }, [messages, ctx.shown, send]);

  const reset = useCallback((nextCatalog) => { setMessages([]); setCtx({}); setError(null); setForm(defaultForm(nextCatalog || catalog)); }, [catalog]);
  const session = useMemo(() => (messages.length ? fromManual(messages) : null), [messages]);

  return { form, setForm, ctx, busy, error, session, push, authorize, decide, redeem, execute, reset };
}
