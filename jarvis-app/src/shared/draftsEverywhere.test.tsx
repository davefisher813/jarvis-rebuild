// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import MealScreen from "../health/screens/MealScreen";
import CheckInScreen from "../health/screens/CheckInScreen";
import GoalSheet from "../life/GoalSheet";

// NO ENTRY IS EVER LOST (the Logging Standard, rule 8; the research standard, 2026-10-19). Goal sheets and the Health text entries had no draft store: a
// killed app or a back out of the screen lost what was typed. Each now keeps it as it is typed and spends it on the save that used it.
beforeEach(() => { localStorage.clear(); cleanup(); });

describe("a Meal, kept until it is logged", () => {
  it("reopens on what was typed and is gone once logged", () => {
    const first = render(<MealScreen today={[]} onLog={() => {}} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText("What you ate"), { target: { value: "Eggs and toast" } });
    first.unmount();
    const onLog = vi.fn();
    render(<MealScreen today={[]} onLog={onLog} onBack={() => {}} />);
    expect(screen.getByLabelText("What you ate")).toHaveValue("Eggs and toast");
    fireEvent.click(screen.getByRole("button", { name: "Log It" }));
    expect(onLog).toHaveBeenCalledWith("Eggs and toast");
    expect(localStorage.getItem("jarvis.meal.draft.v1")).toBeNull();
  });
});

describe("a Check In note, kept until it is saved", () => {
  it("reopens on what was typed and is gone once saved", () => {
    const first = render(<CheckInScreen today={[]} onLog={() => {}} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Slept badly" } });
    first.unmount();
    const onLog = vi.fn();
    render(<CheckInScreen today={[]} onLog={onLog} onBack={() => {}} />);
    expect(screen.getByLabelText("Note")).toHaveValue("Slept badly");
    fireEvent.click(screen.getByRole("button", { name: "Save Check In" }));
    expect(onLog).toHaveBeenCalledWith({ note: "Slept badly" });
    expect(localStorage.getItem("jarvis.checkin.note.draft.v1")).toBeNull();
  });
});

describe("a new Goal's title, kept until it is saved or cancelled", () => {
  const title = () => screen.getByLabelText("Goal title") as HTMLInputElement;
  it("reopens on the typed title; a tap outside keeps it; Cancel spends it; an edit never touches it", () => {
    const first = render(<GoalSheet mode="new" onSave={() => {}} onCancel={() => {}} />);
    fireEvent.change(title(), { target: { value: "Run a half marathon" } });
    first.unmount();

    const second = render(<GoalSheet mode="new" onSave={() => {}} onCancel={() => {}} />);
    expect(title().value).toBe("Run a half marathon");
    // The scrim keeps the draft (the same split the transaction sheet has).
    fireEvent.click(document.querySelector(".sheet-scrim") as HTMLElement);
    expect(localStorage.getItem("jarvis.goal.draft.v1")).toBe("Run a half marathon");
    second.unmount();

    render(<GoalSheet mode="new" onSave={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(localStorage.getItem("jarvis.goal.draft.v1")).toBeNull();
    cleanup();

    localStorage.setItem("jarvis.goal.draft.v1", "A stale draft");
    render(<GoalSheet mode="edit" initial={{ title: "Read More", state: "on_track" }} onSave={() => {}} onCancel={() => {}} />);
    expect(title().value).toBe("Read More");
    fireEvent.change(title(), { target: { value: "Read Much More" } });
    expect(localStorage.getItem("jarvis.goal.draft.v1")).toBe("A stale draft");
  });

  it("is spent by a save that landed, and kept by one that did not", async () => {
    const onSave = vi.fn(async () => false);
    render(<GoalSheet mode="new" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(title(), { target: { value: "Save for a trip" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await Promise.resolve(); await Promise.resolve();
    expect(onSave).toHaveBeenCalled();
    expect(localStorage.getItem("jarvis.goal.draft.v1"), "a write that did not land keeps the words").toBe("Save for a trip");
    cleanup();
    const ok = vi.fn(async () => true);
    render(<GoalSheet mode="new" onSave={ok} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await Promise.resolve(); await Promise.resolve();
    expect(localStorage.getItem("jarvis.goal.draft.v1")).toBeNull();
  });
});
