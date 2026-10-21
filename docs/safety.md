# Safety

- Binds `127.0.0.1` only. Another address needs `INTENT_BIND` set on purpose; the doctor reports it.
- Host header must be a loopback name on every route (DNS rebinding). Writes must be same-origin: a cross-origin `Origin` or a cross-site `Sec-Fetch-Site` gets 403. A client with no `Origin` (curl) is allowed.
- Zero real outbound: `netguard` refuses non-loopback sockets, DNS, fetch and UDP. The server starts it first; `npm run doctor` and the tests prove it blocks.
- Every host in every story is `.invalid`, `.example`, or the apex of example.com/net/org. The doctor and tests scan for anything else.
- Raw tokens are shown on purpose, for teaching. They are signed with a key made at process start, name an `.invalid` issuer, carry `"mock": true`, and verify only against the in-process server.
- Ports 4700-5299 only; never 8080, 5173, 3900, 4000, 4400, 4510, 4600, 4601, 18080, 19080, 19090.
- gitleaks runs as a pre-commit hook (`.githooks/pre-commit`, set up by `npm install`).
