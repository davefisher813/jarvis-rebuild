// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import NightBeforeScreen from "./NightBeforeScreen";

// THE CLOCK LAW (Dave 2026-10-05): the offer's clock times are 12-hour with AM or PM
// whatever the phone's region says. They followed the device locale, so a 24-hour
// region drew "Wind Down At 22:30" and "Practice at 06:00 tomorrow".
const offer = { commitmentTitle: "Practice", commitmentAt: new Date(2026, 9, 6, 6, 0).getTime(), windDownAt: new Date(2026, 9, 5, 21, 30).getTime() };

describe("NightBeforeScreen: the clock follows the catalog (2026-10-05)", () => {
  it("both times are 12-hour with AM or PM even where the phone's region is 24-hour", () => {
    const orig = Date.prototype.toLocaleTimeString;
    Date.prototype.toLocaleTimeString = function (loc?: string | string[], o?: Intl.DateTimeFormatOptions) { return orig.call(this, Array.isArray(loc) && loc.length === 0 ? "en-GB" : loc, o); };
    try {
      const { container } = render(<NightBeforeScreen offer={offer} onAddWindDown={() => {}} onBack={() => {}} />);
      expect(container.querySelector(".p3-q")!.textContent).toMatch(/^Wind Down At 9:30\s?PM$/);
      expect(container.querySelector(".bp-sub")!.textContent).toMatch(/^Practice at 6:00\s?AM tomorrow\.$/);
    } finally { Date.prototype.toLocaleTimeString = orig; }
  });
});
