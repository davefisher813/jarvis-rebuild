// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import QuickCreateSheet, { nextHalfHour } from "./QuickCreateSheet";

describe("QuickCreateSheet", () => {
  it("titles and labels itself per kind", () => {
    render(<QuickCreateSheet kind="task" onCreate={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("New Task")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What needs doing?")).toBeInTheDocument();
  });

  it("blocks save on an empty name, shows the error, then creates trimmed", () => {
    const onCreate = vi.fn();
    render(<QuickCreateSheet kind="event" onCreate={onCreate} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Save"));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText("Add a name.")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("What's happening?"), { target: { value: "  Morning Standup  " } });
    fireEvent.click(screen.getByText("Save"));
    expect(onCreate).toHaveBeenCalledWith("Morning Standup");
  });

  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save used to
  // fire onCreate every tap, so a fast double-tap made the thing twice.
  it("a fast double-tap on Save only fires once, and the button says so", () => {
    const onCreate = vi.fn();
    render(<QuickCreateSheet kind="person" onCreate={onCreate} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Full Name"), { target: { value: "Sam Rivera" } });
    const save = screen.getByText("Save");
    fireEvent.click(save);
    expect(save).toHaveTextContent("Saving");
    fireEvent.click(save);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("Enter in the field saves, like every one-name-long sheet", () => {
    const onCreate = vi.fn();
    render(<QuickCreateSheet kind="goal" onCreate={onCreate} onCancel={() => {}} />);
    const field = screen.getByPlaceholderText("e.g. Run a half marathon");
    fireEvent.change(field, { target: { value: "Run a 10k" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onCreate).toHaveBeenCalledWith("Run a 10k");
  });

  it("Cancel fires without creating anything", () => {
    const onCancel = vi.fn();
    const onCreate = vi.fn();
    render(<QuickCreateSheet kind="project" onCreate={onCreate} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("nextHalfHour", () => {
  it("rounds up to the next half hour", () => {
    expect(nextHalfHour(new Date(2026, 0, 1, 9, 10))).toBe("09:30");
    expect(nextHalfHour(new Date(2026, 0, 1, 9, 45))).toBe("10:00");
  });

  it("rolls midnight over rather than reading 24:00", () => {
    expect(nextHalfHour(new Date(2026, 0, 1, 23, 45))).toBe("00:00");
  });
});
