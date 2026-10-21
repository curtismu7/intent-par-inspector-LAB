# Talk track for SEs

About ten minutes. Start the demo (`./scripts/run.sh`, then http://localhost:4771/), pick a persona, and turn on Present if the room is large. Everything is a mock: say so once, early, and move on. The banner at the top says it too.

## The one-sentence point

"A normal OAuth link carries the request in the browser, where it can be read and edited. PAR sends it to the server first, so the browser only carries a reference, and we can bind exactly what was asked for to the approval and the token."

## Flow

1. **Set the scene (30 seconds).** Persona picker: Travel, Mark and his Travel Agent. "The agent wants to buy a plane ticket for Mark. The intent is the action, the price, the currency and the flight."
2. **Happy path, S01 (2 minutes).** Server tab, scenario `S01`, Run, then the Diagram tab: Simulate. Point at four things: the push returns a `request_uri`; the browser link has only `client_id` and `request_uri`; the consent names the intent's hash; the token carries the intent as `authorization_details`.
3. **The human approves one exact thing, S02 (1 minute).** "Mark approves this ticket, not tickets in general. The same token cannot buy a dearer fare, a different flight, or a second ticket."
4. **Attacks, pick three (3 minutes).**
   - S03 amount edited in the link: "With PAR, parameters beside the `request_uri` are refused."
   - S08 replay: "The reference is one-time. A copy from a log or browser history is useless."
   - S06 or S07 valid token, different target or bigger amount: "A genuine token is still only good for its own intent."
   - Optionally S09 (60 second expiry), S10 (wrong client), S14 (edit the token, signature breaks).
5. **The contrast, S13 (1 minute).** "Same attack, but this client is not required to use PAR. It succeeds, and the token faithfully carries the edited amount. That is why 'require PAR' is the setting that matters."
6. **Hands on (optional, 2 minutes).** Request tab: build a request yourself, push it, then on the Server tab approve it, and on the Token tab change the amount before executing. Raw shows every message exactly as sent.
7. **Reset.** The Reset server button (or `node scripts/reset.mjs`) clears everything so the next audience starts clean.

## Likely questions

- **"Is this PingOne?"** No. It is a mock that follows RFC 9126 and RFC 9396 behaviour. It is deliberately stricter than the RFCs in places (it refuses parameters beside `request_uri`, refuses unknown parameters, requires an intent). To compare with a real tenant, the owner can follow `docs/live-checks.md`.
- **"Is the intent claim standard?"** The `authorization_details` shape is RFC 9396. The `intent` claim and hash binding are this demo's illustration of the idea, not a published standard.
- **"Are those real tokens?"** They are real JWTs signed with a throwaway key made when the server started. They name an `.invalid` issuer and verify only against this process. Showing them raw is on purpose, for teaching.
- **"Does it call out to anything?"** No. Outbound sockets are blocked by a guard that has its own tests, and the server only listens on loopback.

## If something goes wrong

`npm run doctor` checks Node, the bind address, the port, the network guard and every scenario. If the page says it cannot reach the mock server, the process is not running. If a hand-driven flow gets confused, press Reset server.
