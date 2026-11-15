import React, { useEffect, useState } from "react";
import Json from "../components/JsonPane.jsx";
import { INTENT_CLAIMS } from "../lib/jwt.js";

// What a reader looks for on the wire: the pushed request_uri and the bound intent (errors and reasons are already in the alert colour).
const WIRE_HOT = ["request_uri", ...INTENT_CLAIMS];

export default function RawTab({ app }) {
  const { session, cursor } = app;
  const [idx, setIdx] = useState(0);
  const messages = session?.messages || [];
  useEffect(() => {
    const seq = session?.steps[cursor]?.messageSeq;
    if (seq) setIdx(seq - 1);
  }, [cursor, session]);
  const m = messages[Math.min(idx, messages.length - 1)];
  return (
    <>
      <h2>Raw messages</h2>
      <p className="lede">Exactly what went over the wire, headers and bodies, including the mock client secret and the traceparent. Text is shown, never run.</p>
      {!m ? <p className="muted">No messages yet. Push a request or run a scenario.</p> : (
        <>
          <div className="card controls">
            <label>Message
              <select value={Math.min(idx, messages.length - 1)} onChange={(e) => setIdx(Number(e.target.value))}>
                {messages.map((x, i) => <option key={i} value={i}>{i + 1} · {x.request.method} {x.request.path} · {x.response.status}</option>)}
              </select>
            </label>
          </div>
          <div className="cols">
            <section className="card"><h3>Request</h3><Json value={m.request.raw} label="Request" testId="raw-request" hot={WIRE_HOT} /></section>
            <section className="card"><h3>Response</h3><Json value={m.response.raw} label="Response" testId="raw-response" hot={WIRE_HOT} /></section>
          </div>
        </>
      )}
    </>
  );
}
