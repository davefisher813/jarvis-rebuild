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
    fireEvent.change(await screen.findByLabelText("New subscription name"), { target: { value: "Apple Bill" } });
    fireEvent.change(screen.getByLabelText("New subscription amount"), { target: { value: "9.99" } });

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

// THE BUTTONS THAT WERE NOT THERE (Dave 2026-09-20: "just put the proper
// buttons in for users to manage stuff like this"). removeSub and
// saveAccount both shipped in the service and were wired to nothing, so a
// subscription could be cancelled but never corrected or removed, and an
// account could not be created at all -- the only ones that could ever exist
// were the four the September import writes.
describe("Tracker: managing what is already there", () => {
  it("a subscription can be corrected, and deleted with a way back", async () => {
    let svc: TrackerService | null = null;
    function Grab() { svc = useTracker(); return null; }
    render(
      <NotesProvider userId="u-manage-subs">
        <Grab />
        <TrackerScreen onBack={() => {}} />
      </NotesProvider>,
    );
    await waitFor(() => expect(svc).toBeTruthy());

    // Typed in through the screen, the way it really arrives -- the screen
    // reads once on mount, so a record written behind its back is not there.
    fireEvent.click(await screen.findByRole("tab", { name: "Subscriptions" }, { timeout: 4000 }));
    fireEvent.change(await screen.findByLabelText("New subscription name"), { target: { value: "Aple Bil" } });
    fireEvent.change(screen.getByLabelText("New subscription amount"), { target: { value: "9.99" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add" })); });

    // The row is a door now, so the typo is reachable.
    fireEvent.click(await screen.findByText("Aple Bil"));
    await screen.findByText("Edit Subscription");
    fireEvent.change(screen.getByLabelText("Subscription name"), { target: { value: "Apple Bill" } });
    fireEvent.change(screen.getByLabelText("Subscription amount"), { target: { value: "12.99" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(async () => {
      const subs = (await svc!.load()).subs;
      expect(subs).toHaveLength(1);
      expect(subs[0]!.data.merchantName).toBe("Apple Bill");
      expect(subs[0]!.data.amountCents).toBe(1299);
    });

    // And it can be removed outright, which nothing could do before.
    fireEvent.click(await screen.findByText("Apple Bill"));
    fireEvent.click(await screen.findByText("Delete Subscription"));
    await waitFor(async () => expect((await svc!.load()).subs).toHaveLength(0));
  });

  it("an account can be created, which was impossible without importing", async () => {
    let svc: TrackerService | null = null;
    function Grab() { svc = useTracker(); return null; }
    render(
      <NotesProvider userId="u-manage-accts">
        <Grab />
        <TrackerScreen onBack={() => {}} />
      </NotesProvider>,
    );
    await waitFor(() => expect(svc).toBeTruthy());

    fireEvent.click(await screen.findByText("Add an Account", {}, { timeout: 4000 }));
    await screen.findByText("New Account");
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Everyday Checking" } });
    fireEvent.change(screen.getByLabelText("Account balance"), { target: { value: "1240.50" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(async () => {
      const accts = (await svc!.load()).accounts;
      expect(accts).toHaveLength(1);
      expect(accts[0]!.data.name).toBe("Everyday Checking");
      expect(accts[0]!.data.currentBalanceCents).toBe(124050);
      expect(accts[0]!.data.type).toBe("checking");
    });
  });
});
