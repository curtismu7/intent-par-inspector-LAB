import React, { useState } from "react";
import { Inert } from "../lib/Inert.jsx";
import { INTENT_CLAIMS } from "../lib/jwt.js";
import Json from "../components/JsonPane.jsx";

/** Raw mock token, then the header and claims. The claims that carry the bound intent are stood out in the pane and also named with a word, not only a colour. */
export function TokenPanel({ token }) {
  if (!token) return <p className="muted">No token yet. A token is issued after the user approves and the code is redeemed.</p>;
  const d = token.decoded;
  const bound = d ? INTENT_CLAIMS.filter((k) => k in d.payload) : [];
  return (
    <div data-testid="token-panel">
      <p className="muted small">Mock-issued: signed with a throwaway key that exists only in this process. It is shown raw on purpose.</p>
      <h4>Raw token</h4>
      <Json value={token.raw} label="Raw token" testId="raw-token" />
      {d ? (
        <>
          <h4>Header</h4>
          <Json value={d.header} label="Token header" testId="token-header" />
          <h4>Claims</h4>
          <Json value={d.payload} label="Token claims" testId="token-claims" hot={INTENT_CLAIMS} />
          {bound.length > 0 && (
            <ul className="bound" aria-label="Claims that carry the bound intent">
              {bound.map((k) => <li key={k} data-testid="intent-claim"><code>{k}</code><span className="pill yes">BOUND INTENT</span></li>)}
            </ul>
          )}
        </>
      ) : <p className="alert">The token could not be decoded.</p>}
    </div>
  );
}

function ExecutePanel({ wb }) {
  const [amount, setAmount] = useState("");
  const last = [...(wb.session?.messages || [])].reverse().find((m) => m.op === "execute");
  const body = last?.response.body;
  return (
    <section className="card" aria-labelledby="ex-h">
      <h3 id="ex-h">Use the token on the resource</h3>
      <div className="controls">
        <label>Amount to send (leave empty for the approved amount)
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" spellCheck="false" />
        </label>
        <button type="button" className="btn primary" onClick={() => wb.execute({ amount })} disabled={wb.busy}>Execute</button>
      </div>
      <p className="muted small">Try a different amount, then press Execute twice with the approved one to see the single-use rule.</p>
      {last && (last.response.status === 200
        ? <div className="verdict ok" data-testid="exec-ok">EXECUTED: receipt <Inert text={body.receipt.id} />, {body.receipt.action} {body.receipt.amount} {body.receipt.currency}</div>
        : <div className="alert" role="alert" data-testid="exec-refused"><strong>REFUSED {last.response.status}: <Inert text={body.reason} /></strong> <Inert text={body.error_description} />{body.mismatches?.map((m) => <div key={m.field}>{m.field}: approved <code><Inert text={String(m.bound)} /></code>, attempted <code><Inert text={String(m.attempted)} /></code></div>)}</div>)}
    </section>
  );
}

export default function TokenTab({ app }) {
  const { session, wb } = app;
  return (
    <>
      <h2>The token</h2>
      <p className="lede">The bound intent is copied into the token as <code>authorization_details</code> and an <code>intent</code> claim. The resource server compares what is being attempted with it.</p>
      <section className="card" aria-labelledby="tk-h"><h3 id="tk-h">Issued token</h3><TokenPanel token={session?.token} /></section>
      {session?.source === "manual" && session.token && <ExecutePanel wb={wb} />}
    </>
  );
}
