// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import InlineEdit from "./InlineEdit";
import { titleCase } from "./casing";

describe("InlineEdit", () => {
  it("syncs the DOM to a new value when nobody is in the field", () => {
    const { rerender } = render(<InlineEdit value="Gym" onSave={() => {}} />);
    expect(screen.getByText("Gym")).toBeInTheDocument();
    rerender(<InlineEdit value="Deep Work" onSave={() => {}} />);
    expect(screen.getByText("Deep Work")).toBeInTheDocument();
  });

  it("never overwrites what is being actively typed, even when a background reload lands mid-keystroke", () => {
    // THE BUG (2026-08-28, Dave: "extremely difficult to type"). NotesFlow
    // saves a block on blur, then reloads the whole note; that reload can
    // land while the person has already moved into the NEXT field and is
    // typing. The old sync effect only checked "does the DOM disagree with
    // the incoming value" - which is true on every keystroke by definition -
    // and stomped the field with the stale pre-edit text, mid-word.
    const { container } = render(<InlineEdit value="Lunch" onSave={() => {}} />);
    const el = container.querySelector("[contenteditable]") as HTMLElement;
    el.focus();
    // Simulate the user typing, uncontrolled (no React state change - this
    // is exactly how the real contentEditable behaves).
    el.textContent = "Lunch with the team";
    // A background reload resolves and hands this same block its OLD,
    // pre-edit value as a fresh prop - the value prop the user's in-progress
    // typing has already diverged from.
    render(<InlineEdit value="Lunch" onSave={() => {}} />, { container: container as unknown as HTMLElement });
    expect(el.textContent).toBe("Lunch with the team");
  });

  it("still syncs the same element once it is no longer focused", () => {
    const { container } = render(<InlineEdit value="Lunch" onSave={() => {}} />);
    const el = container.querySelector("[contenteditable]") as HTMLElement;
    el.focus();
    el.textContent = "Lunch with the team";
    el.blur();
    render(<InlineEdit value="Dinner" onSave={() => {}} />, { container: container as unknown as HTMLElement });
    expect(el.textContent).toBe("Dinner");
  });

  it("blur still saves whatever is in the field", () => {
    const onSave = vi.fn();
    const { container } = render(<InlineEdit value="Gym" onSave={onSave} />);
    const el = container.querySelector("[contenteditable]") as HTMLElement;
    el.textContent = "Morning Gym";
    fireEvent.blur(el);
    expect(onSave).toHaveBeenCalledWith("Morning Gym");
  });
});

// HMN-F-02 (2026-09-05): "blur or Enter saves" had no third path. Two
// minutes of writing in one block, then the phone locked or another app
// opened, came back to the block as it was before; a tab switch while a
// block had the caret removed the element without a blur (WKWebView) and the
// text with it. What has been typed since the last save is now flushed when
// the page hides, when it unloads, and when the field unmounts.
describe("InlineEdit flushes pending text", () => {
  const type = (el: HTMLElement, text: string) => {
    el.focus();
    el.textContent = text;
    fireEvent.input(el);
  };
  const hide = () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  afterEach(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("saves what was typed when the page is hidden, without touching the field", () => {
    const onSave = vi.fn();
    const { container } = render(<InlineEdit value="Gym" onSave={onSave} />);
    const el = container.querySelector("[contenteditable]") as HTMLElement;
    type(el, "Morning Gym with Berto");
    hide();
    expect(onSave).toHaveBeenCalledWith("Morning Gym with Berto");
    expect(el.textContent).toBe("Morning Gym with Berto");
    expect(document.activeElement).toBe(el);
  });

  it("saves on pagehide", () => {
    const onSave = vi.fn();
    const { container } = render(<InlineEdit value="Gym" onSave={onSave} />);
    const el = container.querySelector("[contenteditable]") as HTMLElement;
    type(el, "Morning Gym");
    window.dispatchEvent(new Event("pagehide"));
    expect(onSave).toHaveBeenCalledWith("Morning Gym");
  });

  it("saves what was typed when it is unmounted without a blur", () => {
    const onSave = vi.fn();
    const { container, unmount } = render(<InlineEdit value="Gym" onSave={onSave} />);
    const el = container.querySelector("[contenteditable]") as HTMLElement;
    type(el, "Morning Gym");
    unmount();
    expect(onSave).toHaveBeenCalledWith("Morning Gym");
  });

  it("flushes once: a hide after a blur, or an unmount after a hide, saves nothing again", () => {
    const onSave = vi.fn();
    const { container, unmount } = render(<InlineEdit value="Gym" onSave={onSave} />);
    const el = container.querySelector("[contenteditable]") as HTMLElement;
    type(el, "Morning Gym");
    fireEvent.blur(el);
    expect(onSave).toHaveBeenCalledTimes(1);
    hide();
    expect(onSave).toHaveBeenCalledTimes(1);
    type(el, "Morning Gym again");
    hide();
    expect(onSave).toHaveBeenCalledTimes(2);
    unmount();
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("saves nothing on hide or unmount when nothing was typed", () => {
    const onSave = vi.fn();
    const { container, unmount } = render(<InlineEdit value="Gym" onSave={onSave} />);
    const el = container.querySelector("[contenteditable]") as HTMLElement;
    el.focus();
    hide();
    unmount();
    expect(onSave).not.toHaveBeenCalled();
  });
});

// DISPLAY TRANSFORM (Dave 2026-10-05: typed titles are shown in Title Case and
// stored as typed). The field reads cased when nobody is in it, is edited as
// typed, and what is saved is what was typed.
describe("InlineEdit display transform", () => {
  it("draws the value through the transform at rest, read-only or editable", () => {
    const ro = render(<InlineEdit value="pick the new gym" display={titleCase} />);
    expect(ro.container.textContent).toBe("Pick the New Gym");
    const ed = render(<InlineEdit value="pick the new gym" display={titleCase} onSave={() => {}} />);
    expect(ed.container.querySelector("[contenteditable]")!.textContent).toBe("Pick the New Gym");
  });

  it("swaps the typed text in on focus, saves what was typed, and goes back to the display form on blur", () => {
    const onSave = vi.fn();
    const { container } = render(<InlineEdit value="pick the new gym" display={titleCase} onSave={onSave} />);
    const el = container.querySelector("[contenteditable]") as HTMLElement;
    fireEvent.focus(el);
    expect(el.textContent, "edited as typed").toBe("pick the new gym");
    el.textContent = "pick the new gym today";
    fireEvent.blur(el);
    expect(onSave, "stored as typed").toHaveBeenCalledWith("pick the new gym today");
    expect(el.textContent, "shown cased again").toBe("Pick the New Gym Today");
  });

  it("an editor opened with focus starts on the typed text, not the display form", () => {
    const { container } = render(<InlineEdit value="pick the new gym" display={titleCase} onSave={() => {}} focused />);
    expect(container.querySelector("[contenteditable]")!.textContent).toBe("pick the new gym");
  });

  it("an empty value stays empty (the placeholder slot is not a title)", () => {
    const { container } = render(<InlineEdit value="" display={titleCase} onSave={() => {}} placeholder="Title" />);
    expect(container.querySelector("[contenteditable]")!.textContent).toBe("");
  });

  it("without a transform nothing changes", () => {
    const { container } = render(<InlineEdit value="pick the new gym" onSave={() => {}} />);
    expect(container.querySelector("[contenteditable]")!.textContent).toBe("pick the new gym");
  });
});
