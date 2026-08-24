// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useRef } from "react";
import { render, act } from "@testing-library/react";
import { useChipInView } from "./useChipInView";

// jsdom measures every width as 0, so this cannot assert where the strip
// LANDS: that belongs to the browser walk, which is where the bug was found.
// What it can hold is the arithmetic and, more importantly, the two rules
// about WHEN it runs, which are the parts a later edit would quietly break.

function Strip({ open, current, onBox }: { open: boolean; current: number; onBox?: (b: HTMLDivElement) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useChipInView(ref, open);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el && onBox) onBox(el);
      }}
    >
      {[15, 30, 45, 60, 90, 120].map((d) => (
        <button key={d} className={"chip" + (d === current ? " chip-on" : "")}>{d}</button>
      ))}
    </div>
  );
}

// jsdom leaves offsetLeft/offsetWidth/clientWidth at 0 and they are read-only
// on the prototype, so the geometry has to be planted.
function size(box: HTMLDivElement, portW: number, chipW: number) {
  Object.defineProperty(box, "clientWidth", { value: portW, configurable: true });
  box.querySelectorAll<HTMLElement>(".chip").forEach((c, i) => {
    Object.defineProperty(c, "offsetWidth", { value: chipW, configurable: true });
    Object.defineProperty(c, "offsetLeft", { value: i * chipW, configurable: true });
  });
}

describe("useChipInView", () => {
  it("centres the current chip in the scroll port", () => {
    let box!: HTMLDivElement;
    const { rerender } = render(<Strip open={false} current={90} onBox={(b) => { box = b; }} />);
    size(box, 280, 90);
    act(() => { rerender(<Strip open current={90} onBox={(b) => { box = b; }} />); });
    // 90m is chip index 4, so offsetLeft 360; 360 - (280 - 90) / 2 = 265
    expect(box.scrollLeft).toBe(265);
  });

  it("never scrolls to a negative offset when the current chip is the first", () => {
    let box!: HTMLDivElement;
    const { rerender } = render(<Strip open={false} current={15} onBox={(b) => { box = b; }} />);
    size(box, 280, 90);
    act(() => { rerender(<Strip open current={15} onBox={(b) => { box = b; }} />); });
    expect(box.scrollLeft).toBe(0);
  });

  it("does nothing while the editor is closed", () => {
    let box!: HTMLDivElement;
    render(<Strip open={false} current={90} onBox={(b) => { box = b; }} />);
    size(box, 280, 90);
    expect(box.scrollLeft).toBe(0);
  });

  // The rule that matters most on a phone: once it is open the user owns the
  // strip. Re-running on every render would yank it back mid-drag.
  it("does not re-scroll on a later render while it stays open", () => {
    let box!: HTMLDivElement;
    const { rerender } = render(<Strip open={false} current={90} onBox={(b) => { box = b; }} />);
    size(box, 280, 90);
    act(() => { rerender(<Strip open current={90} onBox={(b) => { box = b; }} />); });
    box.scrollLeft = 0; // the user scrolls it back
    act(() => { rerender(<Strip open current={90} onBox={(b) => { box = b; }} />); });
    expect(box.scrollLeft).toBe(0);
  });

  it("scrolls again the NEXT time it opens", () => {
    let box!: HTMLDivElement;
    const { rerender } = render(<Strip open={false} current={90} onBox={(b) => { box = b; }} />);
    size(box, 280, 90);
    act(() => { rerender(<Strip open current={90} onBox={(b) => { box = b; }} />); });
    act(() => { rerender(<Strip open={false} current={90} onBox={(b) => { box = b; }} />); });
    box.scrollLeft = 0;
    act(() => { rerender(<Strip open current={90} onBox={(b) => { box = b; }} />); });
    expect(box.scrollLeft).toBe(265);
  });

  it("leaves the strip alone when nothing is selected", () => {
    let box!: HTMLDivElement;
    const { rerender } = render(<Strip open={false} current={-1} onBox={(b) => { box = b; }} />);
    size(box, 280, 90);
    act(() => { rerender(<Strip open current={-1} onBox={(b) => { box = b; }} />); });
    expect(box.scrollLeft).toBe(0);
  });
});
