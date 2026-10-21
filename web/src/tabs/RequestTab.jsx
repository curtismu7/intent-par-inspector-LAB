import React from "react";
import { Inert } from "../lib/Inert.jsx";
import { fill } from "../lib/fill.js";

function Field({ label, children, hint }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small className="muted">{hint}</small>}</label>;
}

/** What came back from the push: the request_uri, or the refusal with its reason, in words. */
export function PushResult({ message }) {
  if (!message) return <p className="muted">Nothing pushed yet.</p>;
  const { status, body } = message.response;
  if (status !== 201) {
    return (
      <div className="alert" role="alert" data-testid="push-refused">
        <strong>REFUSED {status}: <Inert text={body.error} /></strong>
        <div>Reason: <code><Inert text={body.reason} /></code></div>
        <div><Inert text={body.error_description} /></div>
      </div>
    );
  }
  return (
    <dl className="kv" data-testid="push-ok">
      <dt>Status</dt><dd><span className="pill yes">201 Created</span></dd>
      <dt>request_uri</dt><dd><code data-testid="request-uri"><Inert text={body.request_uri} /></code></dd>
      <dt>expires_in</dt><dd>{body.expires_in} seconds, one use</dd>
      <dt>intent_hash</dt><dd><code><Inert text={body.intent_hash} /></code></dd>
    </dl>
  );
}

export default function RequestTab({ app }) {
  const { wb, catalog, cast, go } = app;
  const { form, setForm } = wb;
  const client = catalog.clients.find((c) => c.id === form.client);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setIntent = (k) => (e) => setForm((f) => ({ ...f, intent: { ...f.intent, [k]: e.target.value } }));
  const pickClient = (e) => { const c = catalog.clients.find((x) => x.id === e.target.value); setForm((f) => ({ ...f, client: c.id, redirect_uri: c.redirectUri })); };
  const pushed = wb.session?.messages[0]?.op === "par" ? wb.session.messages[0] : null;

  return (
    <>
      <h2>Build the request</h2>
      <p className="lede">{fill("{{agent}} asks for {{item}} on behalf of {{user}}. Edit anything, including the intent, then push it to the mock authorization server.", cast)} Break something on purpose to see the refusal.</p>
      <div className="cols">
        <section className="card" aria-labelledby="rq-h">
          <h3 id="rq-h">Authorization request</h3>
          <Field label="Client" hint={client && !client.requirePar ? "PAR is not required for this client: the contrast case." : "PAR is required for this client."}>
            <select value={form.client} onChange={pickClient}>{catalog.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
          <Field label="redirect_uri" hint="Must be registered for the client. Edit it to see the refusal."><input value={form.redirect_uri} onChange={set("redirect_uri")} spellCheck="false" /></Field>
          <Field label="response_type"><input value={form.response_type} onChange={set("response_type")} spellCheck="false" /></Field>
          <Field label="scope"><input value={form.scope} onChange={set("scope")} spellCheck="false" /></Field>
          <Field label="state"><input value={form.state} onChange={set("state")} spellCheck="false" /></Field>
          <Field label="login_hint"><input value={form.login_hint} onChange={set("login_hint")} spellCheck="false" /></Field>
          <p className="muted small">PKCE (S256) and the mock client secret are added for you. The Raw tab shows them.</p>
        </section>
        <section className="card" aria-labelledby="in-h">
          <h3 id="in-h">Intent: what is being asked</h3>
          <Field label="action"><input value={form.intent.action} onChange={setIntent("action")} spellCheck="false" /></Field>
          <Field label="amount"><input value={form.intent.amount} onChange={setIntent("amount")} inputMode="decimal" spellCheck="false" /></Field>
          <Field label="currency"><input value={form.intent.currency} onChange={setIntent("currency")} maxLength={3} spellCheck="false" /></Field>
          <Field label="resource" hint="Reserved .invalid or .example hosts only."><input value={form.intent.resource} onChange={setIntent("resource")} spellCheck="false" /></Field>
          <Field label="description"><input value={form.intent.description} onChange={setIntent("description")} /></Field>
          <label className="check"><input type="checkbox" checked={!form.sendIntent} onChange={(e) => setForm((f) => ({ ...f, sendIntent: !e.target.checked }))} /> Leave the intent out (the server should refuse)</label>
        </section>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={wb.push} disabled={wb.busy}>Push to mock AS</button>
        {pushed?.response.status === 201 && <button type="button" className="btn" onClick={() => { go("server"); document.getElementById("main")?.focus(); }}>Next: open /authorize on the Server tab</button>}
      </div>
      {wb.error && <p className="alert" role="alert">{wb.error}</p>}
      <section className="card" aria-labelledby="ru-h">
        <h3 id="ru-h">Pushed request result</h3>
        <PushResult message={pushed} />
      </section>
    </>
  );
}
