// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import WhatTheySeeScreen from "./WhatTheySeeScreen";
import type { ConsentGrant } from "../types";

// THE CATALOG, CHECKED ON WHAT THE SCREEN DRAWS (Dave 2026-10-05). Each row's title
// was `new Date(at).toLocaleString()` or `.toLocaleDateString()`: the phone's own
// region format ("10/5/2026, 14:15:00"), with seconds and, in a 24-hour region, no
// AM or PM. A moment is "Oct 5, 2:15 PM" and a day is "Oct 5", like every other row.
const at = new Date(2026, 9, 5, 14, 15, 30).getTime();
const grants: ConsentGrant[] = ["sleep", "load", "medication", "body"].map((category) => ({ category: category as ConsentGrant["category"], granted: true, updatedAt: 1 }));
const e = (category: string, data: object = {}) => ({ id: category + "1", data: { category, at, ...data } }) as never;

describe("WhatTheySeeScreen: dates and clocks follow the catalog (2026-10-05)", () => {
  const draw = () => render(
    <WhatTheySeeScreen grants={grants} lightsOut={[e("sleep")]} ateBefore={[]} tookIt={[e("medication")]} callIt={[e("load", { rpe: 7 })]} pointAtIt={[e("body", { side: "front" })]} onManage={() => {}} onBack={() => {}} />,
  );

  it("every row title is a short date, with the clock for a moment, never the phone's numeric format", () => {
    const { container } = draw();
    const titles = Array.from(container.querySelectorAll(".row .conn-name")).map((n) => n.textContent);
    expect(titles).toContain("Oct 5, 2:15 PM");
    expect(titles).toContain("Oct 5");
    for (const t of titles) {
      expect(t, t ?? "").not.toMatch(/\d+\/\d+\/\d+/);
      expect(t, t ?? "").not.toMatch(/:\d{2}:\d{2}/);
    }
  });

  it("holds even where the phone's region is 24-hour", () => {
    const orig = Date.prototype.toLocaleTimeString;
    Date.prototype.toLocaleTimeString = function (loc?: string | string[], o?: Intl.DateTimeFormatOptions) { return orig.call(this, Array.isArray(loc) && loc.length === 0 ? "en-GB" : loc, o); };
    try {
      const { container } = draw();
      const titles = Array.from(container.querySelectorAll(".row .conn-name")).map((n) => n.textContent);
      expect(titles).toContain("Oct 5, 2:15 PM");
    } finally { Date.prototype.toLocaleTimeString = orig; }
  });

  it("the body side under a signal is a word with a capital, not the stored 'front'", () => {
    const { container } = draw();
    expect(Array.from(container.querySelectorAll(".bp-sub")).map((n) => n.textContent)).toContain("Front");
  });
});
