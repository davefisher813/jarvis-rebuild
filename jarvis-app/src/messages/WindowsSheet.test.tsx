// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import WindowsSheet from "./WindowsSheet";
import { DEFAULT_WINDOWS } from "./batching";

describe("the windows editor", () => {
  it("nothing is live until Start: edits stay in the draft", () => {
    const onSave = vi.fn();
    render(<WindowsSheet initial={DEFAULT_WINDOWS} onSave={onSave} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Window 1: 90 minutes"));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Start Windows"));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]![0];
    expect(saved.on).toBe(true);
    expect(saved.windows[0].minutes).toBe(90);
  });

  it("shows Save, not Start, when the curtain is already on, and offers Turn Off", () => {
    const off = vi.fn();
    render(<WindowsSheet initial={{ ...DEFAULT_WINDOWS, on: true }} onSave={() => {}} onTurnOff={off} onClose={() => {}} />);
    expect(screen.getByText("Save")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Turn Off"));
    expect(off).toHaveBeenCalled();
  });

  it("[edge] when the feature is off there is no Turn Off to tap", () => {
    render(<WindowsSheet initial={DEFAULT_WINDOWS} onSave={() => {}} onClose={() => {}} />);
    expect(screen.queryByText("Turn Off")).not.toBeInTheDocument();
  });

  it("adds and removes windows, and the last one has no Remove", () => {
    render(<WindowsSheet initial={DEFAULT_WINDOWS} onSave={() => {}} onClose={() => {}} />);
    expect(screen.getAllByText("Remove").length).toBe(3);
    fireEvent.click(screen.getByText("Add a Window"));
    expect(screen.getAllByText("Remove").length).toBe(4);
    fireEvent.click(screen.getAllByText("Remove")[3]!);
    fireEvent.click(screen.getAllByText("Remove")[2]!);
    fireEvent.click(screen.getAllByText("Remove")[1]!);
    expect(screen.queryByText("Remove")).not.toBeInTheDocument();
  });

  it("day chips toggle, and the scrim closes without saving", () => {
    const onSave = vi.fn(); const onClose = vi.fn();
    render(<WindowsSheet initial={DEFAULT_WINDOWS} onSave={onSave} onClose={onClose} />);
    const sat = screen.getByLabelText("Runs on day 6");
    expect(sat).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(sat);
    expect(screen.getByLabelText("Runs on day 6")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(document.querySelector(".sheet-scrim")!);
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
