// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import WindowsSheet, { MIDNIGHT_LINE } from "./WindowsSheet";
import { DEFAULT_WINDOWS } from "./batching";

// E-12 (Push G): the sheet is a list of "time · length" rows; a chevron
// opens a single-window editor. Nothing is live until Start/Save.
describe("the windows editor", () => {
  it("lists each window as time · length and nothing is live until Start", () => {
    const onSave = vi.fn();
    render(<WindowsSheet initial={DEFAULT_WINDOWS} onSave={onSave} onClose={() => {}} />);
    expect(screen.getByText("9 AM · 45m")).toBeInTheDocument();
    expect(screen.getByText("1 PM · 45m")).toBeInTheDocument();
    expect(screen.getByText("5 PM · 45m")).toBeInTheDocument();
    // The length chips live in the editor, one window at a time.
    expect(screen.queryByLabelText("Window 1: 90 minutes")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Edit window 1"));
    fireEvent.click(screen.getByLabelText("Window 1: 90 minutes"));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Done"));
    expect(screen.getByText("9 AM · 1h 30m")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Start Windows"));
    expect(onSave).toHaveBeenCalledTimes(1);
    const [saved, mirror] = onSave.mock.calls[0]!;
    expect(saved.on).toBe(true);
    expect(saved.windows[0].minutes).toBe(90);
    expect(mirror).toBe(false);
  });

  it("the editor's Cancel keeps the row as it was, and Start is held while an editor is open", () => {
    render(<WindowsSheet initial={DEFAULT_WINDOWS} onSave={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Edit window 2"));
    expect(screen.getByText("Start Windows")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Window 2: 30 minutes"));
    fireEvent.click(screen.getByText("Cancel", { selector: ".quiet-action" }));
    expect(screen.getByText("1 PM · 45m")).toBeInTheDocument();
    expect(screen.getByText("Start Windows")).not.toBeDisabled();
  });

  it("[E-14] refuses a window that would cross midnight, with a line, instead of truncating", () => {
    const onSave = vi.fn();
    render(<WindowsSheet initial={DEFAULT_WINDOWS} onSave={onSave} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Edit window 3"));
    fireEvent.change(screen.getByLabelText("Window 3 start"), { target: { value: "23:30" } });
    // 23:30 + 45m runs past midnight.
    expect(screen.getByRole("alert")).toHaveTextContent(MIDNIGHT_LINE);
    expect(screen.getByText("Done")).toBeDisabled();
    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByText("11:30 PM · 45m")).not.toBeInTheDocument();
    // A shorter length makes it fit, and the line goes.
    fireEvent.click(screen.getByLabelText("Window 3: 30 minutes"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Done"));
    expect(screen.getByText("11:30 PM · 30m")).toBeInTheDocument();
  });

  it("shows Save, not Start, when the curtain is already on, and offers Turn Off", () => {
    const off = vi.fn();
    render(<WindowsSheet initial={{ ...DEFAULT_WINDOWS, on: true }} onSave={() => {}} onTurnOff={off} onClose={() => {}} />);
    expect(screen.getByText("Save")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Turn Off", { selector: ".btn" }));
    expect(off).toHaveBeenCalled();
  });

  it("[edge] when the feature is off there is no Turn Off button to tap", () => {
    render(<WindowsSheet initial={DEFAULT_WINDOWS} onSave={() => {}} onClose={() => {}} />);
    expect(screen.queryByText("Turn Off", { selector: ".btn" })).not.toBeInTheDocument();
  });

  it("adds and removes windows from the editor, and the last one has no Remove", () => {
    render(<WindowsSheet initial={DEFAULT_WINDOWS} onSave={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Add a Window"));
    expect(screen.getAllByLabelText(/^Edit window/).length).toBe(4);
    for (let n = 4; n > 1; n--) {
      fireEvent.click(screen.getByLabelText("Edit window " + n));
      fireEvent.click(screen.getByLabelText("Remove window " + n));
    }
    expect(screen.getAllByLabelText(/^Edit window/).length).toBe(1);
    fireEvent.click(screen.getByLabelText("Edit window 1"));
    expect(screen.queryByText("Remove")).not.toBeInTheDocument();
  });

  it("day chips read Su..Sa, invert when on, and the scrim closes without saving", () => {
    const onSave = vi.fn(); const onClose = vi.fn();
    render(<WindowsSheet initial={DEFAULT_WINDOWS} onSave={onSave} onClose={onClose} />);
    expect(screen.getByText("Su")).toBeInTheDocument();
    expect(screen.getByText("Sa")).toBeInTheDocument();
    const sat = screen.getByLabelText("Runs on day 6");
    expect(sat).toHaveAttribute("aria-pressed", "false");
    expect(sat.className).not.toMatch(/\bon\b/);
    fireEvent.click(sat);
    expect(screen.getByLabelText("Runs on day 6")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Runs on day 6").className).toMatch(/\bon\b/);
    expect(screen.getByLabelText("Runs on day 6").className).not.toMatch(/chip-on/); // inverted, never the red fill
    expect(screen.getByText("Times are device local")).toBeInTheDocument();
    fireEvent.click(document.querySelector(".sheet-scrim")!);
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("[E-14] Same on Every Device is off by default and rides out with Save", () => {
    const onSave = vi.fn();
    render(<WindowsSheet initial={{ ...DEFAULT_WINDOWS, on: true }} onSave={onSave} onClose={() => {}} />);
    expect(screen.getByText(/stay on this device/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Turn On"));
    expect(screen.getByText(/Rides the mail mirror/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![1]).toBe(true);
  });
});
