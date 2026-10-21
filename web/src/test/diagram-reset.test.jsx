import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiagramTab, { START_BOXES } from "../tabs/DiagramTab.jsx";

vi.mock("../tabs/Scenarios.jsx", () => ({ ScenarioBar: () => null, StoryPlayer: () => null }));
afterEach(cleanup);

describe("diagram Reset", () => {
  it("puts the boxes back at their starting positions", async () => {
    const setBoxes = vi.fn();
    const moved = START_BOXES.map((b) => ({ ...b, position: { x: 1, y: 1 } }));
    render(<DiagramTab app={{ session: null, cast: {}, cursor: -1, setCursor: vi.fn(), boxes: moved, setBoxes, theme: "light" }} />);
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(setBoxes).toHaveBeenCalledWith(START_BOXES);
  });
});
