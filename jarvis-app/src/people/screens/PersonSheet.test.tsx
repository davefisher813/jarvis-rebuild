// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import PersonSheet from "./PersonSheet";

describe("PersonSheet", () => {
  it("requires a name", () => {
    const onSave = vi.fn();
    render(<PersonSheet mode="new" onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Add a name.")).toBeInTheDocument();
  });

  it("saves the entered fields: chip label, register, and contact identity", () => {
    const onSave = vi.fn();
    render(<PersonSheet mode="new" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Full Name"), { target: { value: "Sam Rivera" } });
    // label via chip, one tap (the blank box was why labels stayed empty)
    fireEvent.click(screen.getByText("Coworker"));
    // the register is a menu (the form sheets on the sheet bar, 2026-09-02)
    fireEvent.click(screen.getByLabelText("How JARVIS writes to them"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Casual" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@work.com" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({
      name: "Sam Rivera", relationship: "Coworker", birthday: "", notes: "", color: "red",
      email: "sam@work.com", phone: "", register: "casual", categoryIds: [],
    });
  });

  it("free text overrides the chip, and register is un-set by Not Set", () => {
    const onSave = vi.fn();
    render(<PersonSheet mode="new" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Full Name"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByText("Friend")); // the label CHIP (exact match; the segment says "Close Friend")
    fireEvent.change(screen.getByPlaceholderText("Or Say It Your Way"), { target: { value: "College roommate" } });
    fireEvent.click(screen.getByLabelText("How JARVIS writes to them"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Professional" }));
    fireEvent.click(screen.getByLabelText("How JARVIS writes to them"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Not Set" })); // unknown => clean prose
    fireEvent.click(screen.getByText("Save"));
    const draft = onSave.mock.calls[0]![0] as { relationship: string; register?: string };
    expect(draft.relationship).toBe("College roommate");
    expect(draft.register).toBeUndefined();
  });

  it("Close Friend is its own register, distinct from the Friend label chip", () => {
    const onSave = vi.fn();
    render(<PersonSheet mode="new" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Full Name"), { target: { value: "Chris" } });
    fireEvent.click(screen.getByLabelText("How JARVIS writes to them"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Close Friend" }));
    fireEvent.click(screen.getByText("Save"));
    const draft = onSave.mock.calls[0]![0] as { register?: string; relationship: string };
    expect(draft.register).toBe("friend");
    expect(draft.relationship).toBe(""); // the register never sets the label
  });

  it("edit mode prefills and offers delete", () => {
    const onDelete = vi.fn();
    render(<PersonSheet mode="edit" initial={{ name: "Dev", group: "contacts", notes: "x", color: "red" }} onSave={() => {}} onDelete={onDelete} onCancel={() => {}} />);
    expect((screen.getByPlaceholderText("Full Name") as HTMLInputElement).value).toBe("Dev");
    fireEvent.click(screen.getByText("Delete Person"));
    expect(onDelete).toHaveBeenCalled();
  });
});
