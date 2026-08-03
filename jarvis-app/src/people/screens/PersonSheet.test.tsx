// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import PersonSheet from "./PersonSheet";

describe("PersonSheet", () => {
  it("requires a name", () => {
    const onSave = vi.fn();
    render(<PersonSheet mode="new" group="inner_circle" onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Add a name.")).toBeInTheDocument();
  });

  it("saves the entered fields: chip label, register, and contact identity", () => {
    const onSave = vi.fn();
    render(<PersonSheet mode="new" group="contacts" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Sam Rivera" } });
    // label via chip, one tap (the blank box was why labels stayed empty)
    fireEvent.click(screen.getByText("Coworker"));
    fireEvent.click(screen.getByText("Casual"));
    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "sam@work.com" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({
      name: "Sam Rivera", relationship: "Coworker", birthday: "", notes: "", color: "red",
      email: "sam@work.com", phone: "", register: "casual", categoryIds: [],
    });
  });

  it("free text overrides the chip, and register is un-set by a second tap", () => {
    const onSave = vi.fn();
    render(<PersonSheet mode="new" group="contacts" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByText("Friend"));
    fireEvent.change(screen.getByPlaceholderText("Or say it your way"), { target: { value: "College roommate" } });
    fireEvent.click(screen.getByText("Professional"));
    fireEvent.click(screen.getByText("Professional")); // toggle off => unknown => clean prose
    fireEvent.click(screen.getByText("Save"));
    const draft = onSave.mock.calls[0]![0] as { relationship: string; register?: string };
    expect(draft.relationship).toBe("College roommate");
    expect(draft.register).toBeUndefined();
  });

  it("edit mode prefills and offers delete", () => {
    const onDelete = vi.fn();
    render(<PersonSheet mode="edit" group="inner_circle" initial={{ name: "Dev", group: "inner_circle", notes: "x", color: "red" }} onSave={() => {}} onDelete={onDelete} onCancel={() => {}} />);
    expect((screen.getByPlaceholderText("Full name") as HTMLInputElement).value).toBe("Dev");
    fireEvent.click(screen.getByText("Delete Person"));
    expect(onDelete).toHaveBeenCalled();
  });
});
