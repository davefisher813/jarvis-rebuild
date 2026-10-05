// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    // the relationship is one menu row (the seven labels and "Your Own Words"), not a pile of chips that wrapped into three
    // ragged lines (Dave 2026-10-05, the review)
    fireEvent.click(screen.getByLabelText("Who they are to you"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Coworker" }));
    // the register is a menu (the form sheets on the sheet bar, 2026-09-02)
    fireEvent.click(screen.getByLabelText("How JARVIS writes to them"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Casual" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@work.com" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({
      name: "Sam Rivera", aliases: [], relationship: "Coworker", roles: [], birthday: "", notes: "", color: "red",
      email: "sam@work.com", phone: "", register: "casual", categoryIds: [],
    });
  });

  it("free text overrides the chip, and register is un-set by Not Set", () => {
    const onSave = vi.fn();
    render(<PersonSheet mode="new" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Full Name"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByLabelText("Who they are to you"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Friend" })); // the label (exact match; the register says "Close Friend")
    // Your Own Words opens a field, labelled like every other row, and what is typed there is the label
    fireEvent.click(screen.getByLabelText("Who they are to you"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Your Own Words" }));
    fireEvent.change(screen.getByLabelText("Who they are to you, in your words"), { target: { value: "College roommate" } });
    fireEvent.click(screen.getByLabelText("How JARVIS writes to them"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Professional" }));
    fireEvent.click(screen.getByLabelText("How JARVIS writes to them"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Not Set" })); // unknown => clean prose
    fireEvent.click(screen.getByText("Save"));
    const draft = onSave.mock.calls[0]![0] as { relationship: string; register?: string };
    expect(draft.relationship).toBe("College roommate");
    expect(draft.register).toBeUndefined();
  });

  // THE FORM, AS THE REVIEW LEFT IT (Dave 2026-10-05): every row is labelled (the name was a bare value under a bold "Also Called"),
  // "Mom, Linda" is gone from under every contact, the colour and birthday sit behind one disclosure, and the colour grid is a
  // 44px reach with the picked swatch ringed and checked.
  it("every field row has its label, and the alias placeholder is no invitation to a nonsense alias", () => {
    render(<PersonSheet mode="new" onSave={() => {}} onCancel={() => {}} />);
    const labels = Array.from(document.body.querySelectorAll(".row .conn-name")).map((e) => e.textContent);
    for (const l of ["Name", "Also Called", "Relationship", "JARVIS Writes", "Email", "Phone"]) expect(labels).toContain(l);
    expect(screen.queryByPlaceholderText("Mom, Linda")).toBeNull();
    expect(screen.getByLabelText("Other names for this person")).toHaveAttribute("placeholder", "Nicknames");
  });

  it("the relationship offers its own words only when asked, and the own-words row is labelled", () => {
    render(<PersonSheet mode="edit" initial={{ name: "Marcus", group: "contacts", notes: "", color: "red", relationship: "Attorney" }} onSave={() => {}} onCancel={() => {}} />);
    // "Attorney" is not one of the seven, so it is the person's own words and the field says so.
    expect(screen.getByText("Your Own Words")).toBeInTheDocument();
    expect(screen.getByLabelText("Who they are to you, in your words")).toHaveValue("Attorney");
    expect(screen.getByText("In Your Words")).toBeInTheDocument();
  });

  it("the colour sits behind More Details; the picked swatch is ringed and checked, and the first swatch is no colour", () => {
    render(<PersonSheet mode="new" onSave={() => {}} onCancel={() => {}} />);
    const more = document.body.querySelector("details.exp-more")!;
    expect((more as HTMLDetailsElement).open).toBe(false);
    expect(more.querySelector("summary")!.textContent).toBe("More Details");
    const swatches = Array.from(more.querySelectorAll(".swatch-grid .swatch"));
    expect(swatches[0]!.className).toContain("swatch-none");
    // New people start as no colour, so something reads as picked; no other swatch does.
    expect(swatches.filter((b) => b.classList.contains("sel"))).toEqual([swatches[0]]);
    expect(swatches[0]!.querySelector(".ic")).not.toBeNull();
    fireEvent.click(swatches[3]!);
    const after = Array.from(more.querySelectorAll(".swatch-grid .swatch"));
    expect(after.filter((b) => b.classList.contains("sel"))).toEqual([after[3]]);
    expect(after[3]!.querySelector(".ic")).not.toBeNull();
    expect(after[3]!.getAttribute("aria-pressed")).toBe("true");
    // The grid is whole rows: a count that leaves stragglers on a last row is the defect.
    expect(swatches.length % 6).toBe(0);
  });

  it("a person with a birthday or a colour opens the disclosure on it", () => {
    render(<PersonSheet mode="edit" initial={{ name: "Dev", group: "contacts", notes: "", color: "blue", birthday: "March 4" }} onSave={() => {}} onCancel={() => {}} />);
    expect((document.body.querySelector("details.exp-more") as HTMLDetailsElement).open).toBe(true);
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

  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save used to
  // fire onSave every tap, so a fast double-tap wrote the person twice.
  it("a fast double-tap on Save only fires once, and the button says so", () => {
    const onSave = vi.fn();
    render(<PersonSheet mode="new" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Full Name"), { target: { value: "Sam Rivera" } });
    const save = screen.getByText("Save");
    fireEvent.click(save);
    expect(save).toHaveTextContent("Saving");
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("edit mode prefills and offers delete", () => {
    const onDelete = vi.fn();
    render(<PersonSheet mode="edit" initial={{ name: "Dev", group: "contacts", notes: "x", color: "red" }} onSave={() => {}} onDelete={onDelete} onCancel={() => {}} />);
    expect((screen.getByPlaceholderText("Full Name") as HTMLInputElement).value).toBe("Dev");
    fireEvent.click(screen.getByText("Delete Person"));
    expect(onDelete).toHaveBeenCalled();
  });
});

// BRAIN-F-09 (2026-09-05): the latch above is right, but it had no way back.
// A parent whose write failed left the button on "Saving" for good, and the
// only exit, Cancel, threw the whole edit away.
describe("PersonSheet save latch (BRAIN-F-09)", () => {
  it("lets go of the button when the parent says the write did not land", async () => {
    const onSave = vi.fn(() => Promise.resolve(false));
    render(<PersonSheet mode="new" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Full Name"), { target: { value: "Sam Rivera" } });
    const save = screen.getByText("Save");
    fireEvent.click(save);
    expect(save).toHaveTextContent("Saving");
    await waitFor(() => expect(save).toHaveTextContent("Save"));
    // Tappable again, with the typing still in the sheet.
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(2);
    expect((screen.getByPlaceholderText("Full Name") as HTMLInputElement).value).toBe("Sam Rivera");
  });

  it("lets go when the parent's write throws instead", async () => {
    const onSave = vi.fn(() => Promise.reject(new Error("offline")));
    render(<PersonSheet mode="new" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Full Name"), { target: { value: "Ana Diaz" } });
    const save = screen.getByText("Save");
    fireEvent.click(save);
    await waitFor(() => expect(save).toHaveTextContent("Save"));
  });
});
