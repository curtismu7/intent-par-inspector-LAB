import { decodeJwt } from "./jwt.js";

// A session is what every tab shows: { source, title, takeaway, verdict, steps, messages, token }.
// It comes from a scenario run (the server's trace) or from the hand-driven builder, in the same shape.
export const OPS = {
  par: { from: "agent", to: "as", label: "Push the authorization request (PAR)" },
  authorize: { from: "browser", to: "as", label: "Open /authorize in the browser" },
  consent: { from: "browser", to: "as", label: "User decides on the intent" },
  token: { from: "agent", to: "as", label: "Redeem the code for a token" },
  execute: { from: "agent", to: "rs", label: "Use the token on the resource" },
};

export function fromRun(run) {
  return {
    source: "scenario", title: run.scenario.title, kind: run.scenario.kind, takeaway: run.scenario.takeaway, verdict: run.verdict, pass: run.pass,
    blockedAt: run.blockedAt, steps: run.steps, messages: run.messages, vertical: run.vertical,
    token: run.token ? { raw: run.token.raw, decoded: run.token.decoded } : null,
  };
}

export function fromManual(messages) {
  const steps = messages.map((m, i) => ({ op: m.op, say: m.label, ok: m.response.status < 400, status: m.response.status, reason: m.response.body?.reason ?? null, messageSeq: i + 1 }));
  const failed = steps.find((s) => !s.ok);
  const done = messages.some((m) => m.op === "execute" && m.response.status === 200);
  const issued = [...messages].reverse().find((m) => m.op === "token" && m.response.status === 200);
  return {
    source: "manual", title: "Hand-driven request", kind: "manual", takeaway: null,
    verdict: failed ? "blocked" : done ? "completed" : "in-progress", blockedAt: failed ? { op: failed.op, status: failed.status, reason: failed.reason } : null,
    steps, messages: messages.map((m, i) => ({ seq: i + 1, ...m })),
    token: issued ? { raw: issued.response.body.access_token, decoded: decodeJwt(issued.response.body.access_token) } : null,
  };
}

export const VERDICT_TEXT = { completed: "COMPLETED: the approved action ran", blocked: "REFUSED: the mock server stopped it", "attack-succeeded": "ATTACK SUCCEEDED: nothing stopped it", "in-progress": "IN PROGRESS", unexpected: "UNEXPECTED: not as the story is written" };

// The intent exactly as the authorization server showed it to the user: the last successful /authorize response.
export function shownConsent(session) {
  const m = [...(session?.messages || [])].reverse().find((x) => x.op === "authorize" && x.response.status === 200);
  return m ? m.response.body : null;
}
export const ACTOR_NODE = { agent: "client", browser: "user", as: "as", rs: "rs" };
