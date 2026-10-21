// In-process stand-in for the Express server: routes fetch() to the real mock AS core and scenario runner (same code the server uses), no sockets.
import { randomBytes } from "node:crypto";
import { createMockAS, CLIENTS, ISSUER, PAR_TTL_S, pkceChallenge } from "../../../server/src/as.js";
import { runScenario } from "../../../server/src/runner.js";
import { SCENARIOS, VERTICALS, getVertical, renderScenario, baseIntent } from "../../../server/src/stories.js";

export function catalogFor(id = VERTICALS[0].id) {
  const v = getVertical(id);
  return {
    verticals: VERTICALS.map(({ id: i, name, cast }) => ({ id: i, name, cast })), vertical: v.id, intent: baseIntent(v), issuer: ISSUER, parTtlSeconds: PAR_TTL_S,
    clients: Object.entries(CLIENTS).map(([cid, c]) => ({ id: cid, name: c.name, requirePar: c.require_par, redirectUri: c.redirect_uris[0] })),
    scenarios: SCENARIOS.map((s) => { const r = renderScenario(s, v); return { id: r.id, slug: r.slug, kind: r.kind, title: r.title, takeaway: r.takeaway, expectedOutcome: r.outcome, steps: r.steps.length }; }),
  };
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export function installFakeServer() {
  const as = createMockAS();
  const calls = [];
  const fake = async (url, init = {}) => {
    const u = new URL(url, "http://localhost");
    const method = (init.method || "GET").toUpperCase();
    calls.push({ method, path: u.pathname });
    const raw = init.body ? String(init.body) : "";
    const body = !raw ? {} : /json/.test(init.headers?.["content-type"] || "") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
    if (u.pathname === "/api/catalog") return json(catalogFor(u.searchParams.get("vertical") || undefined));
    if (u.pathname === "/api/builder") {
      const id = u.searchParams.get("client") || "agent-app"; const c = CLIENTS[id]; const verifier = randomBytes(32).toString("base64url");
      return json({ client_id: id, client_secret: c.secret, redirect_uri: c.redirect_uris[0], code_verifier: verifier, code_challenge: pkceChallenge(verifier), code_challenge_method: "S256", mock: true });
    }
    if (u.pathname === "/api/reset") return json({ ok: true });
    if (u.pathname === "/api/run") return json(runScenario(body.scenario, body.vertical));
    const out = as.handle({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: init.headers || {}, body });
    return json(out.body, out.status, out.headers);
  };
  globalThis.fetch = fake;
  return { as, calls };
}
