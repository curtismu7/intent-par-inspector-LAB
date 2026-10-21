# Changelog

## 0.3.0 (IP2, integration)
- Dockerfile + docker-compose.yml (OrbStack): published on 127.0.0.1 only, pinned by `scripts/compose.test.mjs`; read-only, no capabilities, demo-health/1 healthcheck.
- netguard allows a wildcard bind lookup (the container listens on 0.0.0.0 inside) while connecting to it stays refused; test added.
- `scripts/run.sh` one-command host run; Reset: `POST /api/reset`, header button, `scripts/reset.mjs`.
- Shelf entry with the compose path; content pack also validated against the Learning Hub kit schema when present.
- `.github/workflows/ci.yml` (self-hosted, Node 22 on PRs, gitleaks, forbidden-strings gate); `docs/live-checks.md`; `docs/talk-track.md`.

## 0.2.0 (IP1, web UI)
- React + Vite SPA: shared shell with Request, Server, Token, Diagram and Raw tabs, persona picker, presenter mode, dark/light/system theme, mobile width.
- Hand-driven flow against the live mock AS: request builder, push, request_uri panel, consent screen with the exact bound intent, token panel (raw mock token, decoded claims, intent claims marked), execute with tamper options.
- Tamper-scenario picker with Run and Reset, story player with {{cast}} tokens, message log.
- ReactFlow sequence diagram (client, mock AS, user consent, resource): movable boxes, Simulate, Reset, speed control, refused steps called out in words.
- Inert text rendering for everything typed or echoed (control and bidi characters become visible chips).
- `GET /api/builder` (fresh PKCE pair and mock client credentials) and `redirectUri` per client in the catalog.
- 25 vitest/RTL tests; server and repo tests unchanged and green.

## 0.1.0 (IP0, core)
- Mock authorization server (PAR, authorize, consent, token) and resource server, in process.
- Intent binding engine and 15 scenarios across banking, travel and retail, including the HITL plane-ticket story.
- W3C traceparent trace envelope with raw request and response.
- netguard, loopback bind, Host check, same-origin writes, demo-health/1, doctor, content pack, gitleaks pre-commit.
