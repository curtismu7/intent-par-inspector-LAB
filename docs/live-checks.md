# Live checks (optional, owner only)

Nothing in this repo calls a real authorization server, and the tests prove it (netguard). This page is for the owner who wants to compare the mock with a real PingOne or PingFederate PAR endpoint. **It is instructions only: no script in this repo runs any of it.** Run it yourself, from your own shell, with your own tenant and a test client. Never paste tenant ids, client ids, secrets or tokens into this repo, its issues or its commit messages.

The mock is deliberately stricter than the RFC in a few places (it refuses parameters beside `request_uri`, refuses unknown PAR parameters, requires an intent). Expect those to differ; the checks below show which behaviours match.

## What you need

- A test OIDC application on the server under test with PAR available and (for check 4) "require pushed authorization requests" switched on.
- The server's PAR endpoint and authorization endpoint, from its discovery document (`pushed_authorization_request_endpoint`, and `require_pushed_authorization_requests` if advertised).
- A client credential for that test application, held in shell variables you set yourself (`PAR_URL`, `AUTHZ_URL`, `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI`). Do not write them into a file in this repo.

## Checks

1. **Push returns a request_uri.** `POST $PAR_URL` with `client_id`, `client_secret`, `response_type=code`, `redirect_uri`, `scope=openid`, `state`, a PKCE `code_challenge` (S256), and `authorization_details` carrying an action, amount, currency and resource. Expect HTTP 201 and `{"request_uri": "urn:ietf:params:oauth:request_uri:...", "expires_in": N}`. Mock equivalent: scenario S01, Request tab.
2. **Browser carries only the reference.** Open `$AUTHZ_URL?client_id=$CLIENT_ID&request_uri=<value from check 1>` in a browser. Expect the sign-in and consent flow to run. Mock equivalent: Server tab, authorize.
3. **Replay.** Open the same URL again after it has been used. Expect an error (the `request_uri` is one-time). Mock equivalent: S08.
4. **Inline parameters when PAR is required.** With require-PAR on, open `$AUTHZ_URL?client_id=...&response_type=code&redirect_uri=...&scope=openid` with no `request_uri`. Expect a refusal. Mock equivalent: S12. (With require-PAR off, expect it to work: that is the S13 contrast.)
5. **Expiry.** Push, wait past `expires_in`, then open the authorize URL. Expect an error. Mock equivalent: S09.
6. **Wrong client.** Push with client A, open the authorize URL with a different `client_id`. Expect an error. Mock equivalent: S10.
7. **Intent in the token.** Complete the flow and decode the access token (any JWT decoder, locally; do not use an online one). Check whether the authorization details or an intent claim made it into the token, and whether the consent screen showed them. This is the part that varies most between products, so record what you see rather than assuming the mock's behaviour.

## Recording results

Write a few lines in your own notes (not this repo): date, product and version, which checks matched the mock, which differed, and why. If a difference changes what an SE should say, update `docs/talk-track.md` in a normal commit that names no tenant details.

## After you are done

Delete any tokens you captured. Do not commit them.
