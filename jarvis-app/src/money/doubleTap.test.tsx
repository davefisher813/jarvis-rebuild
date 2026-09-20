// @vitest-environment jsdom
//
// A SECOND TAP MUST NOT MAKE A SECOND ROW (Dave's live data, 2026-09-20).
//
// His account carries "Apple Bill" three times, created 03:35:43, :52 and
// :58 -- three taps about seven seconds apart, which is what a person does
// when a button looks like it did nothing. The other eleven subscriptions he
// typed that morning are single rows, so this is not how he works; it is what
// the screen did on the one that was slow.
//
// add() validated, awaited the write, and only cleared the fields once the
// write came back. Against a real Supabase on a phone that is long enough to
// tap again, and nothing said the first tap had landed: the button never
// disabled and never changed its word. The Import button three hundred lines
// up has carried `disabled={seeding}` since the day it shipped; this one had
// nothing.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTracker } from "../data/NotesProvider";
import type { TrackerService } from "./TrackerService";
import TrackerScreen from "./screens/TrackerScreen";

vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

beforeEach(() => { localStorage.clear(); });

describe("Tracker: adding a subscription twice", () => {
  it("makes one row, however many times the button is tapped", async () => {
    let svc: TrackerService | null = null;
    function Grab() { svc = useTracker(); return null; }
    render(
      <NotesProvider userId="u-double-tap">
        <Grab />
        <TrackerScreen onBack={() => {}} />
      </NotesProvider>,
    );
    await waitFor(() => expect(svc).toBeTruthy());

    fireEvent.click(await screen.findByRole("tab", { name: "Subscriptions" }, { timeout: 4000 }));
    fireEvent.change(await screen.findByLabelText("Subscription name"), { target: { value: "Apple Bill" } });
    fireEvent.change(screen.getByLabelText("Subscription amount"), { target: { value: "9.99" } });

    // Three taps in the same tick, the way an impatient thumb produces them.
    const add = screen.getByRole("button", { name: "Add" });
    await act(async () => {
      fireEvent.click(add);
      fireEvent.click(add);
      fireEvent.click(add);
    });

    await waitFor(async () => {
      const subs = (await svc!.load()).subs.filter((s) => s.data.merchantName === "Apple Bill");
      expect(subs).toHaveLength(1);
    });
  });
});
