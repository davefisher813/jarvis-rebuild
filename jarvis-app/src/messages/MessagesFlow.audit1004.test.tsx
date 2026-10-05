// @vitest-environment jsdom
//
// DEAD-BUTTON AUDIT, MESSAGES (2026-10-04).
//
// Two controls on the Email tab did something other than what they said:
//   - Unsubscribe from a thread was a hand-rolled copy of the shared ask. Its
//     window.open carried "noopener", which makes window.open return null in
//     every browser, so a page that opened read as a blocked tab; and it never
//     wrote the record, so the sender was not under Asked to Stop and was
//     offered to the sweep again.
//   - Select All Shown and Archive N counted Needs You rows while the outcome
//     switch was on Waiting On or Nothing Owed, so they archived mail nobody
//     could see.
import "../shared/tiptapTest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { AIService } from "../ai/AIService";
import type { GmailMeta, GmailThreadMeta } from "../connections/google/map";
import MessagesFlow from "./MessagesFlow";
import ToastHost from "../shared/ToastHost";
import { loadUnsubs } from "./unsubRecords";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const noAI = new AIService({ available: false });
const triage = (text: string) => new AIService({
  available: true,
  getToken: () => "tok",
  fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ text }), text: async () => "" })) as unknown as typeof fetch,
});

const msg = (id: string, from: string, subject: string, snippet: string, labels: string[], dateMs: number): GmailMeta => ({
  id, snippet, labelIds: labels, internalDate: String(dateMs),
  payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] },
});

function mount(api: ReturnType<typeof makeFakeGoogleApi>, ai: AIService = noAI) {
  return render(
    <NotesProvider userId="u-audit1004">
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>
        <ToastHost />
        <MessagesFlow ai={ai} configured />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

// ---- #37: Unsubscribe from a thread -----------------------------------------

const NEWS: GmailThreadMeta = { id: "u1", messages: [msg("um1", "Trail Weekly <news@trailweekly.com>", "This Week on the Trail", "Ten routes", ["INBOX"], 500)] };
const newsFull = (listUnsubscribe: string) => ({
  id: "u1",
  messages: [{
    id: "um1", threadId: "u1", snippet: "",
    payload: {
      mimeType: "text/plain", body: { data: btoa("Ten routes for the weekend") },
      headers: [
        { name: "From", value: "Trail Weekly <news@trailweekly.com>" }, { name: "Subject", value: "This Week on the Trail" },
        { name: "Date", value: "Mon" }, { name: "Message-ID", value: "<u@x>" }, { name: "List-Unsubscribe", value: listUnsubscribe },
      ],
    },
  }],
});

async function openNewsThread(api: ReturnType<typeof makeFakeGoogleApi>) {
  mount(api);
  fireEvent.click(await screen.findByText("Connect Google"));
  fireEvent.click(await screen.findByText("Trail Weekly"));
  return await screen.findByRole("button", { name: "Unsubscribe from Trail Weekly" });
}

// What a browser does: any "noopener" feature string makes window.open return
// null, whether or not the page opened (openExternal.ts says the same).
const browserOpen = (opened: string[]) => vi.spyOn(window, "open").mockImplementation(((url?: string | URL, _t?: string, features?: string) => {
  opened.push(String(url));
  return features && /noopener/.test(features) ? null : ({} as Window);
}) as typeof window.open);

describe("Messages > thread > Unsubscribe from <sender>", () => {
  it("a web link that opened is not reported as a blocked tab, and the sender is recorded as OPENED", async () => {
    const opened: string[] = [];
    browserOpen(opened);
    const api = makeFakeGoogleApi({ listThreads: async () => [NEWS], getThread: async () => newsFull("<https://trailweekly.com/u/1>") as never });
    const btn = await openNewsThread(api);
    await act(async () => { fireEvent.click(btn); });

    expect(opened).toEqual(["https://trailweekly.com/u/1"]);
    expect(screen.queryByText(/Blocked That Tab/)).toBeNull();
    // A page opened is not an ask sent, so it is not claimed as one.
    expect(await screen.findByText("Opened Unsubscribe Page · Finish It There")).toBeInTheDocument();
    expect(loadUnsubs()).toEqual([expect.objectContaining({ sender: "news@trailweekly.com", via: "link", state: "opened" })]);
    // And the view went back to the list, as it does for every other finished action.
    expect(screen.queryByRole("button", { name: "Unsubscribe from Trail Weekly" })).toBeNull();
  });

  it("a tab the browser really blocked says so and records nothing", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const api = makeFakeGoogleApi({ listThreads: async () => [NEWS], getThread: async () => newsFull("<https://trailweekly.com/u/1>") as never });
    const btn = await openNewsThread(api);
    await act(async () => { fireEvent.click(btn); });

    expect(await screen.findByText("Your Browser Blocked That Tab · Nothing Was Asked")).toBeInTheDocument();
    expect(loadUnsubs()).toEqual([]);
    // Still on the thread: nothing was asked, so there is nothing to leave for.
    expect(screen.getByRole("button", { name: "Unsubscribe from Trail Weekly" })).toBeInTheDocument();
  });

  it("a mailto is sent and the sender is recorded as ASKED, so it shows under Asked to Stop", async () => {
    const sent: string[] = [];
    const api = makeFakeGoogleApi({
      listThreads: async () => [NEWS],
      getThread: async () => newsFull("<mailto:unsub@trailweekly.com?subject=stop>") as never,
      sendMessage: async (raw: string) => { sent.push(raw); return { id: "s1" }; },
    });
    const btn = await openNewsThread(api);
    await act(async () => { fireEvent.click(btn); });

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(await screen.findByText(/^Asked Trail Weekly to stop/i)).toBeInTheDocument();
    expect(loadUnsubs()).toEqual([expect.objectContaining({ sender: "news@trailweekly.com", via: "header", state: "asked" })]);
  });

  it("a mailto that failed to send says so and records nothing", async () => {
    const api = makeFakeGoogleApi({
      listThreads: async () => [NEWS],
      getThread: async () => newsFull("<mailto:unsub@trailweekly.com?subject=stop>") as never,
      sendMessage: async () => { throw new Error("500"); },
    });
    const btn = await openNewsThread(api);
    await act(async () => { fireEvent.click(btn); });

    expect(await screen.findByText("Couldn't Send It · Nothing Was Asked")).toBeInTheDocument();
    expect(loadUnsubs()).toEqual([]);
  });
});

// ---- #40: Select All Shown and the outcome switch ---------------------------

const DAY = 86400e3;
const INBOX: GmailThreadMeta[] = [
  { id: "n1", messages: [msg("a1", "Nadia Brandt <nadia@x.com>", "Invoice Due Friday", "Please pay", ["INBOX"], Date.now() - 1000)] },
  { id: "n2", messages: [msg("a2", "Old Navy <no@on.com>", "Final Hours", "Sale ends", ["INBOX"], Date.now() - 2000)] },
];
const SENT: GmailThreadMeta = { id: "w1", messages: [{
  id: "wm1", snippet: "The waiver", labelIds: ["SENT"], internalDate: String(Date.now() - 12 * DAY),
  payload: { headers: [
    { name: "From", value: "Me <me@example.com>" }, { name: "To", value: "Rob <rob@y.com>" },
    { name: "Subject", value: "The waiver" },
  ] },
}] };
const AI = () => triage(JSON.stringify([
  { id: "n1", bucket: "needs_you", gist: "Pay the invoice." },
  { id: "n2", bucket: "worth_knowing", gist: "A sale." },
]));

describe("Messages > Select > Select All Shown while Waiting On is showing", () => {
  async function selectWhileWaiting() {
    const archived: string[] = [];
    const api = makeFakeGoogleApi({
      listThreads: async () => INBOX,
      searchThreads: async () => [SENT],
      modifyThread: async (id: string, _add: string[], remove: string[]) => { if (remove.includes("INBOX")) archived.push(id); },
    });
    mount(api, AI());
    fireEvent.click(await screen.findByText("Connect Google"));
    // Both outcomes have rows once triage and Waiting On have settled.
    const waitingTab = await screen.findByRole("tab", { name: /Waiting On/ }, { timeout: 5000 });
    // The switch remembers the last outcome for the session (lastOutcome), so
    // every case says which one it starts on rather than inheriting the last.
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: /Needs You/ })); });
    return { archived, waitingTab };
  }

  it("counts, selects and archives only the rows on screen", async () => {
    const { archived, waitingTab } = await selectWhileWaiting();
    await act(async () => { fireEvent.click(waitingTab); });
    expect(screen.queryByText("Nadia Brandt")).toBeNull(); // Needs You is not drawn
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Select" })); });

    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Select All Shown" })); });
    // The Rest (Worth Knowing) is the only mail on screen to pick.
    expect(screen.getByText(/^1 selected$/i)).toBeInTheDocument();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Archive 1" })); });

    await waitFor(() => expect(archived).toHaveLength(1));
    expect(archived).toEqual(["n2"]);
  });

  it("a pick made while Needs You was showing does not follow the person to Waiting On", async () => {
    const { archived, waitingTab } = await selectWhileWaiting();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Select" })); });
    // On Needs You, both the Needs You row and the Worth Knowing row are on screen.
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Select All Shown" })); });
    expect(screen.getByText(/^2 selected$/i)).toBeInTheDocument();

    await act(async () => { fireEvent.click(waitingTab); });
    expect(screen.getByText(/^1 selected$/i)).toBeInTheDocument();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Archive 1" })); });

    await waitFor(() => expect(archived).toHaveLength(1));
    expect(archived).toEqual(["n2"]);
  });

  it("with Needs You showing, Select All Shown still takes the Needs You rows too", async () => {
    const { archived } = await selectWhileWaiting();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Select" })); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Select All Shown" })); });
    expect(screen.getByText(/^2 selected$/i)).toBeInTheDocument();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Archive 2" })); });
    await waitFor(() => expect(archived.slice().sort()).toEqual(["n1", "n2"]));
  });
});

// ---- Select All Shown and the Noise fold (2026-10-05) -----------------------

const NOISY: GmailThreadMeta[] = [
  { id: "n1", messages: [msg("a1", "Nadia Brandt <nadia@x.com>", "Invoice Due Friday", "Please pay", ["INBOX"], Date.now() - 1000)] },
  { id: "n2", messages: [msg("a2", "Old Navy <no@on.com>", "Final Hours", "Sale ends", ["INBOX"], Date.now() - 2000)] },
  { id: "n3", messages: [msg("a3", "Peloton <hi@peloton.com>", "New Ride", "Ride now", ["INBOX"], Date.now() - 3000)] },
];
const NOISY_AI = () => triage(JSON.stringify([
  { id: "n1", bucket: "needs_you", gist: "Pay the invoice." },
  { id: "n2", bucket: "noise", gist: "A sale." },
  { id: "n3", bucket: "noise", gist: "An ad." },
]));

describe("Messages > Select > Select All Shown and the Noise fold", () => {
  async function selectAll() {
    const archived: string[] = [];
    const api = makeFakeGoogleApi({
      listThreads: async () => NOISY,
      modifyThread: async (id: string, _add: string[], remove: string[]) => { if (remove.includes("INBOX")) archived.push(id); },
    });
    mount(api, NOISY_AI());
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("Nadia Brandt", undefined, { timeout: 5000 });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Select" })); });
    return { archived };
  }

  it("does not count or archive Noise rows behind the machines line", async () => {
    const { archived } = await selectAll();
    // The machines line is drawn; the two rows under it are not.
    expect(screen.queryByText("Old Navy")).toBeNull();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Select All Shown" })); });
    expect(screen.getByText(/^1 selected$/i)).toBeInTheDocument();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Archive 1" })); });
    await waitFor(() => expect(archived).toHaveLength(1));
    expect(archived).toEqual(["n1"]);
  });

  it("takes the Noise rows once the machines line is open and they are on screen", async () => {
    const { archived } = await selectAll();
    await act(async () => { fireEvent.click(screen.getByText(/2 machines wrote/i)); });
    expect(await screen.findByText("Old Navy")).toBeInTheDocument();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Select All Shown" })); });
    expect(screen.getByText(/^3 selected$/i)).toBeInTheDocument();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Archive 3" })); });
    await waitFor(() => expect(archived.slice().sort()).toEqual(["n1", "n2", "n3"]));
  });
});

describe("Messages > Select > Select All Shown and a collapsed sender group", () => {
  it("counts a sender group's rows only once the group is open", async () => {
    const t = Date.now();
    const rows: GmailThreadMeta[] = [
      { id: "n1", messages: [msg("a1", "Nadia Brandt <nadia@x.com>", "Invoice Due Friday", "Please pay", ["INBOX"], t - 1000)] },
      ...[2, 3, 4].map((n) => ({ id: "n" + n, messages: [msg("a" + n, "Old Navy <no@on.com>", "Sale " + n, "Ends", ["INBOX"], t - n * 1000)] })),
    ];
    const api = makeFakeGoogleApi({ listThreads: async () => rows });
    mount(api, triage(JSON.stringify([
      { id: "n1", bucket: "needs_you", gist: "Pay the invoice." },
      ...[2, 3, 4].map((n) => ({ id: "n" + n, bucket: "noise", gist: "A sale." })),
    ])));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("Nadia Brandt", undefined, { timeout: 5000 });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Select" })); });
    await act(async () => { fireEvent.click(await screen.findByText(/3 machines wrote/i)); });
    // The sender's one line is drawn; its three rows are folded under it.
    await screen.findByText("3 Notices");
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Select All Shown" })); });
    expect(screen.getByText(/^1 selected$/i)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText("3 Notices")); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Select All Shown" })); });
    expect(screen.getByText(/^4 selected$/i)).toBeInTheDocument();
  });
});

// ---- The sweep card follows the Unsubscribe record (2026-10-05) ------------

describe("Messages > sweep card > a sender just asked", () => {
  it("drops out of the card the moment the thread Unsubscribe records it", async () => {
    localStorage.setItem("jarvis.mail.tossed.v1", JSON.stringify({ "news@trailweekly.com": 3, "deals@shop.com": 3, "hi@third.com": 3 }));
    const opened: string[] = [];
    browserOpen(opened);
    const api = makeFakeGoogleApi({ listThreads: async () => [{ id: "u1", messages: [msg("um1", "Trail Weekly <news@trailweekly.com>", "This Week on the Trail", "Ten routes", ["INBOX"], Date.now() - 1000)] }], getThread: async () => newsFull("<https://trailweekly.com/u/1>") as never });
    mount(api, triage(JSON.stringify([{ id: "u1", bucket: "worth_knowing", gist: "A newsletter." }])));
    fireEvent.click(await screen.findByText("Connect Google"));
    // The card names the senders thrown away unopened, Trail Weekly among them.
    expect(await screen.findByText(/9 Thrown Away Without Opening from/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByText("The Rest"));
    await screen.findByText("Worth Knowing");
    // A tap that lands while triage is still settling can hit a row that is
    // about to be replaced, so tap again until the thread is the thing on screen.
    await waitFor(() => {
      if (!screen.queryByRole("button", { name: "Unsubscribe from Trail Weekly" })) fireEvent.click(screen.getByText("Trail Weekly"));
      expect(screen.getByRole("button", { name: "Unsubscribe from Trail Weekly" })).toBeInTheDocument();
    }, { timeout: 4000 });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Unsubscribe from Trail Weekly" })); });
    expect(opened).toEqual(["https://trailweekly.com/u/1"]);
    // Back on the list: the sender just asked is no longer offered.
    await waitFor(() => expect(screen.queryByText(/Thrown Away Without Opening from .*Trail Weekly/i)).toBeNull());
    expect(screen.queryByText(/Thrown Away Without Opening from .*news@trailweekly\.com/i)).toBeNull();
    expect(screen.getByText(/Thrown Away Without Opening from/i)).toBeInTheDocument();
  });
});
