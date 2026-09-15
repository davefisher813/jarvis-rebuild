// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LinkedItemSheet from "./LinkedItemSheet";

// LINK AN ITEM (push C): one search over every kind, rows by kind, No Link
// to clear, and an honest empty state.
describe("LinkedItemSheet", () => {
  const candidates = [
    { type: "task" as const, id: "t1", label: "Bridge Priorities" },
    { type: "event" as const, id: "e1", label: "Standup" },
    { type: "contact" as const, id: "p1", label: "Alberto" },
  ];

  it("groups by kind, searches across them, and picks", () => {
    const onPick = vi.fn();
    render(<LinkedItemSheet candidates={candidates} current={null} onPick={onPick} onCancel={() => {}} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Contacts")).toBeInTheDocument();
    expect(screen.queryByText("No Link")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search items to link"), { target: { value: "stand" } });
    expect(screen.queryByText("Bridge Priorities")).toBeNull();
    fireEvent.click(screen.getByText("Standup"));
    expect(onPick).toHaveBeenCalledWith({ type: "event", id: "e1", label: "Standup" });
  });

  it("with a link in place, No Link clears it", () => {
    const onPick = vi.fn();
    render(<LinkedItemSheet candidates={candidates} current={{ type: "task", id: "t1", label: "Bridge Priorities" }} onPick={onPick} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("No Link"));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it("says when there is nothing to link, and when nothing matches", () => {
    const { rerender } = render(<LinkedItemSheet candidates={[]} current={null} onPick={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/Nothing to link yet/)).toBeInTheDocument();
    rerender(<LinkedItemSheet candidates={candidates} current={null} onPick={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search items to link"), { target: { value: "zzz" } });
    expect(screen.getByText("Nothing here matches that.")).toBeInTheDocument();
  });

  it("Cancel closes", () => {
    const onCancel = vi.fn();
    render(<LinkedItemSheet candidates={candidates} current={null} onPick={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
});
