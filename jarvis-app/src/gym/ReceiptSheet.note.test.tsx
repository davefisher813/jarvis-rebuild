// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReceiptSheet from "./ReceiptSheet";
import type { Receipt } from "./prs";

// The session editor is a rich-text surface that jsdom cannot type into, so
// the note field is a plain textarea here: what is under test is where the
// typed string goes, not the editor.
vi.mock("../shared/MarkdownField", () => ({
  default: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

afterEach(() => cleanup());

// THE NOTE RIDES EVERY WAY OUT (2026-10-04). Done and the scrim carried what
// was typed, but Rate It and Something Hurts called onDone() with no argument:
// the workout was committed without the note and the typing was silently lost.
const receipt: Receipt = {
  minutes: 37, exercises: 7, volume: 12400, volumeUnit: "lb",
  otherSets: 0, prs: [], doneNames: [], goalHits: [],
};

function open() {
  const onDone = vi.fn();
  render(<ReceiptSheet dayName="Pull Day 1" receipt={receipt} workouts={[]} onDone={onDone} onRateSession={() => {}} onLogSoreSpot={() => {}} />);
  fireEvent.change(screen.getByLabelText("Session note"), { target: { value: "Left shoulder pinched on rows" } });
  return onDone;
}

describe("ReceiptSheet: the typed note survives every way out", () => {
  it("Done carries it (the control case)", () => {
    const onDone = open();
    fireEvent.click(screen.getByText("Done", { selector: "button" }));
    expect(onDone).toHaveBeenCalledWith("Left shoulder pinched on rows");
  });

  it("Rate It carries it", () => {
    const onDone = open();
    fireEvent.click(screen.getByText("Rate It, 1 to 10"));
    expect(onDone).toHaveBeenCalledWith("Left shoulder pinched on rows");
  });

  it("Something Hurts carries it", () => {
    const onDone = open();
    fireEvent.click(screen.getByText("Something Hurts"));
    expect(onDone).toHaveBeenCalledWith("Left shoulder pinched on rows");
  });
});

// THE CATALOG, CHECKED ON WHAT THE RECEIPT DRAWS (Dave 2026-10-05, "45 min v 45 Min"): the
// volume tile's unit and "Done N Times" are words behind a number and take a capital.
describe("ReceiptSheet: units and counts follow the number rule (2026-10-05)", () => {
  const done = (id: string) => ({ id, data: { programId: "p", dayId: "d", dayName: "Pull", date: "2026-09-01", startedAt: 1, endedAt: 2, exercises: [
    { exerciseId: "x", name: "Band Pull-Aparts", kind: "done", sets: [{ id: "s1", done: true }] },
  ] } }) as never;

  it("the volume tile reads 'Lb Moved' and an exercise done three times reads 'Done 3 Times'", () => {
    const { container } = render(
      <ReceiptSheet dayName="Pull Day 1" receipt={{ ...receipt, doneNames: ["Band Pull-Aparts"] }} workouts={[done("a"), done("b"), done("c")]} onDone={() => {}} onRateSession={() => {}} onLogSoreSpot={() => {}} />,
    );
    const labels = Array.from(document.querySelectorAll(".stat-label")).map((l) => l.textContent);
    expect(labels).toContain("Lb Moved");
    expect(Array.from(container.ownerDocument.querySelectorAll(".conn-meta")).map((m) => m.textContent)).toContain("Done 3 Times");
  });
});
