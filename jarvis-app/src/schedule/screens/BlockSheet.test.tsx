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
    expect(screen.getByText("Needs a name · At least one day")).toBeInTheDocument();
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
