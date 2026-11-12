import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App.jsx";
import { installFakeServer } from "./fakeServer.js";

beforeEach(() => { window.location.hash = "#/diagram"; installFakeServer(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("diagram", () => {
  it("has movable boxes, Simulate, Reset and a speed control", async () => {
    render(<App />);
    await screen.findByRole("group", { name: /Sequence diagram/ });
    expect(screen.getByRole("button", { name: "Simulate" })).toBeEnabled();
    expect(screen.getByTestId("diagram-reset")).toBeInTheDocument();
    expect(screen.getByLabelText("Speed")).toHaveValue("1");
    for (const t of ["Client", "Mock authorization server", "User consent", "Resource"]) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".react-flow__node")).toHaveLength(4);
  });

  it("Simulate walks the happy path step by step at the chosen speed, Reset goes back to idle", async () => {
    render(<App />);
    await screen.findByRole("group", { name: /Sequence diagram/ });
    vi.useFakeTimers();
    const caption = () => screen.getByTestId("caption").textContent;
    expect(caption()).toMatch(/Press Simulate/);
    act(() => { screen.getByRole("button", { name: "Simulate" }).click(); });
    expect(caption()).toMatch(/Step 1 of 5/);
    await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
    expect(caption()).toMatch(/Step 2 of 5/);
    for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
    expect(caption()).toMatch(/Step 5 of 5/);
    expect(screen.getByRole("button", { name: "Simulate" })).toBeEnabled();
    act(() => { screen.getByTestId("diagram-reset").click(); });
    expect(caption()).toMatch(/Press Simulate/);
  });

  it("a faster speed shortens the step interval", async () => {
    render(<App />);
    await screen.findByRole("group", { name: /Sequence diagram/ });
    vi.useFakeTimers();
    act(() => { screen.getByLabelText("Speed").focus(); });
    const sel = screen.getByLabelText("Speed");
    await act(async () => { const { fireEvent } = await import("@testing-library/react"); fireEvent.change(sel, { target: { value: "4" } }); });
    act(() => { screen.getByRole("button", { name: "Simulate" }).click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(screen.getByTestId("caption").textContent).toMatch(/Step 2 of 5/);
  });

  it("a refused scenario step is called out in words and styled as refused", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("group", { name: /Sequence diagram/ });
    await user.selectOptions(screen.getByLabelText("Scenario"), "S03");
    await user.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByTestId("verdict");
    const next = screen.getByRole("button", { name: "Next step" });
    await user.click(next); await user.click(next); // step 1 -> 2 (the edited /authorize)
    await waitFor(() => expect(screen.getByTestId("caption").textContent).toMatch(/REFUSED 400 params_outside_par/));
    expect(screen.getByTestId("caption")).toHaveClass("caption--deny");
    expect(document.querySelector(".fbox.deny")).not.toBeNull();
  });
});
