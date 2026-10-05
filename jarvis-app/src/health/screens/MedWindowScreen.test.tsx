// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import MedWindowScreen from "./MedWindowScreen";
import type { MedWindowDay } from "../medWindow";

// THE CATALOG, CHECKED ON WHAT THE SCREEN DRAWS (Dave 2026-10-05). The header's
// sub line was one string with a middle dot baked in and its first half in
// sentence case, and each mark's time came from the device's locale, so a phone
// in a 24-hour region drew "14:05" with no AM or PM.
const at = new Date(2026, 9, 3, 14, 5).getTime();
const days: MedWindowDay[] = [{ date: "2026-10-03", marks: [{ kind: "dose", at, label: "Dose" }, { kind: "food", at: at + 600_000, label: "Ate Before" }] }];

describe("MedWindowScreen: the catalog (2026-10-05)", () => {
  it("the header is one Title Case grey with no baked dot, and the promise is a note under the card", () => {
    const { container } = render(<MedWindowScreen days={days} hasFood onOpenDoctorReport={() => {}} onBack={() => {}} />);
    const sub = container.querySelector(".bp-sub")!;
    expect(sub.textContent).toBe("Dose, Food, Session Start, Lights Out");
    expect(sub.textContent).not.toContain("·");
    const hint = container.querySelector(".input-hint")!;
    expect(hint.textContent).toBe("Nothing Compared, Nothing Explained");
    expect(hint.closest(".card")).toBeNull();
  });

  it("three facts, without food, drops the word food from the list", () => {
    const { container } = render(<MedWindowScreen days={days} hasFood={false} onOpenDoctorReport={() => {}} onBack={() => {}} />);
    expect(container.querySelector(".bp-sub")!.textContent).toBe("Dose, Session Start, Lights Out");
  });

  it("every mark's time is 12-hour with AM or PM even where the phone's region is 24-hour", () => {
    const orig = Date.prototype.toLocaleTimeString;
    // A 24-hour device: an empty locale list follows it and answers "14:05".
    Date.prototype.toLocaleTimeString = function (loc?: string | string[], o?: Intl.DateTimeFormatOptions) { return orig.call(this, Array.isArray(loc) && loc.length === 0 ? "en-GB" : loc, o); };
    try {
      const { container } = render(<MedWindowScreen days={days} hasFood onOpenDoctorReport={() => {}} onBack={() => {}} />);
      const times = Array.from(container.querySelectorAll(".fact.date")).map((f) => f.textContent ?? "");
      expect(times).toHaveLength(2);
      for (const t of times) expect(t).toMatch(/^\d{1,2}:\d{2}\s?(AM|PM)$/);
    } finally { Date.prototype.toLocaleTimeString = orig; }
  });
});
