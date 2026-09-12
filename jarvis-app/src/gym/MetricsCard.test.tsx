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
    render(<MetricLogSheet def={def} date="2026-09-12" goalLine="176 of 170 lb" onSetGoal={() => {}} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("176 of 170 lb · Edit Goal")).toBeInTheDocument();
    expect(screen.queryByText("Set a Goal")).toBeNull();
  });
});
