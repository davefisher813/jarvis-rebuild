// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MedicationScreen from "./screens/MedicationScreen";
import CheckInScreen from "./screens/CheckInScreen";
import MealScreen from "./screens/MealScreen";
import EatingWindowsScreen from "./screens/EatingWindowsScreen";
import ThirdPracticeScreen from "./screens/ThirdPracticeScreen";
import LockerScreen from "./screens/LockerScreen";
import { capsulesInCards, loneActionBoxes } from "../laws/catalogCheck";
import type { MedDefEntry } from "./types";
import type { DoseRow } from "./meds";

// CLEAN ROWS, NO PILLS (Dave 2026-10-05, locked; ROW-ACTIONS-SPEC sections 1 and 2). Alfred 2026-10-04 and the capsule
// measurement found Took It, Undo, Edit Time, Pack It, Protect a Gap and Remove as capsules on the Health screens' rows.
// Each is a swipe-left and an answer on the row's sheet now. Every screen is rendered through the real component and the
// two DOM checks the laws own are run on what it draws.
const NOW = new Date("2026-09-13T09:00:00").getTime();
const MEDS: MedDefEntry[] = [{ id: "m1", data: { category: "medication", name: "Vitamin D", amount: "2000 IU", order: 0, at: 1 } }];
const DOSES: DoseRow[] = [{ id: "d1", at: NOW - 3_600_000, medId: "m1", amount: "2000 IU", name: "Vitamin D" }];
const clean = (root: ParentNode = document.body) => { expect(capsulesInCards(root)).toEqual([]); expect(loneActionBoxes(root)).toEqual([]); };

describe("the Health screens hold no capsule in a row or a card", () => {
  it("Medication: Took It and Undo are swipes, Took It is also the sheet's primary", () => {
    const onUndo = vi.fn();
    render(<MedicationScreen title="Health" now={NOW} lastWord={null} tracks={[]} meds={MEDS} doses={DOSES} onTook={() => {}} onLogDose={() => {}} onUndo={onUndo}
      onAddMed={() => {}} onEditMed={() => {}} onRemoveMed={() => {}} onOpenTrack={() => {}} onBack={() => {}} />);
    clean();
    expect([...document.querySelectorAll(".notice-alt")].map((b) => b.textContent)).toEqual(["Took It", "Undo"]);
    fireEvent.click(document.querySelector(".shell-rows .row")!);
    expect(document.querySelector(".sheet-scrim .btn-primary")!.textContent).toBe("Took It");
  });

  it("Check In and Meal: Undo is the swipe and the sheet's answer, never a capsule", () => {
    const entry = { id: "c1", data: { category: "energy", at: NOW - 3_600_000, energy: "steady", note: "ok" } } as never;
    const { unmount } = render(<CheckInScreen today={[entry]} onLog={() => {}} onUndo={() => {}} onBack={() => {}} />);
    clean();
    expect(document.querySelector(".notice-alt")!.textContent).toBe("Undo");
    unmount();
    render(<MealScreen today={[{ id: "a", data: { category: "fuel", at: NOW - 3_600_000, text: "Oats" } }]} onLog={() => {}} onUndo={() => {}} onBack={() => {}} />);
    clean();
    expect(document.querySelector(".notice-alt")!.textContent).toBe("Undo");
  });

  it("Eating Windows and The Third Practice: the offer is the row, and its swipe-left is the offer", () => {
    const { unmount } = render(<EatingWindowsScreen offers={[{ line: "Tomorrow 12 PM", gap: { minutes: 25 } } as never]} onTakeOffer={() => {}} onBack={() => {}} />);
    clean();
    expect(document.querySelector(".notice-alt")!.textContent).toBe("Pack It");
    unmount();
    render(<ThirdPracticeScreen offers={[{ fact: { date: "2026-09-15", orgs: ["Elite", "Club"] } } as never]} onProtectGap={() => {}} onBack={() => {}} />);
    clean();
    expect(document.querySelector(".notice-alt")!.textContent).toBe("Protect a Gap");
  });

  it("The Locker: Remove is the swipe-left and the sheet's answer beside Change the Date", () => {
    const onRemove = vi.fn();
    render(<LockerScreen today="2026-09-13" docs={[{ id: "l1", data: { kind: "insurance", expiresAt: "2027-01-10", at: 1 } } as never]} onAdd={() => {}} onRemove={onRemove} onBack={() => {}} />);
    clean();
    expect(document.querySelector(".notice-alt")!.textContent).toBe("Remove");
    fireEvent.click(document.querySelector(".card .row[role=button]")!);
    const sheet = document.querySelector(".sheet-scrim")!;
    expect(sheet.querySelector(".btn-primary")!.textContent).toBe("Change the Date");
    fireEvent.click(sheet.querySelector(".btn-danger-text")!);
    expect(onRemove).toHaveBeenCalledWith("l1");
  });
});
