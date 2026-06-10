// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TaskSheet, { type SheetCategory } from "./TaskSheet";

const CATS: SheetCategory[] = [
  { id: "c1", name: "Work", color: "blue" },
  { id: "c2", name: "Money", color: "yellow" },
];
const DAY = 86400000;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = iso(new Date());
const tomorrow = iso(new Date(Date.now() + DAY));

describe("TaskSheet", () => {
  it("new mode: header, no delete, empty field", () => {
    render(<TaskSheet mode="new" categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("New Task")).toBeInTheDocument();
    expect(screen.queryByText("Delete Task")).not.toBeInTheDocument();
  });

  it("blocks save on empty text, shows error, then saves trimmed", () => {
    const onSave = vi.fn();
    render(<TaskSheet mode="new" categories={CATS} onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Add a task name.")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("What needs doing?"), { target: { value: "  Pay rent  " } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ text: "Pay rent", category: "c1", due: "", repeat: "" });
  });

  it("selected category chip wears its slot color and is switchable", () => {
    const onSave = vi.fn();
    const { container } = render(<TaskSheet mode="new" categories={CATS} onSave={onSave} onCancel={() => {}} />);
    expect(container.querySelector(".chip.cat-bg-blue")).toBeTruthy(); // default first
    fireEvent.click(screen.getByText("Money"));
    expect(container.querySelector(".chip.cat-bg-yellow")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("What needs doing?"), { target: { value: "X" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ text: "X", category: "c2", due: "", repeat: "" });
  });

  it("due quick-picks set the date", () => {
    const onSave = vi.fn();
    render(<TaskSheet mode="new" categories={CATS} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("What needs doing?"), { target: { value: "X" } });
    fireEvent.click(screen.getByText("Today"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ text: "X", category: "c1", due: today, repeat: "" });
  });

  it("edit mode: prefilled, delete present and fires", () => {
    const onDelete = vi.fn();
    render(
      <TaskSheet
        mode="edit"
        initial={{ text: "Send Invoice", category: "c2", due: tomorrow }}
        categories={CATS}
        onSave={() => {}}
        onDelete={onDelete}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Edit Task")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Send Invoice")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delete Task"));
    expect(onDelete).toHaveBeenCalled();
  });
});
