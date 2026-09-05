// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { useSheetEscape } from "./useSheetEscape";

// BROWSER-F-15 (2026-09-05). No sheet in the app closed on Escape. On an iPad
// or with a hardware keyboard that leaves Cancel at the bottom of a scrolling
// sheet as the only exit, and on the two sheets that fill the whole screen
// (Plan My Day, Add a Metric) there was not even a scrim left to tap.

function Host({ children }: { children?: React.ReactNode }) {
  useSheetEscape();
  return <>{children}</>;
}

const esc = () => act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });

afterEach(cleanup);

describe("useSheetEscape", () => {
  it("presses the sheet's Cancel, not the scrim, when the sheet has one", () => {
    const cancel = vi.fn();
    const scrim = vi.fn();
    render(
      <Host>
        <div className="sheet-scrim" onClick={scrim}>
          {/* every sheet in the app stops the card's clicks reaching the scrim */}
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <button className="sheet-bar-cancel" onClick={cancel}>Cancel</button>
          </div>
        </div>
      </Host>,
    );
    esc();
    expect(cancel, "Escape is a deliberate cancel").toHaveBeenCalledTimes(1);
    expect(scrim, "and not a scrim tap, which a dirty sheet ignores").not.toHaveBeenCalled();
  });

  it("falls back to the scrim's own dismiss when there is no Cancel", () => {
    const scrim = vi.fn();
    render(<Host><div className="sheet-scrim" onClick={scrim}><div className="card">Plan My Day</div></div></Host>);
    esc();
    expect(scrim).toHaveBeenCalledTimes(1);
  });

  it("closes only the top sheet when two are stacked", () => {
    const under = vi.fn(), over = vi.fn();
    render(
      <Host>
        <div className="sheet-scrim" onClick={under}><div className="card">under</div></div>
        <div className="sheet-scrim" onClick={over}><div className="card">over</div></div>
      </Host>,
    );
    esc();
    expect(over).toHaveBeenCalledTimes(1);
    expect(under).not.toHaveBeenCalled();
  });

  // A dropdown inside a sheet has closed itself on Escape since it was
  // written. One key must not also take the sheet out from under it.
  it("leaves Escape to an open dropdown", () => {
    const scrim = vi.fn();
    render(
      <Host>
        <div className="sheet-scrim" onClick={scrim}><div className="card">Edit Task</div></div>
        <div className="hmenu-scrim"><div className="hmenu">Today</div></div>
      </Host>,
    );
    esc();
    expect(scrim).not.toHaveBeenCalled();
  });

  it("does nothing when no sheet is open", () => {
    render(<Host><div className="screen">Today</div></Host>);
    expect(() => esc()).not.toThrow();
  });

  it("ignores every other key", () => {
    const scrim = vi.fn();
    render(<Host><div className="sheet-scrim" onClick={scrim}><div className="card">x</div></div></Host>);
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); });
    expect(scrim).not.toHaveBeenCalled();
  });
});
