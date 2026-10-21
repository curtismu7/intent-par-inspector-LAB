# Architecture (step IP0: core)

```
agent app ──POST /as/par──────────▶ ┐
browser   ──GET  /as/authorize────▶ │ mock authorization server  (server/src/as.js, in process)
browser   ──POST /as/consent──────▶ │   par store (request_uri, 60 s, one time, client bound)
agent app ──POST /as/token────────▶ ┘   txn + code stores, throwaway ES256 key (jwt.js)
agent app ──POST /rs/execute──────▶     mock resource server: compares the request with the token's bound intent
```

- `as.js` is a pure `handle({ method, path, query, headers, body }) -> { status, headers, body }`. The Express router (`app.js`) and the scenario runner (`runner.js`) both call it, so the trace shows exactly what the HTTP endpoints return.
- `intent.js` normalises, validates and hashes the intent (`action`, `amount`, `currency`, `resource`, `nonce`, `description`). The hash is the binding: PAR stores it, consent must approve it, the token carries it, the resource server compares the enforced fields (`action`, `amount`, `currency`, `resource`).
- `stories.js` + `data/*.json`: verticals (cast, base intent) and scenarios (steps as data). `{{user}}`, `{{agent}}`, `{{merchant}}`, `{{item}}`, `{{amount}}`, `{{amount_tampered}}`, `{{resource_swapped}}`, `{{action_other}}` come from the vertical.
- `runner.js` runs a scenario on a fresh AS with a virtual clock and returns the trace: one W3C `traceparent` per message (shared trace id, unique span id), raw request and response text, who talked to whom.
- `netguard.js` refuses every non-loopback socket, DNS lookup, fetch and UDP send, and records the attempt. `safety.js` has the loopback bind, Host check, same-origin writes, and the port rule.

## Mock versus real

| Real (RFC behaviour) | Mock |
| --- | --- |
| One-time, short-lived `request_uri`, bound to the client | The user: consent is a JSON call, not a page |
| PAR client authentication, no `request_uri` inside a PAR, require-PAR per client | Clients and their secrets |
| PKCE S256, one-time codes | The signing key (throwaway, in memory) |
| RFC 9396 style `authorization_details` | The issuer and audience (`.invalid`) |
| JWT signature check at the resource server | The resource server's "execute" |

Strictness choices that go beyond the RFC, on purpose: parameters beside `request_uri` are refused (the RFC lets a server ignore them), unknown PAR parameters are refused, an intent is required, and a token carries exactly one intent that runs once.
