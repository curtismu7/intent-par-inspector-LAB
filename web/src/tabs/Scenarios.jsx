import React from "react";
import { Inert } from "../lib/Inert.jsx";
import { fill } from "../lib/fill.js";
import { VERDICT_TEXT } from "../lib/session.js";

const KIND = { happy: "Works", hitl: "Human approves", attack: "Attack", contrast: "Contrast" };
// In a story, a refusal is the point (green). In a hand-driven request it is a stop the SE caused (amber).
const verdictClass = (v, source) => (v === "completed" ? "ok" : v === "blocked" ? (source === "scenario" ? "ok" : "hold") : v === "attack-succeeded" ? "deny" : "hold");

/** Tamper-scenario picker with Run and Reset. The server runs the story on a fresh mock AS and returns the trace. */
export function ScenarioBar({ app }) {
  const { catalog, scenarioId, setScenarioId, doRun, running, resetAll, runError } = app;
  const picked = catalog.scenarios.find((s) => s.id === scenarioId);
  return (
    <section className="card" aria-labelledby="scn-h">
      <h3 id="scn-h">Tamper scenarios</h3>
      <div className="controls">
        <label>Scenario
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            {catalog.scenarios.map((s) => <option key={s.id} value={s.id}>{s.id} · {KIND[s.kind] || s.kind} · {s.title}</option>)}
          </select>
        </label>
        <button type="button" className="btn primary" onClick={doRun} disabled={running}>{running ? "Running..." : "Run"}</button>
        <button type="button" className="btn" onClick={resetAll}>Reset scenario</button>
      </div>
      {picked && <p className="muted small"><Inert text={fill(picked.takeaway, app.cast)} /></p>}
      {runError && <p className="alert" role="alert">{runError}</p>}
    </section>
  );
}

/** The talk track: one line per step, {{cast}} tokens filled from the chosen persona. Prev and Next move the highlight shared with the diagram. */
export function StoryPlayer({ app }) {
  const { session, cursor, setCursor, cast } = app;
  if (!session) return <section className="story" aria-label="Story"><p className="muted">Pick a scenario and press Run, or push a request by hand. The story for what happens shows up here.</p></section>;
  const n = session.steps.length;
  return (
    <section className="story" aria-labelledby="story-h">
      <p className="story__eyebrow">{session.source === "scenario" ? "STORY" : "YOUR REQUEST"}</p>
      <h3 id="story-h" className="story__title"><Inert text={fill(session.title, cast)} /></h3>
      <p className={`verdict ${verdictClass(session.verdict, session.source)}`} data-testid="verdict">{VERDICT_TEXT[session.verdict] || session.verdict}</p>
      <div className="story__controls">
        <button type="button" className="btn" onClick={() => setCursor(Math.max(0, cursor - 1))} disabled={cursor <= 0}>Previous step</button>
        <button type="button" className="btn" onClick={() => setCursor(Math.min(n - 1, cursor + 1))} disabled={cursor >= n - 1}>Next step</button>
        <span className="muted small">{cursor >= 0 ? `Step ${cursor + 1} of ${n}` : `${n} steps`}</span>
      </div>
      <ol className="story__steps">
        {session.steps.map((s, i) => (
          <li key={i} className={i === cursor ? "is-current" : ""}>
            <button type="button" className="story__step" aria-current={i === cursor ? "step" : undefined} onClick={() => setCursor(i)}>
              <span className="story__n">{i + 1}</span>
              <span><Inert text={s.op === "wait" ? `Time passes: ${s.seconds} seconds on the mock clock.` : fill(s.say, cast)} /></span>
              {s.status != null && <span className={`story__tag ${s.status >= 400 ? "refused" : ""}`}>{s.status >= 400 ? `REFUSED ${s.status}${s.reason ? ` ${s.reason}` : ""}` : `OK ${s.status}`}</span>}
            </button>
          </li>
        ))}
      </ol>
      {session.takeaway && <p className="story__takeaway"><Inert text={fill(session.takeaway, cast)} /></p>}
    </section>
  );
}
