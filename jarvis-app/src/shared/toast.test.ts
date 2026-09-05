import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { showToast, hideToast, subscribeToast, resetToasts, type ToastState } from "./toast";

// SHARED-F-09 (2026-09-05), option A. The store held one toast and replacement
// was unconditional: bulk-delete twelve tasks ("Deleted 12 Tasks · Undo"), then
// a "Couldn't save · Check your connection" from an unrelated background write
// two seconds later, and the Undo for the twelve deletions was gone for good.
// There is no confirm step anywhere by design (SelectBar.tsx:22-25), so that
// toast IS the safety net.

const seen: Array<ToastState | null> = [];
let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  resetToasts();
  seen.length = 0;
  stop = subscribeToast((t) => seen.push(t));
});
afterEach(() => { stop(); resetToasts(); vi.useRealTimers(); });

const undo = { message: "Deleted 12 Tasks", actionLabel: "Undo", onAction: () => {} };
const plain = { message: "Couldn't save. Check your connection and try again." };

describe("SHARED-F-09: a plain toast never eats an Undo", () => {
  it("holds a toast with no action behind one that has an action", () => {
    showToast(undo);
    showToast(plain);
    expect(seen.at(-1), "the Undo is still on screen").toEqual(undo);
  });

  it("shows the held one the moment the action toast expires", () => {
    showToast(undo, 5000);
    showToast(plain);
    vi.advanceTimersByTime(5000);
    expect(seen.at(-1), "the message is not thrown away, it waits").toEqual(plain);
  });

  it("shows it as soon as the action is taken, too", () => {
    showToast(undo);
    showToast(plain);
    hideToast(); // what tapping Undo does
    expect(seen.at(-1)).toEqual(plain);
  });

  it("keeps only the newest waiting message, not a pile of stale receipts", () => {
    showToast(undo);
    showToast({ message: "first" });
    showToast({ message: "second" });
    hideToast();
    expect(seen.at(-1)).toEqual({ message: "second" });
  });

  // The rules that must NOT change: an action toast still replaces anything,
  // including another action toast, and a plain toast still replaces a plain
  // toast. Only the one case is guarded.
  it("an action toast still replaces whatever is up", () => {
    showToast(plain);
    showToast(undo);
    expect(seen.at(-1)).toEqual(undo);
    const second = { message: "Deleted 1 Task", actionLabel: "Undo", onAction: () => {} };
    showToast(second);
    expect(seen.at(-1), "the newer Undo is the one that matters").toEqual(second);
  });

  it("a plain toast still replaces a plain toast", () => {
    showToast({ message: "one" });
    showToast({ message: "two" });
    expect(seen.at(-1)).toEqual({ message: "two" });
  });

  // And the held one runs its own clock, not the leftovers of the one before.
  it("the held toast gets its full time once it is shown", () => {
    showToast(undo, 5000);
    showToast(plain, 4000);
    vi.advanceTimersByTime(5000);
    expect(seen.at(-1)).toEqual(plain);
    vi.advanceTimersByTime(3999);
    expect(seen.at(-1)).toEqual(plain);
    vi.advanceTimersByTime(1);
    expect(seen.at(-1)).toBeNull();
  });
});
