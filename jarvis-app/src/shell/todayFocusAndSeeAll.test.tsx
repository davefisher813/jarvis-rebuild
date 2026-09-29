// @vitest-environment jsdom
//
// TODAY AFTER A FOCUS VISIT (audit 2026-09-29). Two findings, one cause, run
// through the real shell and the real Today:
//
//   - the Focus panel opened itself again every time he came back to Today
//     after dismissing it (shell clear() keeps the nonce, Today keyed on it);
//   - the first tap on Today's See All then landed on that full-screen panel
//     instead of the button under it, so "the first tap does nothing".
//
// The tap on See All is exercised here as well, so the door itself (Still Open
// -> Life on the first click, with no panel in front of it) stays pinned.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks } from "../data/NotesProvider";
import { AppearanceProvider } from "../appearance/AppearanceProvider";
import { AuthProvider } from "../auth/AuthProvider";
import { todayISO } from "../tasks/grouping";
import AppShell from "./AppShell";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
(Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};

afterEach(() => { vi.useRealTimers(); });

const tab = (label: string) => screen.getByText(label, { selector: ".tab" });
const focusUp = () => screen.queryByText("Not This One") !== null;

describe("Today after a Focus visit", () => {
  it("Focus stays closed once dismissed, and the first tap on See All goes to Life", async () => {
    // Evening, so Today shows the Still Open list and its See All.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(new Date().setHours(21, 0, 0, 0)));

    let tasks: ReturnType<typeof useTasks> | null = null;
    function Grab() { tasks = useTasks(); return null; }
    const tree = (shell: boolean) => (
      <AppearanceProvider><AuthProvider><NotesProvider userId="u-today-focus-seeall"><Grab />{shell && <AppShell />}</NotesProvider></AuthProvider></AppearanceProvider>
    );
    const view = render(tree(false));
    await waitFor(() => expect(tasks).toBeTruthy());
    await act(async () => {
      await tasks!.createTask("Alpha", { due: todayISO() });
      await tasks!.createTask("Beta", { due: todayISO() });
    });
    view.rerender(tree(true));
    await screen.findByText("Alpha", undefined, { timeout: 8000 });

    // Ask for Focus with the bolt, then dismiss it.
    fireEvent.click(screen.getByLabelText("What should I do now"));
    await waitFor(() => expect(focusUp()).toBe(true), { timeout: 8000 });
    fireEvent.click(screen.getByText("Close"));
    await waitFor(() => expect(focusUp()).toBe(false));

    // Away and back: Today is remounted, and nothing asked for Focus.
    fireEvent.click(tab("Life"));
    await screen.findByText("Areas", undefined, { timeout: 8000 });
    fireEvent.click(tab("Today"));
    await screen.findByText("Alpha", undefined, { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(focusUp(), "a dismissed Focus must not reopen on its own").toBe(false);

    // The first tap on See All (Still Open) is the door to Life.
    const seeAll = screen.getAllByText("See All").pop()!;
    expect(seeAll.closest(".sh2")).toHaveTextContent("Still Open");
    fireEvent.click(seeAll);
    await waitFor(() => expect(tab("Life")).toHaveClass("active"), { timeout: 8000 });
  }, 40_000);
});
