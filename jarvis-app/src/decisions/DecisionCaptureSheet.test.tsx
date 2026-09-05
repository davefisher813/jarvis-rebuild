// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DecisionCaptureSheet from "./DecisionCaptureSheet";

// BRAIN-F-02 (2026-09-05): "decision revisits land a day early." The sheet
// computed Week and Month by adding a fixed 86,400,000ms to local midnight
// and reading the UTC date back, so in Berlin (UTC+2 in summer) Week was six
// days out and Month twenty-nine. Under a zone east of Greenwich the chips
// must land on the local calendar day.

function localPlus(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("DecisionCaptureSheet revisit dates", () => {
  it("Week and Month step whole local days under Europe/Berlin", () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "Europe/Berlin";
    try {
      const onSave = vi.fn();
      render(<DecisionCaptureSheet attachOptions={[]} onSave={onSave} onCancel={() => {}} />);
      fireEvent.change(screen.getByLabelText("What you decided"), { target: { value: "Saturdays only" } });
      fireEvent.click(screen.getByText("Week"));
      expect(screen.getByText("Week")).toHaveClass("active");
      fireEvent.click(screen.getByText("Save"));
      expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ revisitOn: localPlus(7) }));
      fireEvent.click(screen.getByText("Month"));
      expect(screen.getByText("Month")).toHaveClass("active");
      fireEvent.click(screen.getByText("Save"));
      expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ revisitOn: localPlus(30) }));
    } finally {
      process.env.TZ = prevTz;
    }
  });

  // The chip only reads as active when the stored date matches the date the
  // chip would set; under the old UTC read that match failed east of UTC on
  // reopen, so a saved Week revisit came back as Pick.
  it("a saved Week revisit reopens as Week, not Pick", () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    try {
      render(<DecisionCaptureSheet attachOptions={[]} initial={{ revisitOn: localPlus(7) }} onSave={() => {}} onCancel={() => {}} />);
      expect(screen.getByText("Week")).toHaveClass("active");
      expect(screen.queryByLabelText("Revisit date")).toBeNull();
    } finally {
      process.env.TZ = prevTz;
    }
  });
});
