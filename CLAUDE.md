# CLAUDE.md: Intent / PAR Inspector LAB

Tier: Demo. An SE demo for Pushed Authorization Requests (RFC 9126) and intent binding, against a mock authorization server. Node 26, Express server (`server/`), React + Vite page (`web/`), loopback only. Repo: https://github.com/curtismu7/intent-par-inspector-LAB. Read `README.md` first; the rulebook is `~/Development/STANDALONE-RULES.md` (skill `standalone-demo`).

## Run and test
- `npm ci`, `npm test` (server + web + script tests), `npm run doctor`, `npm start` (see package.json / compose for the port). Docker: `docker compose up --build -d`, publishes `127.0.0.1` only.
- Run suites on the Air (`air-test`), not on this Mac.
- `GET /api/health` answers `demo-health/1` for the shelf.

## What it shows
- Five tabs (Request, Server, Token, Diagram, Raw): a hand-driven PAR request builder, the authorization server's view, the token response, a ReactFlow sequence diagram (movable boxes, Simulate / Reset / speed) and the raw wire.
- Tamper-scenario picker with a story player and negative tests: a changed redirect_uri, scope or state must be refused.
- Persona picker, presenter mode, dark/light themes.

## Rules that bite
- Mock only: no real tenant, no outbound network, loopback bind, Host check, same-origin writes.
- `web/src/standalone-ui.css` is the vendored shared stylesheet (AI-DEMO-Standalone canonical). Do not edit it; app CSS uses its tokens only. UI patterns: `AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md`; check with that repo's `scripts/check-ui-patterns.sh`.
- The forbidden-strings gate (`scripts/check-forbidden-strings.mjs`, CI job, secret `FORBIDDEN_STRINGS`) fails on a string from the owner's list. No identifiers from other projects; `.example` hosts only.
- Node 26 only. CI is GitHub-hosted. Docker is OrbStack, never Docker Desktop.
- Never edit the shared `~/Development/AI-DEMO2` checkout; it is a read-only source.
- No AI attribution anywhere (owner, 2026-11-07): no Co-Authored-By trailer and no "Generated with" line in commits, PR bodies or files; CI runs `scripts/check-no-ai-attribution.sh`.

## Shelf
`docs/shelf-entry.json` registers this app. Run the parent's `scripts/check-drift.sh <this clone>` before a PR.
