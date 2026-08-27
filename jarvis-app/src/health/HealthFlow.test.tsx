// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import HealthFlow from "./HealthFlow";

describe("HealthFlow: Lights Out end to end", () => {
  it("taps, logs, and shows the confirmation", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="lightsOut" onExit={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Lights Out" }));
    await waitFor(() => expect(screen.getByText("Logged")).toBeInTheDocument());
  });
});

describe("HealthFlow: the Share Line", () => {
  it("everything is off by default except logistics, and the Kid's Room is never a switch", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="share" onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText("Categories")).toBeInTheDocument());
    // The floor: rendered as text, and the switch drawn beside it is locked
    // permanently off. Clicking it does nothing, because it carries no
    // onClick at all (checked statically too, in healthPrivacy.test.ts).
    expect(screen.getByText("Mood and Mind")).toBeInTheDocument();
    expect(screen.getAllByText("Not a setting. This never crosses to your parent, no matter what.").length).toBe(3);
    const kidSwitch = screen.getByRole("switch", { name: /Mood and Mind/ });
    expect(kidSwitch).toHaveAttribute("aria-checked", "false");
    expect(kidSwitch).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(kidSwitch);
    expect(kidSwitch).toHaveAttribute("aria-checked", "false");
  });

  it("granting a category surfaces it on What They See", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="share" onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText("Sleep")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("switch", { name: "Sleep" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Sleep" })).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(screen.getByText("See What They See"));
    await waitFor(() => expect(screen.getByText("Nothing Logged Yet")).toBeInTheDocument());
  });
});
