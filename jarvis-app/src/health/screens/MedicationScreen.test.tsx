// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MedicationScreen from "./MedicationScreen";
import type { MedDefEntry } from "../types";
import type { DoseRow } from "../meds";

// Health Push D, H-38 (2026-09-12): the medication page.
const NOW = new Date("2026-09-13T09:00:00").getTime();
const MEDS: MedDefEntry[] = [{ id: "m1", data: { category: "medication", name: "Vitamin D", amount: "2000 IU", order: 0, at: 1 } }];
const base = {
  title: "Health", now: NOW, lastWord: null, tracks: [], onTook: () => {}, onLogDose: () => {}, onUndo: () => {},
  onAddMed: () => {}, onEditMed: () => {}, onRemoveMed: () => {}, onOpenTrack: () => {}, onBack: () => {},
};

describe("MedicationScreen", () => {
  it("with no meds keeps the one-row Log a Dose, and Add a Medication saves a name and an amount", () => {
    const onAddMed = vi.fn();
    const onLogDose = vi.fn();
    render(<MedicationScreen {...base} meds={[]} doses={[]} onLogDose={onLogDose} onAddMed={onAddMed} />);
    fireEvent.click(screen.getByText("Log a Dose"));
    expect(onLogDose).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Add a Medication"));
    fireEvent.change(screen.getByLabelText("Medication name"), { target: { value: " Iron " } });
    fireEvent.change(screen.getByLabelText("Medication amount"), { target: { value: "65 mg" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onAddMed).toHaveBeenCalledWith("Iron", "65 mg");
  });

  it("with meds draws Took It rows, and the timeline names the med with Undo on today only, never on a pending row", () => {
    const onUndo = vi.fn();
    const doses: DoseRow[] = [
      { id: "d1", at: NOW - 3_600_000, medId: "m1", amount: "2000 IU", name: "Vitamin D" },
      { id: "pending-0", at: NOW - 60_000, medId: "m1", amount: "2000 IU", name: "Vitamin D", pending: true },
      { id: "d0", at: NOW - 2 * 86_400_000, medId: "m1", amount: "2000 IU", name: "Vitamin D" },
    ];
    render(<MedicationScreen {...base} meds={MEDS} doses={doses} onUndo={onUndo} />);
    expect(screen.queryByText("Log a Dose")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Took It, Vitamin D" })).toBeInTheDocument();
    expect(screen.getByText("The Timeline")).toBeInTheDocument();
    const undos = screen.getAllByRole("button", { name: /^Undo/ });
    expect(undos).toHaveLength(1);
    fireEvent.click(undos[0]!);
    expect(onUndo).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
  });

  it("the Keeping Track doors open by key", () => {
    const onOpenTrack = vi.fn();
    render(<MedicationScreen {...base} meds={[]} doses={[]} tracks={[{ key: "refillRunway", label: "Refill Runway", sub: "Doses left" }]} onOpenTrack={onOpenTrack} />);
    fireEvent.click(screen.getByText("Refill Runway"));
    expect(onOpenTrack).toHaveBeenCalledWith("refillRunway");
  });
});
