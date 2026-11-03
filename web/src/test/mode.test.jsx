import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ModeToggle from "../components/ModeToggle.jsx";

afterEach(cleanup);

describe("ModeToggle", () => {
  it("shows Mock pressed when the server reports mock and Real disabled with the reason", async () => {
    render(<ModeToggle info={{ source: "mock", realAvailable: false }} />);
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
    const real = screen.getByTestId("mode-real");
    expect(real).toBeDisabled();
    expect(real.getAttribute("title")).toMatch(/mock only/i);
  });

  it("renders both buttons disabled while the info has not loaded", () => {
    render(<ModeToggle info={null} />);
    expect(screen.getByTestId("mode-mock")).toBeDisabled();
    expect(screen.getByTestId("mode-real")).toBeDisabled();
  });

  it("clicking Mock does not call onSelect when it is already the source, and Real calls it when available", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<ModeToggle info={{ source: "mock", realAvailable: false }} onSelect={onSelect} />);
    await user.click(screen.getByTestId("mode-mock"));
    expect(onSelect).not.toHaveBeenCalled();
    unmount();
    render(<ModeToggle info={{ source: "mock", realAvailable: true }} onSelect={onSelect} />);
    await user.click(screen.getByTestId("mode-real"));
    expect(onSelect).toHaveBeenCalledWith("real");
  });

  it("a full round trip: the toggle posts the mode and reloads the source", async () => {
    // Wire the component the way App.jsx does: pick -> POST /api/mode -> setModeInfo(response).
    // The source starts stale ("real"), so clicking Mock exercises the real switch path.
    const postMode = vi.fn(async (source) => ({ source, realAvailable: false }));
    const setInfo = vi.fn();
    const pick = async (source) => setInfo(await postMode(source));
    const user = userEvent.setup();
    const { rerender } = render(<ModeToggle info={{ source: "real", realAvailable: true }} onSelect={pick} />);
    await user.click(screen.getByTestId("mode-mock"));
    await waitFor(() => expect(postMode).toHaveBeenCalledWith("mock"), { timeout: 2000 });
    await waitFor(() => expect(setInfo).toHaveBeenCalledWith({ source: "mock", realAvailable: false }), { timeout: 2000 });
    rerender(<ModeToggle info={{ source: "mock", realAvailable: false }} onSelect={pick} />);
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
    // Clicking the already-selected mode is a no-op by design.
    const postCalls = postMode.mock.calls.length;
    await user.click(screen.getByTestId("mode-mock"));
    expect(postMode.mock.calls.length).toBe(postCalls);
  });
});
