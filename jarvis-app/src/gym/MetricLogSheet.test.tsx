// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MetricLogSheet } from "./MetricsCard";
import type { MetricDef, MetricLog } from "./metrics";

// GYM-F-25 (2026-09-05): the scale state starts at 0 because there is no 0
// chip, and Save wrote it through unchecked, so tapping Soreness and Save
// without picking left the strip reading "0/5" and fed a zero on a 1-5 scale
// into insights and correlations.

const scaleDef: MetricDef = { id: "m1", data: { name: "Soreness", type: "scale5", createdOn: "2026-09-01" } };
const numDef: MetricDef = { id: "m2", data: { name: "Sleep", type: "minutes", unit: "min", createdOn: "2026-09-01" } };

describe("MetricLogSheet", () => {
  it("a 1-5 scale with nothing picked cannot be saved", () => {
    const onSave = vi.fn();
    render(<MetricLogSheet def={scaleDef} date="2026-09-05" onSave={onSave} onCancel={() => {}} />);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Pick a number to save.")).toBeInTheDocument();
  });

  it("picking a chip saves that number, and only that number", () => {
    const onSave = vi.fn();
    render(<MetricLogSheet def={scaleDef} date="2026-09-05" onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("3"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ value: 3 });
  });

  it("an existing log opens on its own number and saves straight away", () => {
    const initial: MetricLog = { id: "l1", data: { metricId: "m1", date: "2026-09-05", value: 4, at: 0 } };
    const onSave = vi.fn();
    render(<MetricLogSheet def={scaleDef} date="2026-09-05" initial={initial} onSave={onSave} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ value: 4 });
  });

  it("a numeric metric is untouched: zero minutes is a real answer there", () => {
    const onSave = vi.fn();
    render(<MetricLogSheet def={numDef} date="2026-09-05" onSave={onSave} onCancel={() => {}} />);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith({ value: 0 });
  });
});
