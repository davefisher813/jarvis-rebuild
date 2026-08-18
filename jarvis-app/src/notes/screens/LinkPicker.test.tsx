// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import LinkPicker from "./LinkPicker";

describe("LinkPicker", () => {
  it("picks an event with kind/label/id", () => {
    const onPick = vi.fn();
    render(<LinkPicker events={[{ id: "e1", title: "Kickoff" }]} tasks={[]} onPick={onPick} />);
    fireEvent.click(screen.getByText("Kickoff"));
    expect(onPick).toHaveBeenCalledWith("event", "Kickoff", "e1");
  });
  it("picks a task with kind/label/id", () => {
    const onPick = vi.fn();
    render(<LinkPicker events={[]} tasks={[{ id: "t1", text: "Email Sam" }]} onPick={onPick} />);
    fireEvent.click(screen.getByText("Email Sam"));
    expect(onPick).toHaveBeenCalledWith("task", "Email Sam", "t1");
  });
  it("shows an empty state when nothing to link", () => {
    render(<LinkPicker events={[]} tasks={[]} onPick={vi.fn()} />);
    expect(screen.getByText("Nothing to Link Yet")).toBeTruthy();
  });
});
