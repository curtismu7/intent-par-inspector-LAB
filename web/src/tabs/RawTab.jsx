import React, { useEffect, useState } from "react";
import { Inert } from "../lib/Inert.jsx";

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
            <section className="card"><h3>Request</h3><Inert block text={m.request.raw} testid="raw-request" /></section>
            <section className="card"><h3>Response</h3><Inert block text={m.response.raw} testid="raw-response" /></section>
          </div>
        </>
      )}
    </>
  );
}
