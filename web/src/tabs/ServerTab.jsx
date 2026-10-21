import React, { useState } from "react";
import { Inert } from "../lib/Inert.jsx";
import { fill } from "../lib/fill.js";
import { shownConsent } from "../lib/session.js";
import { ScenarioBar, StoryPlayer } from "./Scenarios.jsx";

const FIELDS = ["action", "amount", "currency", "resource", "nonce", "description"];

/** The consent screen: the exact bound intent, field by field, as the server holds it. */
export function ConsentScreen({ shown, cast, actions }) {
  const [tamperHash, setTamperHash] = useState(false);
  if (!shown) return <p className="muted">No consent screen yet. Push a request, then open /authorize.</p>;
  return (
    <div className="consent" data-testid="consent">
      <p className="story__eyebrow">{fill("{{user}} IS ASKED TO APPROVE", cast)}</p>
      <p><Inert text={shown.client} /> wants to do this:</p>
      <dl className="kv">
        {FIELDS.filter((f) => shown.intent[f] !== undefined).map((f) => <React.Fragment key={f}><dt>{f}</dt><dd><Inert text={String(shown.intent[f])} /></dd></React.Fragment>)}
        <dt>intent_hash</dt><dd><code><Inert text={shown.intent_hash} /></code></dd>
        <dt>came from</dt><dd><span className={`pill ${shown.binding === "par" ? "yes" : "no"}`}>{shown.binding === "par" ? "pushed request (PAR)" : "browser link (editable)"}</span></dd>
      </dl>
      <p className="muted small"><Inert text={shown.note} /></p>
      {actions && (
        <>
          <label className="check"><input type="checkbox" checked={tamperHash} onChange={(e) => setTamperHash(e.target.checked)} /> Approve a hash that is not the one shown (tamper)</label>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => actions.decide("approve", { tamper: tamperHash })} disabled={actions.busy}>Approve exactly this</button>
            <button type="button" className="btn" onClick={() => actions.decide("deny")} disabled={actions.busy}>Deny</button>
          </div>
        </>
      )}
    </div>
  );
}

export function MessageLog({ session, cursor, setCursor }) {
  if (!session) return <p className="muted">No messages yet.</p>;
  return (
    <ol className="log" aria-label="Messages in order">
      {session.messages.map((m, i) => {
        const bad = m.response.status >= 400;
        const stepIndex = session.steps.findIndex((s) => s.messageSeq === (m.seq ?? i + 1));
        return (
          <li key={i} className={stepIndex === cursor ? "is-current" : ""}>
            <button type="button" className="story__step" onClick={() => stepIndex >= 0 && setCursor(stepIndex)}>
              <span className="story__n">{m.seq ?? i + 1}</span>
              <span>{m.request.method} <code>{m.request.path}</code> <span className="muted">{m.from} to {m.to}</span></span>
              <span className={`story__tag ${bad ? "refused" : ""}`}>{bad ? `REFUSED ${m.response.status} ${m.response.body?.reason ?? ""}` : `OK ${m.response.status}`}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export default function ServerTab({ app }) {
  const { wb, cast, session, cursor, setCursor, active } = app;
  const [tamperLink, setTamperLink] = useState(false);
  const manual = active === "manual";
  const shown = (manual ? wb.ctx.shown : null) || shownConsent(session);
  return (
    <>
      <h2>The authorization server</h2>
      <p className="lede" data-admin-only>{fill("{{user}}'s browser opens /authorize with only the request_uri. The server resolves it once, shows {{user}} the bound intent, and records the approval against its hash.", cast)}</p>
      <section className="card" aria-labelledby="az-h">
        <h3 id="az-h">Your request</h3>
        <label className="check"><input type="checkbox" checked={tamperLink} onChange={(e) => setTamperLink(e.target.checked)} /> Tamper: add an edited intent (ten times the amount) to the link</label>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => wb.authorize({ tamper: tamperLink })} disabled={wb.busy || !wb.ctx.requestUri}>Open /authorize</button>
          <button type="button" className="btn" onClick={wb.redeem} disabled={wb.busy || !wb.ctx.code}>Redeem the code for a token</button>
        </div>
        {!wb.ctx.requestUri && <p className="muted small">Push a request on the Request tab first. Opening the same request_uri twice shows the one-time rule.</p>}
        {wb.error && <p className="alert" role="alert">{wb.error}</p>}
        <h4>Consent screen</h4>
        <ConsentScreen shown={shown} cast={cast} actions={manual && wb.ctx.shown ? wb : null} />
      </section>
      <section className="card" aria-labelledby="log-h">
        <h3 id="log-h">Messages</h3>
        <MessageLog session={session} cursor={cursor} setCursor={setCursor} />
      </section>
      <ScenarioBar app={app} />
      <StoryPlayer app={app} />
    </>
  );
}
