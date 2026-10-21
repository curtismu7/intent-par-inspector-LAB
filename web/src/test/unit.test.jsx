import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Inert, reveal } from "../lib/Inert.jsx";
import { fill } from "../lib/fill.js";
import { decodeJwt } from "../lib/jwt.js";
import { PushResult } from "../tabs/RequestTab.jsx";
import { TokenPanel } from "../tabs/TokenTab.jsx";
import { ConsentScreen } from "../tabs/ServerTab.jsx";

afterEach(cleanup);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("inert text", () => {
  it("markup in user-typed or server-echoed text is shown as text, never run", () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    const { container } = render(<Inert text={evil} />);
    expect(container.querySelector("img, script")).toBeNull();
    expect(container).toHaveTextContent(evil);
    expect(window.__pwned).toBeUndefined();
  });
  it("control and bidi characters become visible chips", () => {
    expect(reveal("a‮b\u0007c").filter((p) => p.chip).map((p) => p.chip)).toEqual(["[U+202E]", "[U+0007]"]);
    render(<Inert text={"pay‮ evil"} />);
    expect(screen.getByTitle(/Invisible/)).toHaveTextContent("[U+202E]");
  });
  it("a hostile intent description in the consent screen and the push refusal stays text", () => {
    const evil = "<b onmouseover=alert(1)>hi</b>";
    const shown = { client: evil, binding: "par", note: evil, intent_hash: "h", intent: { action: "a.b", amount: 1, currency: "USD", resource: "https://x.example.invalid/r", description: evil } };
    const { container } = render(<><ConsentScreen shown={shown} cast={{ user: "Mark" }} /><PushResult message={{ response: { status: 400, body: { error: evil, reason: evil, error_description: evil } } }} /></>);
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain(evil);
  });
});

describe("fill", () => {
  it("fills cast tokens and leaves unknown ones visible", () => {
    expect(fill("{{agent}} acts for {{user}} {{nope}}", { agent: "Travel Agent", user: "Mark" })).toBe("Travel Agent acts for Mark {{nope}}");
  });
});

describe("token panel", () => {
  const payload = { iss: "https://as.example.invalid", sub: "mark", intent: { action: "a.b", amount: 5 }, intent_hash: "abc", authorization_details: [{ type: "intent_action" }], binding: "par", mock: true };
  const raw = `${b64({ alg: "ES256", typ: "JWT" })}.${b64(payload)}.sig`;
  it("decodes a token and marks the intent claims with a word", () => {
    expect(decodeJwt(raw).payload.intent.amount).toBe(5);
    expect(decodeJwt("not a token")).toBeNull();
    render(<TokenPanel token={{ raw, decoded: decodeJwt(raw) }} />);
    expect(screen.getAllByTestId("intent-claim")).toHaveLength(4);
    expect(screen.getAllByText("BOUND INTENT")).toHaveLength(4);
    expect(screen.getByText(/throwaway key/)).toBeInTheDocument();
  });
  it("says so when there is no token", () => {
    render(<TokenPanel token={null} />);
    expect(screen.getByText(/No token yet/)).toBeInTheDocument();
  });
});
