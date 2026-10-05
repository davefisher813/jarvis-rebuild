// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MetricLogSheet } from "./MetricsCard";
import type { MetricDef } from "./metrics";

// Dave's ask 2026-09-12: "when you enter your weight there's an option" --
// the goal entry point lives right here, on the sheet the daily tile opens.

const def: MetricDef = { id: "m1", data: { name: "Bodyweight", type: "number", unit: "lb", createdOn: "2026-09-01" } };

describe("MetricLogSheet's goal row", () => {
  it("says nothing about a goal when the caller offers none", () => {
    render(<MetricLogSheet def={def} date="2026-09-12" onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Set a Goal")).toBeNull();
  });

  it("offers Set a Goal when there is none yet", () => {
    render(<MetricLogSheet def={def} date="2026-09-12" onSetGoal={() => {}} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Set a Goal")).toBeInTheDocument();
  });

  it("shows the running state once a goal exists, not a bare Set a Goal", () => {
    render(<MetricLogSheet def={def} date="2026-09-12" goalLine="176 of 170 Lb" onSetGoal={() => {}} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("176 of 170 Lb · Edit Goal")).toBeInTheDocument();
    expect(screen.queryByText("Set a Goal")).toBeNull();
  });
});

// THE CATALOG, CHECKED ON WHAT THE SHEET DRAWS (Dave 2026-10-05). The sheet's day
// line printed the ISO string the log is keyed by ("2026-09-12") in a plain grey
// line; a day is said the way a person says it, in small caps (R8).
describe("MetricLogSheet: the day line follows the catalog (2026-10-05)", () => {
  it("shows the day as one small-caps date fact in plain words, never the ISO string", () => {
    render(<MetricLogSheet def={def} date="2026-09-12" onSave={() => {}} onCancel={() => {}} />);
    const fact = document.querySelector(".sheet-form > .facts > .fact.date")!;
    expect(fact.textContent).toBe("Sep 12");
    expect(document.body.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
