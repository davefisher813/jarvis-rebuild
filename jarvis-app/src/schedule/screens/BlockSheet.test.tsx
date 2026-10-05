// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import BlockSheet from "./BlockSheet";

const INITIAL = { label: "Gym", startMin: 6 * 60, endMin: 7 * 60, days: [1, 3, 5] };

describe("BlockSheet", () => {
  it("prefills from the block, no navigation involved", () => {
    render(<BlockSheet initial={INITIAL} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Edit Protected Time")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Gym")).toBeInTheDocument();
    expect(screen.getByDisplayValue("06:00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("07:00")).toBeInTheDocument();
  });

  it("saves the edited basics, nothing else", () => {
    const onSave = vi.fn();
    render(<BlockSheet initial={INITIAL} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByDisplayValue("Gym"), { target: { value: "Morning Gym" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ label: "Morning Gym", startMin: 6 * 60, endMin: 7 * 60, days: [1, 3, 5] });
  });

  it("blocks save with no name and no days, same law as an event needing a title", () => {
    const onSave = vi.fn();
    render(<BlockSheet initial={INITIAL} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByDisplayValue("Gym"), { target: { value: "" } });
    // Un-toggle every day (the block's starting days: Mon, Wed, Fri).
    for (const name of ["Mon", "Wed", "Fri"]) fireEvent.click(screen.getByRole("button", { name }));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Needs a Name · At Least One Day")).toBeInTheDocument();
  });

  it("Move shifts start and end together, same as EventSheet's chips", () => {
    const onSave = vi.fn();
    render(<BlockSheet initial={INITIAL} onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("+15m"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ label: "Gym", startMin: 6 * 60 + 15, endMin: 7 * 60 + 15, days: [1, 3, 5] });
  });

  it("Delete and Edit Full Details fire, Cancel closes without saving", () => {
    const onDelete = vi.fn();
    const onEditFull = vi.fn();
    const onCancel = vi.fn();
    render(<BlockSheet initial={INITIAL} onSave={() => {}} onDelete={onDelete} onEditFull={onEditFull} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Edit Full Details"));
    expect(onEditFull).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Delete Block"));
    expect(onDelete).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
});

// JUST THIS DAY (2026-10-01). Opened from a specific day, the sheet has two
// writers, one per scope, and a scope never calls the other's.
describe("BlockSheet, opened from a day", () => {
  const BREAKFAST = { label: "Breakfast", startMin: 9 * 60 + 30, endMin: 10 * 60 + 30, days: [0, 1, 2, 3, 4, 5, 6] };
  const DAY = { date: "2026-10-01", startMin: 9 * 60 + 30, endMin: 10 * 60 + 30, edited: false };
  const setup = (over: Partial<Parameters<typeof BlockSheet>[0]> = {}) => {
    const fns = { onSave: vi.fn(), onSaveDay: vi.fn(), onSkipDay: vi.fn(), onBackToNormal: vi.fn(), onDelete: vi.fn(), onCancel: vi.fn() };
    render(<BlockSheet initial={BREAKFAST} day={DAY} {...fns} {...over} />);
    return fns;
  };

  it("offers This Day | Every Day, defaulting to This Day", () => {
    setup();
    expect(screen.getByRole("radio", { name: "This Day" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Every Day" })).toHaveAttribute("aria-checked", "false");
  });

  it("without a day there is no scope control and it is the rule editor it was", () => {
    render(<BlockSheet initial={BREAKFAST} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("radio", { name: "This Day" })).toBeNull();
    expect(screen.getByLabelText("Block name")).toBeInTheDocument();
  });

  it("This Day: a nudge saves through the exception writer, never the rule writer", () => {
    const f = setup();
    fireEvent.click(screen.getByText("+30m"));
    fireEvent.click(screen.getByText("Save"));
    expect(f.onSaveDay).toHaveBeenCalledWith({ startMin: 10 * 60, endMin: 11 * 60 });
    expect(f.onSave).not.toHaveBeenCalled();
  });

  it("This Day: the length menu resizes just the day", () => {
    const f = setup();
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "11:30" } });
    fireEvent.click(screen.getByText("Save"));
    expect(f.onSaveDay).toHaveBeenCalledWith({ startMin: 9 * 60 + 30, endMin: 11 * 60 + 30 });
    expect(f.onSave).not.toHaveBeenCalled();
  });

  it("This Day starts from the day's own times, not the rule's", () => {
    setup({ day: { ...DAY, startMin: 11 * 60, endMin: 12 * 60, edited: true } });
    expect(screen.getByDisplayValue("11:00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("12:00")).toBeInTheDocument();
  });

  it("This Day hides the Days strip and the weekly rule's name field", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Mon" })).toBeNull();
    expect(screen.queryByLabelText("Block name")).toBeNull();
    expect(screen.queryByText("Delete Block")).toBeNull();
    expect(screen.getByText("Only Thu, Oct 1 Changes · Every Other Day Keeps Its Usual Time")).toBeInTheDocument();
  });

  it("Every Day keeps today's behaviour: the rule writer, never the exception writer", () => {
    const f = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Every Day" }));
    expect(screen.getByRole("button", { name: "Mon" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("+15m"));
    fireEvent.click(screen.getByText("Save"));
    expect(f.onSave).toHaveBeenCalledWith({ label: "Breakfast", startMin: 9 * 60 + 45, endMin: 10 * 60 + 45, days: [0, 1, 2, 3, 4, 5, 6] });
    expect(f.onSaveDay).not.toHaveBeenCalled();
    expect(f.onSkipDay).not.toHaveBeenCalled();
  });

  it("Every Day starts from the rule's times even when the day carries an exception", () => {
    setup({ day: { ...DAY, startMin: 11 * 60, endMin: 12 * 60, edited: true } });
    fireEvent.click(screen.getByRole("radio", { name: "Every Day" }));
    expect(screen.getByDisplayValue("09:30")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10:30")).toBeInTheDocument();
  });

  it("Skip This Day calls only the skip writer", () => {
    const f = setup();
    fireEvent.click(screen.getByText("Skip This Day"));
    expect(f.onSkipDay).toHaveBeenCalledTimes(1);
    expect(f.onSave).not.toHaveBeenCalled();
    expect(f.onSaveDay).not.toHaveBeenCalled();
  });

  it("Back to Normal appears only on a day that carries an exception, and clears it", () => {
    const plain = setup();
    expect(screen.queryByText("Back to Normal")).toBeNull();
    expect(plain.onBackToNormal).not.toHaveBeenCalled();
  });

  it("Back to Normal calls the clear writer and nothing else", () => {
    const f = setup({ day: { ...DAY, startMin: 11 * 60, endMin: 12 * 60, edited: true } });
    fireEvent.click(screen.getByText("Back to Normal"));
    expect(f.onBackToNormal).toHaveBeenCalledTimes(1);
    expect(f.onSave).not.toHaveBeenCalled();
    expect(f.onSaveDay).not.toHaveBeenCalled();
  });

  it("Delete Block is the whole rule's, so it lives under Every Day", () => {
    const f = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Every Day" }));
    fireEvent.click(screen.getByText("Delete Block"));
    expect(f.onDelete).toHaveBeenCalled();
  });
});
