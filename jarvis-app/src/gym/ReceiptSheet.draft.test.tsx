// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReceiptSheet from "./ReceiptSheet";
import type { Receipt } from "./prs";
import { receiptDraftStore } from "./sessionDrafts";

vi.mock("../shared/MarkdownField", () => ({
  default: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

// NOTHING TYPED IS LOST (Logging Standard rule 8, 2026-10-17): the receipt's
// note is written on every keystroke and read back when the receipt opens
// again for the same session, so a kill between typing and Done loses no
// words. The save that spends it is the session's own clearLive
// (sessionDrafts.test.ts).
const receipt: Receipt = { minutes: 37, exercises: 7, volume: 12400, volumeUnit: "lb", otherSets: 0, prs: [], doneNames: [], goalHits: [] };

beforeEach(() => { localStorage.clear(); cleanup(); });

describe("ReceiptSheet: the note survives a kill", () => {
  it("writes per keystroke, restores on remount, and Done carries the restored words", () => {
    const store = receiptDraftStore(1000);
    const first = render(<ReceiptSheet dayName="Pull" receipt={receipt} workouts={[]} onDone={() => {}} noteDraft={store} />);
    fireEvent.change(screen.getByLabelText("Workout note"), { target: { value: "Left shoulder" } });
    expect(store.read()).toBe("Left shoulder");
    fireEvent.change(screen.getByLabelText("Workout note"), { target: { value: "Left shoulder pinched on rows" } });
    expect(store.read()).toBe("Left shoulder pinched on rows");
    first.unmount();
    const onDone = vi.fn();
    render(<ReceiptSheet dayName="Pull" receipt={receipt} workouts={[]} onDone={onDone} noteDraft={store} />);
    expect(screen.getByLabelText("Workout note")).toHaveValue("Left shoulder pinched on rows");
    fireEvent.click(screen.getByText("Done", { selector: "button" }));
    expect(onDone).toHaveBeenCalledWith("Left shoulder pinched on rows");
  });
  it("without a store the sheet opens empty, as before", () => {
    render(<ReceiptSheet dayName="Pull" receipt={receipt} workouts={[]} onDone={() => {}} />);
    expect(screen.getByLabelText("Workout note")).toHaveValue("");
  });
});
