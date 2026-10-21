# Intent / PAR Inspector

An SE demo that shows how Pushed Authorization Requests (RFC 9126) and intent binding work, against a **mock** authorization server. No tenant, no credentials, no outbound network.

Status: **step IP0, the core**. The server, the mock authorization server, the story engine and the tests exist. There is **no web UI yet** (step IP1): you drive it with `curl` or the JSON API.

## What it shows

1. A client **pushes** its authorization request (with the intent: action, amount, currency, resource) to `POST /as/par` and gets a one-time, 60-second `request_uri`.
2. The browser opens `/as/authorize` with only `client_id` and `request_uri`. The server resolves and burns it.
3. The user approves **the exact intent** (consent names the intent's hash).
4. The token carries the bound intent as `authorization_details` (RFC 9396 style) plus an `intent` claim.
5. The resource server only runs a request that equals the bound intent, once.

Then it shows what is refused: edited amount, swapped resource, replayed or expired `request_uri`, wrong client, missing intent, inline parameters when PAR is required, a forged token, an unknown parameter. One contrast story shows the same attack **succeeding** for a client that is not required to use PAR.

## Run it

Needs Node 20 or later.

```
npm install
npm run doctor        # preflight: node, bind, port, netguard self-test, story hosts, all scenarios
npm start             # http://localhost:4771/
npm test              # server tests and repo checks
```

Port 4771 (set `PORT` in `.env` or the environment; allowed range 4700-5299).

```
curl -s http://localhost:4771/api/health
curl -s 'http://localhost:4771/api/catalog?vertical=travel'
curl -s -X POST http://localhost:4771/api/run -H 'content-type: application/json' -d '{"scenario":"S08","vertical":"travel"}'
curl -s -X POST http://localhost:4771/api/run-all -H 'content-type: application/json' -d '{"vertical":"banking"}'
```

`POST /api/run` returns the whole trace: every message with a W3C `traceparent`, who talked to whom, the raw request and response text, the verdict, and the decoded mock token.

The mock servers are also live for hand-driven use: `POST /as/par`, `GET /as/authorize`, `POST /as/consent`, `POST /as/token`, `POST /rs/execute`, `GET /as/jwks`. The mock clients are `agent-app` and `partner-app` (PAR required) and `legacy-web` (PAR not required); their secrets are `mock-secret-<client>` and mean nothing outside this process.

## Stories

15 scenarios (`S01`-`S15`) in `server/data/scenarios.json`, each run against three vertical packs (travel with Mark and the plane ticket, banking with Alice, retail with Priya) in `server/data/verticals.json`. `S02` is the human-in-the-loop story: the agent proposes, Mark approves one exact ticket, and the same token cannot be used for a dearer fare, a different flight, or a second time.

## Safety

Loopback only, Host check, same-origin writes, zero real outbound (netguard), mock-issued tokens only, reserved `.invalid` hosts. See `docs/safety.md`. Design and the mock-versus-real table are in `docs/architecture.md`.

## Not done yet

The web UI and ReactFlow diagram (IP1), Docker publish and shelf registration (the entry is in `docs/shelf-entry.json`, `composeFile` empty), the Learning Hub diagram links. The catalog id `C40` in the content pack is a placeholder.
