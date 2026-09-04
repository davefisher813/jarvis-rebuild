// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom";
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
  it("shows the old honest empty state when there's no create handler to wire", () => {
    render(<LinkPicker events={[]} tasks={[]} onPick={vi.fn()} />);
    expect(screen.getByText("Nothing to Link Yet")).toBeTruthy();
  });

  // CREATE AND LINK IN ONE STEP (LinkPicker catalog pick, 2026-09-0X): the
  // empty state becomes the create button, for all five kinds, the moment a
  // caller wires up onCreateNew.
  it("offers all five kinds to create when nothing exists yet and onCreateNew is wired", () => {
    const onCreateNew = vi.fn();
    render(<LinkPicker events={[]} tasks={[]} onPick={vi.fn()} onCreateNew={onCreateNew} />);
    expect(screen.queryByText("Nothing to Link Yet")).not.toBeInTheDocument();
    expect(screen.getByText("Start Something New")).toBeInTheDocument();
    for (const [label, kind] of [["New Event", "event"], ["New Task", "task"], ["New Project", "project"], ["New Person", "person"], ["New Goal", "goal"]] as const) {
      fireEvent.click(screen.getByText(label));
      expect(onCreateNew).toHaveBeenCalledWith(kind);
    }
    expect(onCreateNew).toHaveBeenCalledTimes(5);
  });

  it("still offers New Task from inside a populated Tasks section", () => {
    const onCreateNew = vi.fn();
    render(<LinkPicker events={[]} tasks={[{ id: "t1", text: "Email Sam" }]} onPick={vi.fn()} onCreateNew={onCreateNew} />);
    expect(screen.getByText("Email Sam")).toBeInTheDocument();
    fireEvent.click(screen.getByText("New Task"));
    expect(onCreateNew).toHaveBeenCalledWith("task");
  });

  it("doesn't render any New X row when onCreateNew isn't passed", () => {
    render(<LinkPicker events={[{ id: "e1", title: "Kickoff" }]} tasks={[]} onPick={vi.fn()} />);
    expect(screen.queryByText("New Event")).not.toBeInTheDocument();
  });
});
