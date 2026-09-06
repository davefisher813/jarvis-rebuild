import { describe, it, expect } from "vitest";
import { LADDER, ladderBody } from "./countdown";

// THE COUNTDOWN LADDER (B1, approved 2026-08-20). No test file existed for
// this module before S6-Q36 touched ladderBody -- these pin the rungs, the
// tone shift as an event closes, and (S6-Q36) the closing rung naming a
// real first move instead of a placeholder for one.

describe("ladderBody", () => {
  it("shifts from information to instruction as the event closes", () => {
    expect(ladderBody(60)).toBe("In an hour");
    expect(ladderBody(30)).toBe("In half an hour");
    expect(ladderBody(15)).toBe("Fifteen minutes");
    expect(ladderBody(5)).toBe("Leave what you're doing");
  });

  it("appends the place when there is one, at every rung", () => {
    expect(ladderBody(60, "Ridgeline Fields")).toBe("In an hour · Ridgeline Fields");
    expect(ladderBody(5, "Ridgeline Fields")).toBe("Leave what you're doing · Ridgeline Fields");
  });

  // S6-Q36 (2026-09-04): "the first move is thrown away, never stored."
  it("names the real first move on the closing rung instead of the generic instruction", () => {
    expect(ladderBody(5, undefined, "Open the invoice template")).toBe("Open the invoice template");
    expect(ladderBody(5, "Ridgeline Fields", "Open the invoice template")).toBe("Open the invoice template · Ridgeline Fields");
  });

  it("never lets a first move leak onto the earlier, informational rungs", () => {
    expect(ladderBody(60, undefined, "Open the invoice template")).toBe("In an hour");
    expect(ladderBody(15, undefined, "Open the invoice template")).toBe("Fifteen minutes");
  });

  it("falls back to the generic instruction when the first move is blank", () => {
    expect(ladderBody(5, undefined, "   ")).toBe("Leave what you're doing");
  });
});

