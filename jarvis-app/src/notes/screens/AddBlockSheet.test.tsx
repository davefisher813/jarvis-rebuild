// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import AddBlockSheet from "./AddBlockSheet";

// BROWSER-F-13 (2026-09-05). The nine Add Block rows were bare divs with an
// onClick: role null and tabIndex -1 on all nine, so VoiceOver and a keyboard
// could not reach "Text, Heading, Meta Line, Bulleted List, Numbered List,
// Checklist, Table, Photo, File" at all. Tapping always worked, which is
// exactly why nobody caught it, and the crawler's own tappable enumeration
// missed them the same way a screen reader does.

const rows = () => [...document.querySelectorAll(".sheet-scrim .row")];

describe("BROWSER-F-13: every Add Block row is reachable without a finger", () => {
  it("all nine rows announce as buttons and sit in the tab order", () => {
    render(<AddBlockSheet />);
    const r = rows();
    expect(r).toHaveLength(9);
    for (const el of r) {
      expect(el.getAttribute("role"), (el.textContent ?? "") + " announces as a button").toBe("button");
      expect(el.getAttribute("tabindex"), (el.textContent ?? "") + " is reachable by Tab").toBe("0");
    }
  });

  it("Enter and Space pick a block, the same as a tap", () => {
    for (const k of ["Enter", " "]) {
      const onSelect = vi.fn();
      const { unmount } = render(<AddBlockSheet onSelect={onSelect} />);
      fireEvent.keyDown(rows()[1]!, { key: k });
      expect(onSelect, `${k} picks Heading`).toHaveBeenCalledWith("heading");
      unmount();
    }
  });

  it("a tap still picks it", () => {
    const onSelect = vi.fn();
    render(<AddBlockSheet onSelect={onSelect} />);
    fireEvent.click(rows()[6]!);
    expect(onSelect).toHaveBeenCalledWith("table");
  });
});
