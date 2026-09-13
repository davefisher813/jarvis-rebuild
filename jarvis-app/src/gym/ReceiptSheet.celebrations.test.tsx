// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReceiptSheet from "./ReceiptSheet";
import type { Receipt } from "./prs";

// H-35 (Health Push C, 2026-09-12), the master's law 8: with Celebrations
// off, no PR tile and no New Best renders. The numbers stay; the party goes.
afterEach(() => cleanup());

const receipt: Receipt = {
  minutes: 48, exercises: 3, volume: 6240, volumeUnit: "lb", otherSets: 0, doneNames: [],
  prs: [{ name: "Bench Press", text: "185 lb × 5", from: "180 lb × 5" }], goalHits: [],
} as unknown as Receipt;

describe("ReceiptSheet celebrations", () => {
  it("celebrates by default", () => {
    render(<ReceiptSheet dayName="Push Day" receipt={receipt} workouts={[]} onDone={() => {}} />);
    expect(screen.getByText("New Best")).toBeInTheDocument();
    expect(screen.getByText("PR", { selector: ".stat-label" })).toBeInTheDocument();
  });
  it("with celebrations off, the PR tile and New Best are gone and the minutes stay", () => {
    render(<ReceiptSheet dayName="Push Day" receipt={receipt} workouts={[]} onDone={() => {}} celebrations={false} />);
    expect(screen.queryByText("New Best")).toBeNull();
    expect(screen.queryByText("PR", { selector: ".stat-label" })).toBeNull();
    expect(screen.getByText("48")).toBeInTheDocument();
  });
});
