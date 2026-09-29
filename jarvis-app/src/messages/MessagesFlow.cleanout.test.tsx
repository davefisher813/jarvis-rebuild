// @vitest-environment jsdom
//
// CLEAN OUT SPEAKS FOR THE ACCOUNT (2026-09-29). It used to stop after six
// pages (about 180 threads) and talk as if that were the inbox. These run the
// real screen over a counting fake Gmail: it walks past 180, it says it is
// still checking until the cursor has run out, it never pre-picks mail nobody
// has judged, and one Delete moves the whole pile in the fewest requests.
import "../shared/tiptapTest";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { AIService } from "../ai/AIService";
import MessagesFlow from "./MessagesFlow";
import ToastHost from "../shared/ToastHost";
import { FakeMailbox } from "./fakeMailbox";
import { resetInboxRefreshState } from "./inboxRefresh";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
const noAI = new AIService({ available: false });

beforeEach(() => { localStorage.clear(); resetInboxRefreshState(); });

function mount(box: FakeMailbox) {
  const api = box.api();
  return render(
    <NotesProvider userId="u-clean">
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>
        <ToastHost />
        <MessagesFlow ai={noAI} configured />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
}

function box(n: number, sender = "Foot Locker <news@footlocker.com>") {
  const b = new FakeMailbox("me@example.com");
  for (let i = 1; i <= n; i++) b.add("fl" + i, { from: sender, subject: "Sale " + i });
  return b;
}

async function openCleanOut() {
  await act(async () => { fireEvent.click(await screen.findByText("Connect Google")); });
  const row = await screen.findByText("Clean Out", {}, { timeout: 5000 });
  await act(async () => { fireEvent.click(row); });
}

describe("Clean Out over a big inbox", () => {
  it("reads past 180 to the end of the cursor before it lists anyone", async () => {
    const b = box(460);
    b.listPageSize = 100;
    mount(b);
    await openCleanOut();
    // The whole inbox, not the first six pages of it.
    await waitFor(() => expect(screen.getByText("460")).toBeInTheDocument(), { timeout: 15000 });
    expect(screen.getByText("Foot Locker")).toBeInTheDocument();
    expect(screen.queryByText("Checking Your Inbox")).toBeNull();
    expect(b.counters.bodies).toBe(0);
  }, 30000);

  it("mail nobody has judged is never pre-picked, and says so", async () => {
    const b = box(40);
    mount(b);
    await openCleanOut();
    await screen.findByText("Foot Locker", {}, { timeout: 8000 });
    // Unanalysed is unknown, and unknown is not safe.
    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick Some Senders" })).toBeDisabled();
    expect(screen.queryByText("Some of these needed you")).toBeNull();
  }, 20000);

  it("one Delete moves the whole pile in one request, asks once because it is unjudged, and Undo puts it back", async () => {
    const b = box(250);
    mount(b);
    await openCleanOut();
    await screen.findByText("250", {}, { timeout: 15000 });
    await act(async () => { fireEvent.click(screen.getByText("Foot Locker")); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Delete 250" })); });
    // ONE question for the whole batch, with the count.
    expect(await screen.findByText("Move 250 conversations to Trash? 250 may need you.")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Move to Trash" })); });
    await waitFor(() => expect(b.batchCalls.length).toBeGreaterThan(0), { timeout: 10000 });
    // 250 single-message conversations: one request, never a request each.
    expect(b.batchCalls).toHaveLength(1);
    expect(b.batchCalls[0]!.ids).toHaveLength(250);
    expect(b.batchCalls[0]!.add).toEqual(["TRASH"]);
    expect(b.batchCalls[0]!.remove).toEqual(["INBOX"]);
    expect(await screen.findByText(/250 conversations moved to Trash\. Gmail keeps them for 30 days\./)).toBeInTheDocument();
    // ...and it really moved in the mailbox.
    for (const id of ["fl1", "fl125", "fl250"]) expect(b.labelsOf(b.messageIdsOf(id)[0]!)).toContain("TRASH");

    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Undo" })); });
    await waitFor(() => expect(b.batchCalls).toHaveLength(2), { timeout: 10000 });
    expect(b.batchCalls[1]!.add).toEqual(["INBOX"]);
    expect(b.batchCalls[1]!.remove).toEqual(["TRASH"]);
    for (const id of ["fl1", "fl125", "fl250"]) {
      const labels = b.labelsOf(b.messageIdsOf(id)[0]!);
      expect(labels).toContain("INBOX");
      expect(labels).not.toContain("TRASH");
    }
  }, 40000);
});

describe("a scan that stops early", () => {
  it("says it is still checking, shows no sender list, and Resume finishes it", async () => {
    const b = box(230);
    b.listPageSize = 100;
    const api = b.api();
    let calls = 0;
    let broken = true;
    const flaky = {
      ...api,
      listInboxThreadRefs: async (max: number, tok?: string) => {
        calls++;
        // The window read and the first scan page succeed; the second scan page fails.
        if (broken && calls === 3) throw new Error("threads 500");
        return api.listInboxThreadRefs(max, tok);
      },
    };
    render(
      <NotesProvider userId="u-clean2">
        <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => flaky}>
          <ToastHost />
          <MessagesFlow ai={noAI} configured />
        </GoogleSessionProvider>
      </NotesProvider>,
    );
    await openCleanOut();
    // Partial: it says so, offers Resume, and does NOT show a sender inventory.
    expect(await screen.findByText("Checking Your Inbox", {}, { timeout: 15000 })).toBeInTheDocument();
    const resume = await screen.findByRole("button", { name: "Resume" });
    expect(screen.queryByText("Foot Locker")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
    broken = false;
    await act(async () => { fireEvent.click(resume); });
    await waitFor(() => expect(screen.getByText("Foot Locker")).toBeInTheDocument(), { timeout: 15000 });
    expect(screen.getByText("230")).toBeInTheDocument();
    expect(screen.queryByText("Checking Your Inbox")).toBeNull();
  }, 40000);
});
