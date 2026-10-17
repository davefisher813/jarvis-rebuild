// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { useLayerFocus } from "./useLayerFocus";

// THE PRIMARY FIELD, NOT CANCEL (the Logging Standard, 2026-10-17). The hook
// used to focus the first focusable in a new layer, and in every sheet that is
// the bar's Cancel. It prefers the control the sheet marks data-autofocus, then
// the first typed field, and only then the first focusable.

function Host({ children }: { children?: React.ReactNode }) {
  useLayerFocus();
  return <>{children}</>;
}

// jsdom has no layout: every box is 0 by 0, which the hook reads as hidden.
const RECT = { x: 0, y: 0, top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10, toJSON: () => ({}) } as DOMRect;
let orig: typeof Element.prototype.getBoundingClientRect;
beforeAll(() => { orig = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = () => RECT; });
afterAll(() => { Element.prototype.getBoundingClientRect = orig; });
afterEach(cleanup);

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("useLayerFocus: where focus lands in a new layer", () => {
  it("the control marked data-autofocus, ahead of Cancel", async () => {
    render(
      <Host>
        <div className="sheet-scrim"><div className="card">
          <button className="sheet-bar-cancel">Cancel</button>
          <input aria-label="Amount" />
          <input aria-label="Task" data-autofocus />
        </div></div>
      </Host>,
    );
    await settle();
    expect(document.activeElement).toHaveProperty("ariaLabel", "Task");
  });

  it("else the first typed field", async () => {
    render(
      <Host>
        <div className="sheet-scrim"><div className="card">
          <button className="sheet-bar-cancel">Cancel</button>
          <input type="checkbox" aria-label="Done" />
          <textarea aria-label="Notes" />
        </div></div>
      </Host>,
    );
    await settle();
    expect(document.activeElement).toHaveProperty("ariaLabel", "Notes");
  });

  it("else the first focusable, as before", async () => {
    render(
      <Host>
        <div className="sheet-scrim"><div className="card">
          <button className="sheet-bar-cancel">Cancel</button>
          <button>Save</button>
        </div></div>
      </Host>,
    );
    await settle();
    expect(document.activeElement?.textContent).toBe("Cancel");
  });
});
