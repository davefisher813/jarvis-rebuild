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

  it("still labels itself the family's own log and exports only on a tap", () => {
    const onExport = vi.fn();
    render(<DoctorReportScreen {...base} kinds={[...base.kinds]} onExport={onExport} />);
    expect(screen.getByText("The Family's Own Log")).toBeInTheDocument();
    expect(onExport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Export This Log" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
