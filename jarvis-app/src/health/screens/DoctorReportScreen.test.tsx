// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DoctorReportScreen from "./DoctorReportScreen";
import type { DoctorReport } from "../doctorReport";

// Health Push F, H-47 (2026-09-12): the two choosers above the preview.
const report: DoctorReport = { fromDate: "2026-08-02", toDate: "2026-09-13", generatedAt: 1, rows: [] };
const base = {
  report, range: "6w" as const, onRange: () => {}, custom: { from: "2026-08-02", to: "2026-09-13" }, onCustom: () => {},
  kinds: ["dose", "lights_out", "food", "session"] as const, onToggleKind: () => {}, onExport: () => {}, onBack: () => {},
};

describe("DoctorReportScreen choosers", () => {
  it("offers three ranges, and Pick Dates shows the two dates", () => {
    const onRange = vi.fn();
    const { rerender } = render(<DoctorReportScreen {...base} kinds={[...base.kinds]} onRange={onRange} />);
    expect(screen.queryByLabelText("From")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "3 Months" }));
    expect(onRange).toHaveBeenCalledWith("3m");
    rerender(<DoctorReportScreen {...base} kinds={[...base.kinds]} range="custom" />);
    expect(screen.getByLabelText("From")).toHaveValue("2026-08-02");
    expect(screen.getByLabelText("To")).toHaveValue("2026-09-13");
  });

  it("toggles a kind, and offers Meals only once there is one", () => {
    const onToggleKind = vi.fn();
    const { rerender } = render(<DoctorReportScreen {...base} kinds={[...base.kinds]} onToggleKind={onToggleKind} />);
    expect(screen.queryByRole("button", { name: "Meals" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bedtime" }));
    expect(onToggleKind).toHaveBeenCalledWith("lights_out");
    expect(screen.getByRole("button", { name: "Doses" })).toHaveAttribute("aria-pressed", "true");
    rerender(<DoctorReportScreen {...base} kinds={["dose"]} hasMeals />);
    expect(screen.getByRole("button", { name: "Meals" })).toHaveAttribute("aria-pressed", "false");
  });

  // AN INCLUDE CHIP NEEDS SOMETHING TO INCLUDE (2026-10-04). Ate Before was
  // always offered, but nothing in the app records one (the screen that does
  // stays dormant), so the chip filtered nothing; Meals and Check Ins already
  // wait for a row of their own.
  it("offers Ate Before only once a mark exists to include", () => {
    const { rerender } = render(<DoctorReportScreen {...base} kinds={[...base.kinds]} />);
    expect(screen.queryByRole("button", { name: "Ate Before" })).toBeNull();
    rerender(<DoctorReportScreen {...base} kinds={[...base.kinds]} hasAteBefore />);
    expect(screen.getByRole("button", { name: "Ate Before" })).toHaveAttribute("aria-pressed", "true");
  });

  it("still labels itself the family's own log and exports only on a tap", () => {
    const onExport = vi.fn();
    render(<DoctorReportScreen {...base} kinds={[...base.kinds]} onExport={onExport} />);
    expect(screen.getByText("The Family's Own Log")).toBeInTheDocument();
    expect(onExport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Export This Log" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});

// THE CATALOG, CHECKED ON WHAT THE SCREEN DRAWS (Dave 2026-10-05). The header
// printed the report's own ISO dates in one sentence-case grey run with the
// disclaimer, and each row's clock came from the phone's locale.
describe("DoctorReportScreen: the catalog (2026-10-05)", () => {
  const at = new Date(2026, 8, 3, 14, 5).getTime();
  const withRows: DoctorReport = { ...report, rows: [{ date: "2026-09-03", at, kind: "dose", label: "Dose Logged" }] };

  it("the window is one small-caps date fact in plain words, and the disclaimer is a note below the card", () => {
    const { container } = render(<DoctorReportScreen {...base} kinds={[...base.kinds]} />);
    const head = container.querySelector(".card.pad")!;
    expect(head.querySelector(".fact.date")!.textContent).toBe("Aug 2 to Sep 13");
    expect(head.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const hint = container.querySelector(".input-hint")!;
    expect(hint.textContent).toMatch(/^Not a medical record/);
    expect(hint.closest(".card")).toBeNull();
  });

  it("a row's clock is 12-hour with AM or PM even where the phone's region is 24-hour", () => {
    const orig = Date.prototype.toLocaleTimeString;
    Date.prototype.toLocaleTimeString = function (loc?: string | string[], o?: Intl.DateTimeFormatOptions) { return orig.call(this, Array.isArray(loc) && loc.length === 0 ? "en-GB" : loc, o); };
    try {
      const { container } = render(<DoctorReportScreen {...base} kinds={[...base.kinds]} report={withRows} />);
      const facts = Array.from(container.querySelectorAll(".row .fact.date")).map((f) => f.textContent ?? "");
      expect(facts).toHaveLength(2);
      expect(facts[1]).toMatch(/^\d{1,2}:\d{2}\s?(AM|PM)$/);
    } finally { Date.prototype.toLocaleTimeString = orig; }
  });
});
