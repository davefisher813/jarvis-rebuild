// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import EventSheet, { type SheetCategory } from "./EventSheet";

const CATS: SheetCategory[] = [
  { id: "c1", name: "Work", color: "blue" },
  { id: "c2", name: "Friends", color: "teal" },
];

describe("EventSheet", () => {
  it("new mode: header, no delete", () => {
    render(<EventSheet mode="new" initial={{ date: "2026-05-24" }} categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("New Event")).toBeInTheDocument();
    expect(screen.queryByText("Delete Event")).not.toBeInTheDocument();
  });

  it("blocks save until title present, then saves the draft", () => {
    const onSave = vi.fn();
    render(<EventSheet mode="new" initial={{ date: "2026-05-24" }} categories={CATS} onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Add a title, date, and start time.")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/happening/), { target: { value: "Standup" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ title: "Standup", date: "2026-05-24", start: "09:00", end: "10:00", category: "c1", location: "", recurrence: "none" });
  });

  it("category switch wears its slot color and saves its id", () => {
    const onSave = vi.fn();
    render(<EventSheet mode="new" initial={{ date: "2026-05-24" }} categories={CATS} onSave={onSave} onCancel={() => {}} />);
    expect(document.querySelector(".chip.cat-bg-blue")).toBeTruthy();
    fireEvent.click(screen.getByText("Friends"));
    expect(document.querySelector(".chip.cat-bg-teal")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/happening/), { target: { value: "Lunch" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ title: "Lunch", date: "2026-05-24", start: "09:00", end: "10:00", category: "c2", location: "", recurrence: "none" });
  });

  it("edit mode: prefilled, delete fires", () => {
    const onDelete = vi.fn();
    render(
      <EventSheet
        mode="edit"
        initial={{ title: "Client Call", date: "2026-05-26", start: "10:00", category: "c2" }}
        categories={CATS}
        onSave={() => {}}
        onDelete={onDelete}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Edit Event")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Client Call")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-05-26")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delete Event"));
    expect(onDelete).toHaveBeenCalled();
  });
});
