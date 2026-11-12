import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App.jsx";
import { installFakeServer } from "./fakeServer.js";

let server;
beforeEach(() => { window.location.hash = ""; server = installFakeServer(); });
afterEach(cleanup);

async function open() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("tablist");
  return user;
}
const tab = (user, name) => user.click(screen.getByRole("tab", { name }));

describe("shell", () => {
  it("shows the mock-only banner, five tabs, and the persona picker", async () => {
    await open();
    expect(screen.getByTestId("banner")).toHaveTextContent(/mock only/i);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Request", "Server", "Token", "Diagram", "Raw"]);
    expect(screen.getByRole("tab", { name: "Request" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Vertical")).toBeInTheDocument();
  });

  it("arrow keys move between tabs", async () => {
  it("arrow keys move between tabs", async () => {
    const user = await open();
    screen.getByRole("tab", { name: "Request" }).focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Server" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: "Server" })).toHaveFocus();
  });

  it("present mode and theme toggle set document attributes", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Present (P)" }));
    expect(document.documentElement.dataset.present).toBe("1");
    await user.selectOptions(screen.getByTestId("theme-select"), "light");
    expect(document.documentElement.dataset.theme).toBe("light");
    await user.click(screen.getByRole("button", { name: "Exit present (Esc)" }));
    expect(document.documentElement.dataset.present).toBeUndefined();
  });

  it("only ever calls its own origin paths", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Push to mock AS" }));
    await screen.findByTestId("push-ok");
    expect(server.calls.every((c) => c.path.startsWith("/api/") || c.path.startsWith("/as/") || c.path.startsWith("/rs/"))).toBe(true);
  });
});

describe("request builder", () => {
  it("pushes to the mock AS and shows the request_uri", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Push to mock AS" }));
    const uri = await screen.findByTestId("request-uri");
    expect(uri).toHaveTextContent("urn:ietf:params:oauth:request_uri:");
    expect(screen.getByTestId("push-ok")).toHaveTextContent("60 seconds");
  });

  it("an intent left out is refused with its reason", async () => {
    const user = await open();
    await user.click(screen.getByLabelText(/Leave the intent out/));
    await user.click(screen.getByRole("button", { name: "Push to mock AS" }));
    expect(await screen.findByTestId("push-refused")).toHaveTextContent("intent_required");
  });

  it("an unregistered redirect_uri is refused", async () => {
    const user = await open();
    const input = screen.getByLabelText("redirect_uri", { exact: false });
    await user.clear(input);
    await user.type(input, "https://evil.example.invalid/cb");
    await user.click(screen.getByRole("button", { name: "Push to mock AS" }));
    expect(await screen.findByTestId("push-refused")).toHaveTextContent("redirect_uri_unregistered");
  });

  it("changing the persona reloads the catalog and the default intent", async () => {
    const user = await open();
    expect(screen.getByLabelText("action")).toHaveValue("travel.book_flight");
    await user.selectOptions(screen.getByLabelText("Vertical"), "banking");
    await waitFor(() => expect(screen.getByLabelText("action")).toHaveValue("payments.transfer"));
  });
});

describe("full hand-driven flow", () => {
  it("push, authorize, consent on the exact intent, token with the intent claim, execute once", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Push to mock AS" }));
    await screen.findByTestId("push-ok");
    await tab(user, "Server");
    await user.click(screen.getByRole("button", { name: "Open /authorize" }));
    const consent = await screen.findByTestId("consent");
    expect(consent).toHaveTextContent("travel.book_flight");
    expect(consent).toHaveTextContent("412");
    expect(consent).toHaveTextContent("pushed request (PAR)");
    await user.click(screen.getByRole("button", { name: "Approve exactly this" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Redeem the code/ })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /Redeem the code/ }));
    await tab(user, "Token");
    const panel = await screen.findByTestId("token-panel");
    expect(within(panel).getByTestId("raw-token").textContent.split(".")).toHaveLength(3);
    const hot = within(panel).getAllByTestId("intent-claim");
    expect(hot.length).toBeGreaterThanOrEqual(3);
    expect(hot.some((r) => /BOUND INTENT/.test(r.textContent) && /412/.test(r.textContent))).toBe(true);

    await user.type(screen.getByLabelText(/Amount to send/), "4120");
    await user.click(screen.getByRole("button", { name: "Execute" }));
    expect(await screen.findByTestId("exec-refused")).toHaveTextContent("intent_mismatch");
    await user.clear(screen.getByLabelText(/Amount to send/));
    await user.click(screen.getByRole("button", { name: "Execute" }));
    await waitFor(() => expect(screen.getByTestId("exec-ok")).toHaveTextContent("receipt"));
    await user.click(screen.getByRole("button", { name: "Execute" }));
    await waitFor(() => expect(screen.getByTestId("exec-refused")).toHaveTextContent("intent_already_consumed"));
  });

  it("an edited link is refused when PAR is in use, and a reused request_uri is refused", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Push to mock AS" }));
    await screen.findByTestId("push-ok");
    await tab(user, "Server");
    await user.click(screen.getByLabelText(/Tamper: add an edited intent/));
    await user.click(screen.getByRole("button", { name: "Open /authorize" }));
    await waitFor(() => expect(screen.getByRole("list", { name: "Messages in order" })).toHaveTextContent("REFUSED 400 params_outside_par"));
    await user.click(screen.getByLabelText(/Tamper: add an edited intent/));
    await user.click(screen.getByRole("button", { name: "Open /authorize" }));
    await screen.findByTestId("consent");
    await user.click(screen.getByRole("button", { name: "Open /authorize" }));
    await waitFor(() => expect(screen.getByRole("list", { name: "Messages in order" })).toHaveTextContent("request_uri_reused"));
  });

  it("a consent hash that is not the shown one is refused", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Push to mock AS" }));
    await screen.findByTestId("push-ok");
    await tab(user, "Server");
    await user.click(screen.getByRole("button", { name: "Open /authorize" }));
    await screen.findByTestId("consent");
    await user.click(screen.getByLabelText(/Approve a hash that is not/));
    await user.click(screen.getByRole("button", { name: "Approve exactly this" }));
    await waitFor(() => expect(screen.getByRole("list", { name: "Messages in order" })).toHaveTextContent("consent_intent_mismatch"));
  });
});

describe("reset", () => {
  it("Reset server clears the scenario on screen and says so", async () => {
    const user = await open();
    await tab(user, "Server");
    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByTestId("verdict")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(screen.getByTestId("reset-note")).toHaveTextContent(/Mock server reset/));
    expect(screen.queryByTestId("verdict")).toBeNull();
  });
});

describe("scenarios and story player", () => {
  it("runs a tamper scenario, shows the verdict and a story with the persona filled in", async () => {
    const user = await open();
    await tab(user, "Server");
    await user.selectOptions(screen.getByLabelText("Scenario"), "S03");
    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByTestId("verdict")).toHaveTextContent(/REFUSED/));
    const story = screen.getByRole("region", { name: /Amount edited/ });
    expect(story).toHaveTextContent("Travel Agent");
    expect(story.textContent).not.toMatch(/\{\{/);
    expect(story).toHaveTextContent(/REFUSED 400 params_outside_par/);
    await user.click(screen.getByRole("button", { name: "Reset scenario" }));
    expect(screen.queryByTestId("verdict")).toBeNull();
  });

  it("the contrast scenario says the attack succeeded", async () => {
    const user = await open();
    await tab(user, "Server");
    const contrast = within(screen.getByLabelText("Scenario")).getAllByRole("option").find((o) => /Contrast/.test(o.textContent));
    await user.selectOptions(screen.getByLabelText("Scenario"), contrast.value);
    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByTestId("verdict")).toHaveTextContent(/ATTACK SUCCEEDED/));
  });

  it("a scenario token lands on the Token tab with the intent claim marked", async () => {
    const user = await open();
    await tab(user, "Server");
    await user.selectOptions(screen.getByLabelText("Scenario"), "S01");
    await user.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByTestId("verdict");
    await tab(user, "Token");
    expect((await screen.findAllByTestId("intent-claim")).length).toBeGreaterThanOrEqual(3);
  });
});

describe("raw tab", () => {
  it("shows request and response text for a message", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Push to mock AS" }));
    await screen.findByTestId("push-ok");
    await tab(user, "Raw");
    expect(screen.getByTestId("raw-request")).toHaveTextContent("POST /as/par HTTP/1.1");
    expect(screen.getByTestId("raw-response")).toHaveTextContent("HTTP/1.1 201 Created");
  });
});

describe("keyboard focus", () => {
  it("activating the Next button on the Request tab moves focus to the main region, not to BODY", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Push to mock AS" }));
    await screen.findByTestId("push-ok");
    await user.click(screen.getByRole("button", { name: /Next: open \/authorize/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/server"));
    expect(document.activeElement).toBe(document.getElementById("main"));
  });
});
