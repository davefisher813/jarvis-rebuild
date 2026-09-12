// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NotesProvider, useProfile, useNotes } from "../data/NotesProvider";
import { GOOGLE_SCOPES } from "../connections/google/config";
import type { GoogleApi } from "../connections/google/api";
import type { ProfileService } from "../profile/ProfileService";
import type { NotesService } from "../notes/NotesService";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { AIService } from "../ai/AIService";
import type { GmailMeta, GmailThreadMeta } from "../connections/google/map";
import MessagesFlow from "./MessagesFlow";
import MailOutboxPump from "./MailOutboxPump";
import ToastHost from "../shared/ToastHost";
import { saveMailSnapshot, loadMailSnapshot } from "./home";
import { loadOutbox, resetOutboxForTest } from "./outbox";
import { loadLetGo } from "./letGo";
import { loadVips, toggleVip } from "./vip";
import { loadMinutes } from "./drain";
import { clearedToday } from "./cleared";
import { loadClosedBatch } from "./weeklyClose";
import { todayISO } from "../schedule/calendar";
import { recordToss } from "./selfClean";

const noAI = new AIService({ available: false });

const aiReturning = (text: string) => new AIService({
  available: true,
  getToken: () => "tok",
  fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ text }), text: async () => "" })) as unknown as typeof fetch,
});


const msg = (id: string, from: string, subject: string, snippet: string, labels: string[], dateMs: number): GmailMeta => ({
  id, snippet, labelIds: labels, internalDate: String(dateMs),
  payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] },
});

const THREADS: GmailThreadMeta[] = [
  { id: "t1", messages: [
    msg("m1", "Ridgeley <t@x.com>", "Waiver", "Need the waiver by Friday", ["INBOX"], 100),
    msg("m2", "Ridgeley <t@x.com>", "Re: Waiver", "Haven't seen it yet", ["INBOX", "UNREAD"], 300),
  ] },
  { id: "t2", messages: [msg("m3", "DoorDash <no@dd.com>", "20% off", "Order now", ["INBOX"], 200)] },
];

const fullThread = {
  id: "t1",
  messages: [
    { id: "m1", threadId: "t1", snippet: "", payload: { mimeType: "text/plain", body: { data: btoa("Need the waiver by Friday") },
      headers: [{ name: "From", value: "Ridgeley <t@x.com>" }, { name: "Subject", value: "Waiver" }, { name: "Date", value: "Mon" }, { name: "Message-ID", value: "<a@x>" }] } },
    { id: "m2", threadId: "t1", snippet: "", payload: { mimeType: "text/plain", body: { data: btoa("Haven't seen it yet") },
      headers: [{ name: "From", value: "Ridgeley <t@x.com>" }, { name: "Subject", value: "Re: Waiver" }, { name: "Date", value: "Thu" }, { name: "Message-ID", value: "<b@x>" }] } },
  ],
};

function makeApi(o: Parameters<typeof makeFakeGoogleApi>[0] = {}) {
  return makeFakeGoogleApi({
    listThreads: async () => THREADS,
    getThread: async () => fullThread,
    ...o,
  });
}

// EMAIL-F-01 (2026-09-05): the send pump lives in AppShell now, not in
// MessagesFlow, so the wrapper mounts it the way AppShell does (beside the
// tab, inside the same GoogleSessionProvider), plus the app's ToastHost,
// because "Sent" is the app-wide toast now rather than a line the tab owns.
function wrap(node: React.ReactNode, api = makeApi()) {
  return (
    <NotesProvider userId="u1">
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>
        <MailOutboxPump ai={noAI} />
        <ToastHost />
        {node}
      </GoogleSessionProvider>
    </NotesProvider>
  );
}

// S2-5: a way to reach into the same NotesProvider tree's ProfileService, so
// a test can assert what actually landed in the (mocked) synced profile
// after a UI action, not just what changed in localStorage.
function ProfileGrabber({ onReady }: { onReady: (p: ProfileService) => void }) {
  const p = useProfile();
  useEffect(() => onReady(p), [p, onReady]);
  return null;
}
function wrapWithProfile(node: React.ReactNode, onProfile: (p: ProfileService) => void, api = makeApi()) {
  return (
    <NotesProvider userId="u1">
      <ProfileGrabber onReady={onProfile} />
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>{node}</GoogleSessionProvider>
    </NotesProvider>
  );
}

// S2-8: same trick as ProfileGrabber, for the real NotesService living in
// the same NotesProvider tree -- lets a test seed a note MessagesFlow's own
// "what he has" list will then pick up.
function NotesGrabber({ onReady }: { onReady: (n: NotesService) => void }) {
  const n = useNotes();
  useEffect(() => onReady(n), [n, onReady]);
  return null;
}
function wrapWithNotes(node: React.ReactNode, onNotes: (n: NotesService) => void, api = makeApi()) {
  return (
    <NotesProvider userId="u1">
      <NotesGrabber onReady={onNotes} />
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>{node}</GoogleSessionProvider>
    </NotesProvider>
  );
}

// EMAIL-F-13 (2026-09-05): the first harness in this file with TWO accounts
// connected. Every other test here runs one, which is exactly why the
// multi-account misses went unnoticed. The seed must land before the session
// provider mounts (the provider reads the profile once), and the injected
// broker's silent path mints a token for each seeded account, so both apis
// are live without any UI.
function TwoAccounts({ apiOf, children }: { apiOf: (email: string) => GoogleApi; children: React.ReactNode }) {
  const profile = useProfile();
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    const seed: { email: string; mail: boolean; cal: boolean; scopes?: string }[] = [
      { email: "a@x.com", mail: true, cal: true, scopes: GOOGLE_SCOPES },
      { email: "b@x.com", mail: true, cal: true, scopes: GOOGLE_SCOPES },
    ];
    void profile.save({ googleAccounts: seed }).then(() => setSeeded(true));
  }, [profile]);
  if (!seeded) return null;
  return (
    <GoogleSessionProvider
      broker={{ authorize: async () => ({ token: "t-a@x.com", email: "a@x.com" }), silent: async (email) => "t-" + email }}
      makeApi={(_token, email) => apiOf(email ?? "a@x.com")}
    >
      {children}
    </GoogleSessionProvider>
  );
}

beforeEach(() => { localStorage.clear(); resetOutboxForTest(); });

describe("MessagesFlow (threads)", () => {
  it("connects and lists threads: latest sender's voice, first message's subject, count", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    expect(await screen.findByText("Ridgeley")).toBeInTheDocument();
    expect(screen.getByText(/Waiver · 2/)).toBeInTheDocument(); // subject without Re:, with count
    expect(screen.getByText("DoorDash")).toBeInTheDocument();
  });

  it("without AI there is no fake triage: no headline, no buckets, threads newest-first", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("Ridgeley");
    expect(screen.queryByText(/needs? you/i)).toBeNull();
    expect(screen.queryByText("Noise")).toBeNull();
    const names = screen.getAllByText(/^(Ridgeley|DoorDash)$/).map((n) => n.textContent);
    expect(names).toEqual(["Ridgeley", "DoorDash"]); // t1 latest msg 300 > t2 200
  });

  it("with AI, one triage pass buckets the inbox with gists and the honest headline", async () => {
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "needs_you", gist: "Ridgeley needs the waiver by Friday." },
      { id: "t2", bucket: "noise", gist: "DoorDash promo." },
    ]));
    render(wrap(<MessagesFlow ai={ai} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    // THE OUTCOME SWITCH (ruled 2026-09-01, built 2026-09-02): Needs You is
    // a segment now, with its count on the label, and the only one that
    // renders when nothing is waiting. The rows ride in one card.
    const tab = await screen.findByRole("tab", { name: /Needs You/ });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(tab.querySelector(".seg-n")).toHaveTextContent("1");
    expect(screen.queryByRole("tab", { name: /Waiting On/ })).toBeNull();
    expect(document.querySelector(".list-card-ruled .row")).toBeTruthy();
    // SPEC MOVED (E14, 2026-08-23): the promo card that carried the count and
    // the verb is retired. "1 Thread Needs You" said in three lines what the
    // switch says in one.
    expect(screen.queryByText("1 Thread Needs You")).toBeNull();
    // E-02 (2026-09-12): the Sweep is the head's own capsule now, not a card.
    expect(screen.getByText(/^Sweep \u00b7 About/)).toBeInTheDocument();
    expect(screen.getByText(/Ridgeley needs the waiver by Friday/)).toBeInTheDocument();
    // THE FOLD: everything that does not need him is one line, not a section.
    // SPEC MOVED (V2 anatomy, 2026-08-15): the count is a pill beside the line.
    expect(screen.getByText("The Rest")).toBeInTheDocument();
    expect(screen.queryByText("Noise")).toBeNull();
    expect(screen.queryByText(/machine wrote/i)).toBeNull();
    // It expands in place, and noise inside it is still collapsed to a line.
    fireEvent.click(screen.getByText("The Rest"));
    expect(screen.getByText("Noise")).toBeInTheDocument();
    // SPEC MOVED (8A castes, 2026-08-25): the machines' row used to be a
    // full row reading "1 Automated email", which is the sensory flatness
    // the Anti-Inbox catalog is against: a promo wearing a person's weight.
    // It is now one grey line that counts SENDERS as machines and carries
    // the single action that ends the lot.
    expect(screen.getByText(/1 Machine wrote/)).toBeInTheDocument();
    expect(screen.getByText("Sweep")).toBeInTheDocument();
    expect(screen.queryByText(/DoorDash promo/)).toBeNull();
  });


  // E10 (2026-08-24): bulk select lives on the fold and nowhere else.
  it("select mode clears a picked pile in one move, scoped to the fold", async () => {
    const archived: string[] = [];
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "needs_you", gist: "Ridgeley needs the waiver by Friday." },
      { id: "t2", bucket: "worth_knowing", gist: "DoorDash receipt." },
    ]));
    const api = makeApi({ modifyThread: async (id, _a, remove) => { if (remove.includes("INBOX")) archived.push(id); } });
    render(wrap(<MessagesFlow ai={ai} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("The Rest"));

    // In: a quiet Select, no checkboxes yet.
    expect(screen.queryByLabelText("Not picked")).toBeNull();
    fireEvent.click(await screen.findByText("Select"));

    // The fold row toggles instead of opening; Needs You rows grow nothing.
    fireEvent.click(screen.getByText(/DoorDash receipt/));
    expect(screen.getByLabelText("Picked")).toBeInTheDocument();
    expect(screen.getByText("Archive 1")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Archive 1"));
    await waitFor(() => expect(archived).toEqual(["t2"]));
    expect(screen.queryByText(/DoorDash receipt/)).toBeNull();
    // Needs You untouched, select mode over.
    expect(screen.getByText(/Ridgeley needs the waiver/)).toBeInTheDocument();
    expect(screen.queryByText("Done")).toBeNull();
  });

  // E11 (2026-08-24): the gist is the headline, the sender is the eyebrow.
  it("gist leads the row and the sender demotes to the eyebrow", async () => {
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "needs_you", gist: "Ridgeley needs the waiver by Friday." },
      { id: "t2", bucket: "noise", gist: "promo" },
    ]));
    const { container } = render(wrap(<MessagesFlow ai={ai} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByRole("tab", { name: /Needs You/ });
    // EM2 (2026-09-12): the sender leads line one, the gist is line two.
    const lead = container.querySelector(".mline2")!;
    expect(lead).toHaveTextContent("Ridgeley needs the waiver by Friday.");
    const from = container.querySelector(".mfrom")!;
    expect(from).toHaveTextContent("Ridgeley");
  });

  it("Archive All clears noise threads and says what it did", async () => {
    const archived: string[] = [];
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "needs_you", gist: "g" },
      { id: "t2", bucket: "noise", gist: "promo" },
    ]));
    const api = makeApi({ modifyThread: async (id, _a, remove) => { if (remove.includes("INBOX")) archived.push(id); } });
    render(wrap(<MessagesFlow ai={ai} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    // SPEC MOVED (V2 anatomy, 2026-08-15): fold count now rides as a pill.
    fireEvent.click(await screen.findByText("The Rest"));
    // SPEC MOVED (8A castes, 2026-08-25): the fold's bulk noise action is
    // "Sweep" and rides on the machines line. "Archive All" survives, but
    // only on a collapsed single-sender group inside the unfolded noise.
    fireEvent.click(await screen.findByText("Sweep"));
    await waitFor(() => expect(archived).toEqual(["t2"]));
    expect(screen.getByText("1 Conversation archived")).toBeInTheDocument();
    expect(screen.queryByText("Noise")).toBeNull();
    expect(screen.getByText(/Ridgeley/)).toBeInTheDocument(); // needs_you untouched
  });

  it("opens a thread: every message shown, thread marked read", async () => {
    let readCleared: string | null = null;
    const api = makeApi({ modifyThread: async (id, _a, remove) => { if (remove.includes("UNREAD")) readCleared = id; } });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Ridgeley"));
    expect(await screen.findByText("Need the waiver by Friday")).toBeInTheDocument();
    expect(screen.getByText("Haven't seen it yet")).toBeInTheDocument();
    expect(screen.getByText("2 messages")).toBeInTheDocument();
    await waitFor(() => expect(readCleared).toBe("t1"));
  });

  it("reply targets the LAST message in the thread", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Ridgeley"));
    fireEvent.click(await screen.findByText("Reply"));
    expect(((await screen.findByPlaceholderText("To")) as HTMLInputElement).value).toBe("t@x.com");
    expect((screen.getByPlaceholderText("Subject") as HTMLInputElement).value).toBe("Re: Waiver"); // already Re:, not stacked
  });

  it("search hits the server over the whole mailbox, not the loaded list", async () => {
    let q: string | null = null;
    const api = makeApi({
      searchThreads: async (query) => {
        q = query;
        return [{ id: "t9", messages: [msg("m9", "Sarah <s@x.com>", "LLC docs", "Operating agreement", [], 50)] }];
      },
    });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("Ridgeley");
    fireEvent.change(screen.getByPlaceholderText("Search All Mail"), { target: { value: "llc" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Search All Mail"), { key: "Enter" });
    expect(await screen.findByText("Sarah")).toBeInTheDocument();
    expect(q).toBe("llc");
    expect(screen.queryByText("Ridgeley")).toBeNull(); // results replace the list
    fireEvent.change(screen.getByPlaceholderText("Search All Mail"), { target: { value: "" } });
    expect(await screen.findByText("Ridgeley")).toBeInTheDocument(); // clearing restores
  });

  // EMAIL-F-03 (2026-09-05): "What Did I Say About This?" always answered
  // "Nothing you wrote covers that", because the search hits it read were
  // metadata (no bodies) and parseSaid refuses any quote it cannot find in
  // the body. The thread is fetched in full now, so a quote the model gets
  // right is one he actually wrote, on screen with its date.
  it("What Did I Say About This? reads the sent body, not the empty metadata", async () => {
    const sentMeta: GmailThreadMeta = { id: "s1", messages: [
      msg("sm1", "Me <me@x.com>", "Invoice", "I will send the invoice Friday", ["SENT"], 400),
    ] };
    const sentFull = { id: "s1", messages: [
      { id: "sm1", threadId: "s1", snippet: "", internalDate: "400", payload: { mimeType: "text/plain", body: { data: btoa("Hi Wei. I will send the invoice Friday. Thanks") },
        headers: [{ name: "From", value: "Me <me@x.com>" }, { name: "To", value: "Wei <wei@x.com>" }, { name: "Subject", value: "Invoice" }, { name: "Date", value: "Mon, 24 Aug 2026 10:00:00 -0400" }, { name: "Message-ID", value: "<s@x>" }] } },
    ] };
    const ai = new AIService({
      available: true,
      getToken: () => "tok",
      fetchImpl: (async (_url: string, init?: { body?: string }) => {
        const said = (init?.body ?? "").includes("QUOTE them verbatim");
        const text = said ? JSON.stringify([{ i: 0, quote: "I will send the invoice Friday." }]) : "[]";
        return { ok: true, status: 200, json: async () => ({ text }), text: async () => "" };
      }) as unknown as typeof fetch,
    });
    const api = makeApi({
      searchThreads: async () => [sentMeta],
      getThread: async (id: string) => (id === "s1" ? sentFull : fullThread),
    });
    render(wrap(<MessagesFlow ai={ai} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    // EM1 (2026-09-12): search lives on the All view; For You opens on the
    // outcome switch.
    fireEvent.click(await screen.findByText("All"));
    fireEvent.change(await screen.findByPlaceholderText("Search All Mail"), { target: { value: "invoice" } });
    fireEvent.click(await screen.findByText("What Did I Say About This?"));
    expect(await screen.findByText(/I will send the invoice Friday\./)).toBeInTheDocument();
    expect(screen.queryByText("Nothing you wrote covers that")).toBeNull();
  });

  // EMAIL-F-09 (2026-09-05): "Detail-view Archive is a silent no-op for any
  // thread not in the loaded inbox list." archiveThread looked the row up in
  // `rows` only; a search hit lives in `results`, so the screen popped back
  // to the list with no toast, no Undo, and the thread still in the inbox.
  it("archiving an opened search hit really archives it, with the toast and Undo the list gets", async () => {
    const hitFull = { id: "t9", messages: [
      { id: "m9", threadId: "t9", snippet: "", payload: { mimeType: "text/plain", body: { data: btoa("Operating agreement attached") },
        headers: [{ name: "From", value: "Sarah <s@x.com>" }, { name: "Subject", value: "LLC docs" }, { name: "Date", value: "Mon" }, { name: "Message-ID", value: "<c@x>" }] } },
    ] };
    const calls: string[] = [];
    const api = makeApi({
      searchThreads: async () => [{ id: "t9", messages: [msg("m9", "Sarah <s@x.com>", "LLC docs", "Operating agreement", [], 50)] }],
      getThread: async (id: string) => (id === "t9" ? hitFull : fullThread),
      modifyThread: async (id, add, remove) => {
        if (remove.includes("INBOX")) calls.push("archive:" + id);
        if (add.includes("INBOX")) calls.push("restore:" + id);
      },
    });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("Ridgeley");
    fireEvent.change(screen.getByPlaceholderText("Search All Mail"), { target: { value: "llc" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Search All Mail"), { key: "Enter" });
    fireEvent.click(await screen.findByText("Sarah"));
    expect(await screen.findByText("Operating agreement attached")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Archive"));
    await waitFor(() => expect(calls).toContain("archive:t9"));
    expect(await screen.findByText("Archived")).toBeInTheDocument();
    // Gone from the results list, and Undo puts it back in Gmail.
    expect(screen.queryByText("Sarah")).toBeNull();
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(calls).toContain("restore:t9"));
  });

  it("triage failure lands on a calm state, never the wall and never an invented sort", async () => {
    const ai = aiReturning("I refuse to answer with JSON today.");
    render(wrap(<MessagesFlow ai={ai} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    // The law: a failed sort must not dump the raw list back on him.
    expect(await screen.findByText("Couldn’t Sort Your Mail")).toBeInTheDocument();
    expect(screen.queryByText("Ridgeley")).toBeNull();
    expect(screen.queryByText("Needs You")).toBeNull();
    expect(screen.queryByText("Noise")).toBeNull();
    // One way out, and he chooses it.
    fireEvent.click(screen.getByText("Show All Mail"));
    expect(await screen.findByText("Ridgeley")).toBeInTheDocument();
  });

  it("a triage request that hangs is not allowed to trap the user", async () => {
    const hanging = new AIService({
      available: true,
      getToken: () => "tok",
      fetchImpl: (() => new Promise(() => {})) as unknown as typeof fetch,
    });
    render(wrap(<MessagesFlow ai={hanging} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("Reading Your Inbox");
    // The exit is on screen while it is still trying, not only after failure.
    fireEvent.click(screen.getByText("Show All Mail Instead"));
    expect(await screen.findByText("Ridgeley")).toBeInTheDocument();
  });

  it("while triage is still running, For You is a calm state and never the wall", async () => {
    const pending = new AIService({
      available: true,
      getToken: () => "tok",
      fetchImpl: (() => new Promise(() => {})) as unknown as typeof fetch,
    });
    render(wrap(<MessagesFlow ai={pending} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    expect(await screen.findByText("Reading Your Inbox")).toBeInTheDocument();
    expect(screen.queryByText("Ridgeley")).toBeNull();
    expect(screen.queryByText("DoorDash")).toBeNull();
  });

  it("a thread that has needed him for days is caught by the net, exactly once", async () => {
    // Pretend this inbox has been seen before: the first run deliberately
    // absorbs the backlog instead of dumping it into the task list.
    localStorage.setItem("jarvis.mail.netted.seeded.v1", "1");
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "needs_you", gist: "Ridgeley needs the waiver by Friday." },
      { id: "t2", bucket: "noise", gist: "DoorDash promo." },
    ]));
    const { unmount } = render(wrap(<MessagesFlow ai={ai} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    // SPEC MOVED (short copy, 2026-08-15)
    expect(await screen.findByText(/Now tasks/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("jarvis.mail.netted.v1") || "[]")).toContain("t1");
    unmount();

    // Second run of the app: the thread is already netted, so nothing is
    // created again and there is no receipt to show. Nagging is the failure
    // mode this feature exists to avoid.
    render(wrap(<MessagesFlow ai={ai} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    // SPEC MOVED (V2 anatomy, 2026-08-15): fold count now rides as a pill.
    expect(await screen.findByText("The Rest")).toBeInTheDocument();
    // SPEC MOVED (short copy, 2026-08-15)
    expect(screen.queryByText(/Now tasks/)).toBeNull();
  });

  it("deletes a thread to Gmail's trash, never permanently", async () => {
    const trashed: string[] = [];
    let permanentDeleteCalled = false;
    const api = makeApi({
      trashThread: async (id: string) => { trashed.push(id); },
      // If a permanent delete ever appears on the API, this must never fire.
      deleteThread: async () => { permanentDeleteCalled = true; },
    } as Parameters<typeof makeApi>[0]);
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Ridgeley"));
    fireEvent.click(await screen.findByLabelText("Delete"));
    await waitFor(() => expect(trashed).toEqual(["t1"]));
    expect(permanentDeleteCalled).toBe(false);
    // SPEC MOVED (short copy, 2026-08-15)
    expect(await screen.findByText(/In trash 30 days/)).toBeInTheDocument();
    expect(screen.queryByText("Ridgeley")).toBeNull(); // gone from the list too
  });

  it("swipe actions exist on every mail row: archive and delete", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("Ridgeley");
    // Two rows, each with its own pair of actions.
    expect(screen.getAllByLabelText("Archive")).toHaveLength(2);
    expect(screen.getAllByLabelText("Delete")).toHaveLength(2);
  });

  it("archiving from the list needs no thread open", async () => {
    const archived: string[] = [];
    const api = makeApi({ modifyThread: async (id, _a, remove) => { if (remove.includes("INBOX")) archived.push(id); } });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("Ridgeley");
    fireEvent.click(screen.getAllByLabelText("Archive")[0]!);
    await waitFor(() => expect(archived).toEqual(["t1"]));
    expect(screen.queryByText("Ridgeley")).toBeNull();
  });

  it("only one offer can be on screen at a time", async () => {
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "needs_you", gist: "g" },
      { id: "t2", bucket: "noise", gist: "promo" },
    ]));
    // This sender is already over the self-cleaning threshold, and the
    // Sweep arms the auto-noise offer. Both want the same slot.
    localStorage.setItem("jarvis.mail.tossed.v1", JSON.stringify({ "no@dd.com": 4 }));
    render(wrap(<MessagesFlow ai={ai} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    // SPEC MOVED (V2 anatomy, 2026-08-15): fold count now rides as a pill.
    fireEvent.click(await screen.findByText("The Rest"));
    // SPEC MOVED (8A castes, 2026-08-25): "Archive All" is now "Sweep".
    fireEvent.click(await screen.findByText("Sweep"));
    // SPEC MOVED (short copy, 2026-08-15)
    expect(await screen.findByText(/Archived unread 4 times/)).toBeInTheDocument();
    expect(screen.queryByText("Clear Noise Automatically from Now On")).toBeNull();
  });

  it("archive can be undone from the toast", async () => {
    const calls: string[] = [];
    const api = makeApi({ modifyThread: async (id, add, remove) => {
      if (remove.includes("INBOX")) calls.push("archive:" + id);
      if (add.includes("INBOX")) calls.push("restore:" + id);
    } });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("Ridgeley");
    fireEvent.click(screen.getAllByLabelText("Archive")[0]!);
    await waitFor(() => expect(calls).toContain("archive:t1"));
    expect(screen.queryByText("Ridgeley")).toBeNull();
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(calls).toContain("restore:t1"));
    expect(await screen.findByText("Ridgeley")).toBeInTheDocument();
  });

  it("a muted thread never comes back, and the rules screen can unmute it", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Ridgeley"));
    fireEvent.click(await screen.findByText("Mute This Thread"));
    await waitFor(() => expect(screen.queryByText("Ridgeley")).toBeNull());
    expect(screen.getByText("DoorDash")).toBeInTheDocument(); // only that thread
    fireEvent.click(screen.getByText("Standing Rules"));
    fireEvent.click(await screen.findByText("Unmute"));
    fireEvent.click(screen.getByText("Email"));
    expect(await screen.findByText("Ridgeley")).toBeInTheDocument();
  });

  it("composes and sends", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByLabelText("New Message"));
    fireEvent.change(screen.getByPlaceholderText("To"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByText("Send"));
    // Undo send (2026-08-20): nothing leaves during the hold. That IS the
    // feature, so the test asserts the hold exists and then releases it,
    // rather than asserting the old fire-and-pray behaviour.
    await waitFor(() => expect(screen.getByText("Nothing has left yet")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Send Now"));
    await waitFor(() => expect(screen.getByText("Sent")).toBeInTheDocument());
  });

  it("shows an honest setup state when unconfigured", () => {
    render(wrap(<MessagesFlow ai={noAI} configured={false} />));
    expect(screen.getByText("Connect Your Email")).toBeInTheDocument();
  });

  // THE BLANK EMAIL PAGE (2026-09-02, found by the CLEAN=1 build): a build
  // with no backend passes demoMail, and a CLEAN build has no fixture
  // module. The flag alone must never blank the page.
  it("with demoMail set but no fixture module, the setup state renders, never a blank", () => {
    const src = readFileSync(join(__dirname, "MessagesFlow.tsx"), "utf8");
    expect(src, "the demo branch is gated on the module, not the flag alone").toMatch(/if \(demoMail && DemoMail\) \{/);
    expect(src).not.toMatch(/\) : null;\s*\}\s*return \(\s*<div className=\{"screen " \+ pushCls\} key="connect">/);
  });

  it("renders the demo fixture instead of the setup state when demoMail is set", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured={false} demoMail />));
    // SPEC MOVED (E14, 2026-08-23): the count and the verb ride the head.
    // E-02 (2026-09-12): the switch tab and the section head both say
    // Needs You, and the Sweep is the head's own capsule.
    expect(await screen.findByRole("tab", { name: /Needs You/ })).toBeInTheDocument();
    expect(screen.getByText(/^Sweep \u00b7 About/)).toBeInTheDocument();
    expect(screen.queryByText("Connect Your Email")).not.toBeInTheDocument();
  });

  it("lists drafts, opens one prefilled, and deletes it after sending", async () => {
    let deleted: string | null = null;
    const api = makeApi({
      listThreads: async () => [],
      listDrafts: async () => [{ id: "d1", message: { id: "m9", snippet: "draft body",
        payload: { headers: [{ name: "To", value: "z@x.com" }, { name: "Subject", value: "Hello draft" }] } } }],
      getDraft: async (id: string) => ({ id, message: { id: "m9", threadId: "t9",
        payload: { mimeType: "text/plain", body: { data: btoa("draft body") },
          headers: [{ name: "To", value: "z@x.com" }, { name: "Subject", value: "Hello draft" }] } } }),
      deleteDraft: async (id: string) => { deleted = id; },
    });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText(/Drafts/));
    fireEvent.click(await screen.findByText("Hello draft"));
    expect(((await screen.findByPlaceholderText("To")) as HTMLInputElement).value).toBe("z@x.com");
    fireEvent.click(screen.getByText("Send"));
    // The draft is only cleaned up once the message ACTUALLY leaves, which is
    // after the hold. Deleting it during the hold would destroy the draft the
    // user can still pull back to.
    fireEvent.click(await screen.findByText("Send Now"));
    await waitFor(() => expect(deleted).toBe("d1"));
  });

  // EMAIL-F-14 (2026-09-05): "Compose Cancel discards the message with no
  // confirm and no draft save." Cancel only changed `view`: five minutes of
  // writing went with one tap, and Edit on a Could Not Send card followed by
  // Cancel lost the message that had already failed once. Anything with
  // words in it now goes to Gmail Drafts on the way out.
  it("Cancel saves what he wrote to Drafts, on the thread's own account", async () => {
    const created: { raw: string; threadId?: string }[] = [];
    const api = makeApi({ createDraft: async (raw: string, threadId?: string) => { created.push({ raw, threadId }); return { id: "nd1" }; } });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Ridgeley"));
    fireEvent.click(await screen.findByText("Reply"));
    fireEvent.change(screen.getByPlaceholderText("Message"), { target: { value: "Sending the waiver tonight" } });
    fireEvent.click(screen.getByText("Cancel"));
    expect(await screen.findByText("Saved to Drafts")).toBeInTheDocument();
    expect(created).toHaveLength(1);
    expect(created[0]!.threadId).toBe("t1");
    const decoded = atob(created[0]!.raw.replace(/-/g, "+").replace(/_/g, "/"));
    expect(decoded).toContain("Sending the waiver tonight");
    expect(decoded).toContain("To: t@x.com");
  });

  it("an empty compose still just closes, with nothing saved", async () => {
    const created: string[] = [];
    const api = makeApi({ createDraft: async (raw: string) => { created.push(raw); return { id: "nd2" }; } });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Ridgeley"));
    fireEvent.click(await screen.findByText("Reply"));
    fireEvent.click(screen.getByText("Cancel"));
    await screen.findByText("Reply");
    expect(created).toEqual([]);
  });

  it("a draft opened from the list is updated in place, not duplicated", async () => {
    const updated: { id: string; raw: string }[] = [];
    const api = makeApi({
      listThreads: async () => [],
      listDrafts: async () => [{ id: "d1", message: { id: "m9", snippet: "draft body",
        payload: { headers: [{ name: "To", value: "z@x.com" }, { name: "Subject", value: "Hello draft" }] } } as never }],
      getDraft: async (id: string) => ({ id, message: { id: "m9", threadId: "t9",
        payload: { mimeType: "text/plain", body: { data: btoa("draft body") },
          headers: [{ name: "To", value: "z@x.com" }, { name: "Cc", value: "cc@x.com" }, { name: "Subject", value: "Hello draft" }] } } as never }),
      createDraft: async () => { throw new Error("must not create a second draft"); },
      updateDraft: async (id: string, raw: string) => { updated.push({ id, raw }); return { id }; },
    });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText(/Drafts/));
    fireEvent.click(await screen.findByText("Hello draft"));
    const body = await screen.findByPlaceholderText("Message");
    fireEvent.change(body, { target: { value: "draft body, finished" } });
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(updated.map((u) => u.id)).toEqual(["d1"]));
    const decoded = atob(updated[0]!.raw.replace(/-/g, "+").replace(/_/g, "/"));
    // The Cc the draft came with survives the round trip (it used to be
    // dropped, so finishing a reply started a new conversation with one
    // recipient on it).
    expect(decoded).toContain("Cc: cc@x.com");
  });

  // B6-8 (2026-09-04): "Demo email fixtures show on the real home page."
  // A stale (or demo) snapshot used to survive a real, genuinely empty
  // inbox forever, because the writer refused to save an empty snapshot.
  // triaged alone (not rows.length) is now the gate, so a real account
  // that connects to nothing overwrites whatever was there with the truth.
  it("a real, empty inbox overwrites a stale snapshot instead of leaving it behind", async () => {
    saveMailSnapshot({
      ts: Date.now(),
      needsYou: 3,
      threads: [{ id: "demo-0", from: "Northwind Cloud", fromEmail: "n@example.com", subject: "Demo", gist: "Demo" }],
      waiting: [],
      promises: [],
    });
    const api = makeApi({ listThreads: async () => [] });
    render(wrap(<MessagesFlow ai={aiReturning("[]")} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    await waitFor(() => expect(loadMailSnapshot().threads.length).toBe(0));
    expect(loadMailSnapshot().needsYou).toBe(0);
  });

  // EMAIL-F-12 (2026-09-05): "The Google session value is rebuilt every
  // render, so the Email tab reloads its whole inbox on any shell re-render."
  // The provider's value was an object literal, so every re-render of the
  // shell above it (QuickCapture opening, the search overlay, any AppShell
  // state) handed MessagesFlow a new `g`, and loadThreads (keyed on `g`) ran
  // again: 30 metadatas per account, Waiting On, the sweep, the meeting
  // finder. The wrapper here holds its callbacks stable the way AppShell does
  // (it passes none), and bumps a state above the provider three times.
  it("a re-render above the session provider does not reload the inbox", async () => {
    let lists = 0;
    const api = makeApi({ listThreads: async () => { lists += 1; return THREADS; } });
    const reqTok = async () => "tok";
    const mkApi = () => api;
    function Shell() {
      const [, setN] = useState(0);
      return (
        <NotesProvider userId="u1">
          <GoogleSessionProvider requestToken={reqTok} makeApi={mkApi}>
            <button onClick={() => setN((n) => n + 1)}>bump</button>
            <MessagesFlow ai={noAI} configured />
          </GoogleSessionProvider>
        </NotesProvider>
      );
    }
    render(<Shell />);
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("Ridgeley");
    // Connecting settles through a few real changes (token, account list);
    // let them land, then take the count as the baseline.
    await new Promise((r) => setTimeout(r, 50));
    const settled = lists;
    fireEvent.click(screen.getByText("bump"));
    fireEvent.click(screen.getByText("bump"));
    fireEvent.click(screen.getByText("bump"));
    await new Promise((r) => setTimeout(r, 50));
    expect(lists).toBe(settled);
  });

  // EMAIL-F-08 (2026-09-05): "Close It Out promises Undo for a week and has
  // no undo." The card offers to archive up to 60 threads under the line
  // "Archived, never deleted · Searchable in Gmail forever · Undo for a
  // week", and the handler was a bare toast for four seconds with no Undo
  // button, ever. Both halves of the promise are covered here: the button on
  // the toast, and the batch kept for the week Standing Rules can reach.
  it("Close It Out offers a real Undo, and remembers the batch for the week", async () => {
    const archived: string[] = [];
    const restored: string[] = [];
    const api = makeApi({
      modifyThread: async (id, add, remove) => {
        if (remove.includes("INBOX")) archived.push(id);
        if (add.includes("INBOX")) restored.push(id);
      },
    });
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "noise", gist: "g" }, { id: "t2", bucket: "noise", gist: "promo" },
    ]));
    render(wrap(<MessagesFlow ai={ai} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Close It Out"));
    await waitFor(() => expect(archived.sort()).toEqual(["t1", "t2"]));
    // The promise the card made, on the toast it produced.
    expect(await screen.findByText("Undo")).toBeInTheDocument();
    // And kept for the week, so Standing Rules can still put it back.
    expect(loadClosedBatch()?.threads.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(restored.sort()).toEqual(["t1", "t2"]));
    // Undone means undone: the week-long offer is spent too.
    expect(loadClosedBatch()).toBeNull();
  });

  // EMAIL-F-28 (2026-09-05): "Stale drafts (N10) only reach Today if the
  // Drafts chip was tapped this session." loadDrafts was gated on the Drafts
  // filter and the Today snapshot is built from the same state, so the
  // "Unsent" card only appeared if he had happened to open that chip during
  // the visit, which is the opposite of what an unsent draft is for.
  it("an unsent draft reaches the Today snapshot without opening the Drafts chip", async () => {
    const fiveDaysAgo = Date.now() - 5 * 86400e3;
    const api = makeApi({
      listDrafts: async () => [{
        id: "d1",
        message: {
          id: "dm1", snippet: "Half a line", labelIds: ["DRAFT"], internalDate: String(fiveDaysAgo),
          payload: { headers: [{ name: "To", value: "Wei <wei@x.com>" }, { name: "Subject", value: "Invoice" }] },
        } as never,
      }],
    });
    // The Today snapshot is only written once the inbox has been triaged.
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "noise", gist: "g" }, { id: "t2", bucket: "noise", gist: "promo" },
    ]));
    render(wrap(<MessagesFlow ai={ai} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    await waitFor(() => expect((loadMailSnapshot().drafts ?? []).map((d) => d.subject)).toEqual(["Invoice"]));
  });

  // EMAIL-F-27 (2026-09-05): "Receipts and counters over-claim." Let It Go
  // archives nothing (letGo.ts: the mail is untouched, it only stops counting
  // the days), and it used to raise "N Cleared Today", which is a count of
  // real archives incremented where the archive actually happens.
  it("letting a thread go does not count as clearing it", async () => {
    const DAY = 86400e3;
    const sent: GmailThreadMeta = { id: "w1", messages: [{
      id: "wm1", snippet: "The waiver", labelIds: ["SENT"], internalDate: String(Date.now() - 12 * DAY),
      payload: { headers: [
        { name: "From", value: "Me <me@example.com>" }, { name: "To", value: "Rob <rob@y.com>" },
        { name: "Subject", value: "The waiver" },
      ] },
    }] };
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "noise", gist: "g" }, { id: "t2", bucket: "noise", gist: "promo" },
    ]));
    render(wrap(<MessagesFlow ai={ai} configured />, makeApi({ searchThreads: async () => [sent] })));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByLabelText("Let it go"));
    expect(await screen.findByText("Stopped tracking")).toBeInTheDocument();
    expect(loadLetGo()).toContain("w1");
    expect(clearedToday(todayISO())).toBe(0);
  });

  // EMAIL-F-26 (2026-09-05): "Drain minutes field snaps to 5 the moment it is
  // cleared." Every keystroke was clamped and clampMinutes(NaN) is 5, so
  // backspacing the 5 put a 5 straight back, and typing 15 gave 51.
  it("the drain minutes box holds what he types while he types it", async () => {
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "needs_you", gist: "Ridgeley needs the waiver." },
      { id: "t2", bucket: "noise", gist: "promo" },
    ]));
    render(wrap(<MessagesFlow ai={ai} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Only a Few Minutes?"));
    const box = await screen.findByLabelText("Minutes");
    expect((box as HTMLInputElement).value).toBe("5");
    fireEvent.change(box, { target: { value: "" } });
    expect((box as HTMLInputElement).value).toBe("");
    fireEvent.change(box, { target: { value: "1" } });
    fireEvent.change(box, { target: { value: "15" } });
    expect((box as HTMLInputElement).value).toBe("15");
    fireEvent.blur(box);
    expect((box as HTMLInputElement).value).toBe("15");
    expect(loadMinutes()).toBe(15);
  });

  // EMAIL-F-22 (2026-09-05): "Waiting On alternates are swipe-only in the
  // common single-row case; swipe is touch-only." One person owing a reply
  // meant Let It Go, Ask To Call, Add as Task, Block Time For It and Forward
  // It were reachable only by a horizontal swipe (the card that carries them
  // as buttons needs two rows), and useSwipe reads touch events only, so on
  // a desktop browser they could not be reached at all.
  it("More Moves is reachable by tap on a single waiting row", async () => {
    const DAY = 86400e3;
    const sent: GmailThreadMeta = { id: "w1", messages: [{
      id: "wm1", snippet: "The waiver", labelIds: ["SENT"], internalDate: String(Date.now() - 12 * DAY),
      payload: { headers: [
        { name: "From", value: "Me <me@example.com>" }, { name: "To", value: "Rob <rob@y.com>" },
        { name: "Subject", value: "The waiver" },
      ] },
    }] };
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "noise", gist: "g" }, { id: "t2", bucket: "noise", gist: "promo" },
    ]));
    render(wrap(<MessagesFlow ai={ai} configured />, makeApi({ searchThreads: async () => [sent] })));
    fireEvent.click(await screen.findByText("Connect Google"));
    // The one waiting row, with its More control on the row itself. (The
    // swipe reveal behind the row carries the same word, hidden until it is
    // swiped, which is exactly the control a mouse cannot reach.)
    const onRow = (await screen.findAllByText("More")).find((el) => el.className.includes("pill-act"));
    expect(onRow).toBeDefined();
    fireEvent.click(onRow!);
    expect(await screen.findByText("More Moves")).toBeInTheDocument();
    // The sheet is the whole point: the alternates are in it, tappable.
    const sheet = document.querySelector(".sheet-scrim");
    expect(sheet).not.toBeNull();
    expect(sheet!.querySelectorAll(".list-flat .row").length).toBeGreaterThan(0);
  });

  // EMAIL-F-21 (2026-09-05): "A stale Undo button can attach itself to an
  // unrelated toast." Archive a row ("Archived · Undo"), then within six
  // seconds trigger any plain toast and the new toast wore the old Undo,
  // which un-archived a thread the user was no longer looking at. Every
  // toast goes through say() now, and say() clears the undo it was not
  // given. The pair here is real: archiving the fourth unread DoorDash puts
  // the "always quiet this sender" offer on screen, and taking it toasts.
  it("a plain toast never carries the previous toast's Undo", async () => {
    // Four already thrown away unread by hand: the next archive from this
    // sender is what puts the "always quiet this sender" offer on screen.
    for (const _ of [1, 2, 3, 4]) recordToss("no@dd.com", true);
    const unreadPromo: GmailThreadMeta[] = [
      { id: "t2", messages: [msg("m3", "DoorDash <no@dd.com>", "20% off", "Order now", ["INBOX", "UNREAD"], 200)] },
    ];
    const ddFull = {
      id: "t2",
      messages: [{ id: "m3", threadId: "t2", snippet: "", payload: { mimeType: "text/plain", body: { data: btoa("Order now") },
        headers: [{ name: "From", value: "DoorDash <no@dd.com>" }, { name: "Subject", value: "20% off" }, { name: "Message-ID", value: "<d@x>" }] } }],
    };
    // The offers live in the triaged list, so this one runs with AI.
    const ai = aiReturning(JSON.stringify([{ id: "t2", bucket: "needs_you", gist: "DoorDash wants an answer." }]));
    render(wrap(<MessagesFlow ai={ai} configured />, makeApi({ listThreads: async () => unreadPromo, getThread: async () => ddFull })));
    fireEvent.click(await screen.findByText("Connect Google"));
    // Triaged rows lead with the gist, so that is what the row reads as.
    fireEvent.click(await screen.findByText("DoorDash wants an answer."));
    // Wait for the detail view before reaching for its nav actions.
    await screen.findByText("Mute This Thread");
    fireEvent.click(screen.getByLabelText("Archive"));
    // The archive's own toast: reversible, so it offers the way back.
    expect(await screen.findByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("Undo")).toBeInTheDocument();
    // A different, unrelated toast, well inside the six seconds.
    fireEvent.click(await screen.findByText("Yes, file them"));
    expect(await screen.findByText("Straight to Noise from now on")).toBeInTheDocument();
    expect(screen.queryByText("Undo")).toBeNull();
  });

  // EMAIL-F-18 (2026-09-05): "Only 30 threads per account are ever loaded;
  // empty-state copy speaks for the whole inbox." An inbox of 400 read as 30
  // with no way to reach thread 31, and the floor said "That's everything."
  const page = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({
    id: "p" + (from + i),
    messages: [msg("pm" + (from + i), "Sender " + (from + i) + " <s" + (from + i) + "@x.com>", "Subject " + (from + i), "snip", ["INBOX"], 1000 + from + i)],
  }));

  it("a full page offers Load More, and the floor only claims everything once a page comes back short", async () => {
    const asks: number[] = [];
    const api = makeApi({ listThreads: async (n: number) => { asks.push(n); return page(Math.min(n, 30)); } });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    // 30 asked for, 30 returned: there may be more, so the floor says what it
    // is showing and offers the next page instead of "That's everything."
    await screen.findByText("Load More");
    expect(screen.getByText("Showing what's loaded so far.")).toBeInTheDocument();
    expect(asks[asks.length - 1]).toBe(30);
    fireEvent.click(screen.getByText("Load More"));
    await waitFor(() => expect(asks).toContain(60));
    // 60 asked for, 30 returned: now the inbox has a bottom and it says so.
    await screen.findByText("That's everything.");
    expect(screen.queryByText("Load More")).toBeNull();
  });

  it("an emptied page does not claim the inbox is empty", async () => {
    // Thirty threads, none of them still in the inbox: the list is empty and
    // the page was full, which is "nothing more loaded", not "Inbox Empty".
    const archived = page(30).map((t) => ({ ...t, messages: t.messages.map((m) => ({ ...m, labelIds: [] })) }));
    render(wrap(<MessagesFlow ai={noAI} configured />, makeApi({ listThreads: async () => archived })));
    fireEvent.click(await screen.findByText("Connect Google"));
    await waitFor(() => expect(screen.getByText("Nothing More Loaded")).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByText("Inbox Empty")).toBeNull();
  });

  // EMAIL-F-13 (2026-09-05): "Multi-account: the default account is used for
  // search hits, drafts, and deck-edited replies." A draft listed from the
  // second account was opened with g.api(), which is whichever account holds
  // a token first, so getDraft 404'd on an id that account has never seen.
  // Drafts now carry the account that listed them.
  it("a draft that lives in the second account opens through that account", async () => {
    const gets: string[] = [];
    const draftMeta = { id: "dm9", snippet: "", labelIds: ["DRAFT"], internalDate: "500",
      payload: { headers: [{ name: "To", value: "Wei <wei@x.com>" }, { name: "Subject", value: "Invoice" }] } };
    const full = { id: "dm9", threadId: "t9", payload: { mimeType: "text/plain", body: { data: btoa("Half a sentence") },
      headers: [{ name: "To", value: "Wei <wei@x.com>" }, { name: "Subject", value: "Invoice" }] } };
    const apis: Record<string, GoogleApi> = {
      "a@x.com": makeApi({
        listDrafts: async () => [],
        getDraft: async (id: string) => { gets.push("a:" + id); return { id, message: full as never }; },
      }),
      "b@x.com": makeApi({
        listThreads: async () => [],
        listDrafts: async () => [{ id: "d9", message: draftMeta as never }],
        getDraft: async (id: string) => { gets.push("b:" + id); return { id, message: full as never }; },
      }),
    };
    render(
      <NotesProvider userId="two-accounts-drafts">
        <TwoAccounts apiOf={(e) => apis[e]!}><MessagesFlow ai={noAI} configured /></TwoAccounts>
      </NotesProvider>,
    );
    fireEvent.click(await screen.findByText(/^Drafts/));
    fireEvent.click(await screen.findByText("Invoice"));
    await waitFor(() => expect(gets).toEqual(["b:d9"]));
    expect(await screen.findByDisplayValue("Half a sentence")).toBeInTheDocument();
  });

  // EMAIL-F-04 (2026-09-05): "An expired token or a dead network reads as
  // Inbox Is Quiet and wipes the Today email band." PROOF A from the audit:
  // listThreads throwing "threads 401" rendered "Inbox Is Quiet", no
  // sign-in-expired text anywhere, and loadMailSnapshot() afterwards had
  // threads.length 0 and needsYou 0 where a real snapshot had been.
  it("a failed fetch reads as an error, never Inbox Is Quiet, and keeps the last good snapshot", async () => {
    saveMailSnapshot({
      ts: Date.now() - 60_000,
      needsYou: 2,
      threads: [{ id: "real-1", from: "Ridgeley", fromEmail: "t@x.com", subject: "Waiver", gist: "Needs the waiver" }],
      waiting: [],
      promises: [],
    });
    const api = makeApi({ listThreads: async () => { throw new Error("threads 401"); } });
    render(wrap(<MessagesFlow ai={aiReturning("[]")} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    // waitFor rather than findByText: the session settling after connect
    // re-runs loadThreads, and each run clears the line before re-setting
    // it, so a node found mid-flight can be swapped out a tick later.
    await waitFor(() => {
      expect(screen.getByText("Your Google sign-in expired · Reconnect in Settings")).toBeInTheDocument();
      expect(screen.getByText("Couldn’t Reach Your Mail")).toBeInTheDocument();
      expect(screen.getByText("Try Again")).toBeInTheDocument();
    });
    expect(screen.queryByText("Inbox Is Quiet")).toBeNull();
    expect(screen.queryByText("Inbox Empty")).toBeNull();
    expect(screen.queryByText("Reading Your Inbox")).toBeNull();
    // The band on Today still shows the last good read, not a fresh zero.
    expect(loadMailSnapshot().needsYou).toBe(2);
    expect(loadMailSnapshot().threads.map((t) => t.id)).toEqual(["real-1"]);
  });

  it("the All chip says the same on a failed fetch, not Inbox Empty", async () => {
    const api = makeApi({ listThreads: async () => { throw new Error("Failed to fetch"); } });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    await waitFor(() => expect(screen.getByText("You're offline · Nothing was lost")).toBeInTheDocument());
    expect(screen.queryByText("Inbox Empty")).toBeNull();
  });

  // 2026-09-06, Dave from his phone: "Email has an error". Two accounts
  // connected, one of them answering 403, and the line under the chips said
  // "Google refused that · Reconnect in Settings to update permissions" while
  // naming NEITHER account, so the one thing it asked him to do was the one
  // thing it would not tell him how to do. EMAIL-F-04 is why he is seeing it
  // at all: before that, a failing account was caught to [] and read as an
  // empty inbox, which is the worse bug and is not coming back.
  //
  // A failure belongs to the ACCOUNT it happened to, so there is one line per
  // account and each one names its own. The full address, not acctLabel:
  // two gmail accounts both shorten to "gmail".
  const REFUSED = "Google refused that · Reconnect in Settings to update permissions";
  const EXPIRED = "Your Google sign-in expired · Reconnect in Settings";

  it("one account of two refusing says which one, and does not read as a dead inbox", async () => {
    const apis: Record<string, GoogleApi> = {
      "a@x.com": makeApi(),
      "b@x.com": makeApi({ listThreads: async () => { throw new Error("threads 403"); } }),
    };
    render(
      <NotesProvider userId="two-accounts-one-403">
        <TwoAccounts apiOf={(e) => apis[e]!}><MessagesFlow ai={noAI} configured /></TwoAccounts>
      </NotesProvider>,
    );
    expect(await screen.findByText("b@x.com · " + REFUSED)).toBeInTheDocument();
    // The account that answered is not accused of anything, and its mail is
    // on the screen, so the page is not down and never says it is.
    expect(screen.queryByText("a@x.com · " + REFUSED)).toBeNull();
    expect(await screen.findByText("Ridgeley")).toBeInTheDocument();
    expect(screen.queryByText("Couldn’t Reach Your Mail")).toBeNull();
  });

  // The other half: two failures is not one account failing, and two causes
  // are not one sentence. failures[0] spoke for both, so a 401 on one account
  // and a 403 on the other rendered as whichever lost the race.
  it("both accounts failing says both, each with its own cause", async () => {
    const apis: Record<string, GoogleApi> = {
      "a@x.com": makeApi({ listThreads: async () => { throw new Error("threads 401"); } }),
      "b@x.com": makeApi({ listThreads: async () => { throw new Error("threads 403"); } }),
    };
    render(
      <NotesProvider userId="two-accounts-both-fail">
        <TwoAccounts apiOf={(e) => apis[e]!}><MessagesFlow ai={noAI} configured /></TwoAccounts>
      </NotesProvider>,
    );
    expect(await screen.findByText("a@x.com · " + EXPIRED)).toBeInTheDocument();
    expect(await screen.findByText("b@x.com · " + REFUSED)).toBeInTheDocument();
    // Nothing answered, so this one IS a page that is down.
    expect(await screen.findByText("Couldn’t Reach Your Mail")).toBeInTheDocument();
  });

  // The hole the shape change closes: the total-failure card keyed on
  // `error`, which any single account failure set, so one refusing account
  // plus one genuinely empty inbox rendered "Couldn't Reach Your Mail" over
  // an account that had answered perfectly well.
  it("one account refusing while the other is empty is still not a dead inbox", async () => {
    const apis: Record<string, GoogleApi> = {
      "a@x.com": makeApi({ listThreads: async () => [] }),
      "b@x.com": makeApi({ listThreads: async () => { throw new Error("threads 403"); } }),
    };
    render(
      <NotesProvider userId="two-accounts-one-empty">
        <TwoAccounts apiOf={(e) => apis[e]!}><MessagesFlow ai={noAI} configured /></TwoAccounts>
      </NotesProvider>,
    );
    expect(await screen.findByText("b@x.com · " + REFUSED)).toBeInTheDocument();
    expect(screen.queryByText("Couldn’t Reach Your Mail")).toBeNull();
  });

  // S2-1 (2026-09-04): "A failed send destroys the message." The outbox
  // queue (outbox.ts) is now wired through MessagesFlow. These cover the
  // three things the old bare-setTimeout send could never do: survive a
  // failure, give Undo something real to pull back, and survive a reload.

  it("a failed send lands as Retry, not lost, and Retry actually resends it", async () => {
    let calls = 0;
    const api = makeApi({
      sendMessage: async () => {
        calls += 1;
        if (calls === 1) throw new Error("network down");
        return { id: "sent_1" };
      },
    });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByLabelText("New Message"));
    fireEvent.change(screen.getByPlaceholderText("To"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(screen.getByText("Nothing has left yet")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Send Now"));
    // humanError only surfaces sentences it recognizes (rate limits, expired
    // auth, and so on); a plain network error falls back to the call site's
    // own wording rather than showing the raw "network down" to a person.
    await waitFor(() => expect(screen.getByText("Could Not Send")).toBeInTheDocument());
    expect(screen.getByText("Could not send")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByText("Sent")).toBeInTheDocument());
    expect(calls).toBe(2);
  });

  it("Undo pulls a still-held send back into the composer, unsent", async () => {
    let sent = false;
    const api = makeApi({ sendMessage: async () => { sent = true; return { id: "sent_1" }; } });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByLabelText("New Message"));
    fireEvent.change(screen.getByPlaceholderText("To"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByPlaceholderText("Subject"), { target: { value: "Hi there" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(screen.getByText("Nothing has left yet")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Undo"));
    // Back in the composer, with what he was writing intact -- not a blank
    // draft -- and the message never went out.
    expect(((await screen.findByPlaceholderText("To")) as HTMLInputElement).value).toBe("a@b.com");
    expect(((await screen.findByPlaceholderText("Subject")) as HTMLInputElement).value).toBe("Hi there");
    expect(screen.queryByText("Nothing has left yet")).not.toBeInTheDocument();
    expect(sent).toBe(false);
  });

  it("a held send survives a reload: the hold banner is there on remount, not dropped", async () => {
    const api = makeApi();
    const { unmount } = render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByLabelText("New Message"));
    fireEvent.change(screen.getByPlaceholderText("To"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(screen.getByText("Nothing has left yet")).toBeInTheDocument());
    expect(loadOutbox()).toHaveLength(1);
    unmount();
    // Still held in storage, not lost with the component.
    expect(loadOutbox()[0]!.state).toBe("held");
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    await waitFor(() => expect(screen.getByText("Nothing has left yet")).toBeInTheDocument());
  });

  // EMAIL-F-07 (2026-09-05): "Archive These archives in Gmail, then the rows
  // come back on the next load." Nothing Owed derives from sent mail plus a
  // cache, not from the INBOX label, so the batch archive changed nothing it
  // reads. PROOF C: findWaiting returned the same thread on consecutive
  // calls. The single-row path recorded letGo; the batch path forgot.
  it("Archive These lets every archived row go, so Nothing Owed agrees with Gmail on the next load", async () => {
    const DAY = 86400e3;
    const sent: GmailThreadMeta = { id: "w1", messages: [{
      id: "wm1", snippet: "Thanks", labelIds: ["SENT"], internalDate: String(Date.now() - 4 * DAY),
      payload: { headers: [
        { name: "From", value: "Me <me@example.com>" }, { name: "To", value: "Sarah <sarah@y.com>" },
        { name: "Subject", value: "Order confirmation" },
      ] },
    }] };
    const archived: string[] = [];
    const restored: string[] = [];
    const api = makeApi({
      searchThreads: async () => [sent],
      modifyThread: async (id, add, remove) => {
        if (remove.includes("INBOX")) archived.push(id);
        if (add.includes("INBOX")) restored.push(id);
      },
    });
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "noise", gist: "g" }, { id: "t2", bucket: "noise", gist: "promo" },
    ]));
    render(wrap(<MessagesFlow ai={ai} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Archive These"));
    await waitFor(() => expect(archived).toEqual(["w1"]));
    // The part the batch path forgot: the days stop counting on it.
    await waitFor(() => expect(loadLetGo()).toContain("w1"));
    expect(screen.queryByText("Archive These")).toBeNull();
    // Undo puts INBOX back AND counts the days again.
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(restored).toEqual(["w1"]));
    expect(loadLetGo()).not.toContain("w1");
  });

  // EMAIL-F-05 (2026-09-05): the card for a send that was mid-flight when
  // the app died used to read "Sending · On its way" with no buttons, for
  // good. It reads as interrupted now, with every way out on it.
  it("a send interrupted by a reload comes back with Retry, Edit and Discard, and Discard undoes", async () => {
    localStorage.setItem("jarvis.mail.outbox.v1", JSON.stringify([{
      id: "stuck", to: "wei@x.com", subject: "Re: Waiver", body: "On it",
      dueMs: Date.now() - 60_000, scheduled: false, state: "sending",
    }]));
    resetOutboxForTest();
    let sends = 0;
    const api = makeApi({ sendMessage: async () => { sends += 1; return { id: "s1" }; } });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    expect(await screen.findByText("Send Interrupted")).toBeInTheDocument();
    expect(screen.getByText("Interrupted · Check Sent, then Retry")).toBeInTheDocument();
    expect(screen.queryByText("On its way")).toBeNull();
    expect(screen.getByText("Retry")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
    // Nothing resent on its own: that is his call after checking Sent.
    expect(sends).toBe(0);
    fireEvent.click(screen.getByText("Discard"));
    await waitFor(() => expect(screen.queryByText("Send Interrupted")).toBeNull());
    expect(loadOutbox()).toHaveLength(0);
    fireEvent.click(screen.getByText("Undo"));
    expect(await screen.findByText("Send Interrupted")).toBeInTheDocument();
    expect(loadOutbox()[0]!.body).toBe("On it");
    expect(sends).toBe(0);
  });

  // S2-5 (2026-09-04): "Everything JARVIS learns about your mail is
  // device-only." Muting is one of the four stores that used to live in
  // localStorage alone; this checks the mirror actually reaches the profile,
  // not just that the local UI updates.
  it("mirrors a mute into the profile, so a second device would see it too", async () => {
    let profile: ProfileService | undefined;
    render(wrapWithProfile(<MessagesFlow ai={noAI} configured />, (p) => { profile = p; }));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Ridgeley"));
    fireEvent.click(await screen.findByText("Mute This Thread"));
    await waitFor(() => expect(screen.queryByText("Ridgeley")).toBeNull());
    await waitFor(async () => expect((await profile!.get())?.mail?.muted).toEqual(["t1"]));
  });

  it("hydrates VIPs from the profile on load when this device has none locally", async () => {
    let profile: ProfileService | undefined;
    const grab = (p: ProfileService) => { profile = p; };
    const { rerender } = render(wrapWithProfile(<div />, grab));
    await waitFor(() => expect(profile).toBeDefined());
    await profile!.save({ mail: { vips: ["t@x.com"] } });
    // The second-device scenario the whole feature exists for: no local mail
    // state at all, but the (same, still-mounted) profile already has
    // something to hydrate from. MessagesFlow mounts fresh here -- it was a
    // bare <div /> until now -- so its first-mount reads see this.
    localStorage.clear();
    rerender(wrapWithProfile(<MessagesFlow ai={noAI} configured />, grab));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Ridgeley"));
    expect(await screen.findByText("Always gets through")).toBeInTheDocument();
  });

  // EMAIL-F-30 (2026-09-05): "Cross-device mail mirror only fills an empty
  // device; two devices never converge." A device that already had one VIP
  // never received the ones marked elsewhere, and its next write mirrored its
  // own list back over them, so a third device would have seen only one side.
  it("a device with its own VIP still receives the other device's, and mirrors both back", async () => {
    let profile: ProfileService | undefined;
    const grab = (p: ProfileService) => { profile = p; };
    const { rerender } = render(wrapWithProfile(<div />, grab));
    await waitFor(() => expect(profile).toBeDefined());
    await profile!.save({ mail: { vips: ["ipad@x.com"] } });
    // This device has a VIP of its own, marked while the other device was
    // offline: the case first-fill hydration silently skipped.
    localStorage.clear();
    toggleVip("t@x.com");
    rerender(wrapWithProfile(<MessagesFlow ai={noAI} configured />, grab));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Ridgeley"));
    expect(await screen.findByText("Always gets through")).toBeInTheDocument();
    expect(loadVips().sort()).toEqual(["ipad@x.com", "t@x.com"]);
    // And the merged list goes straight back up, so a third device gets both.
    await waitFor(async () => expect(((await profile!.get())?.mail?.vips ?? []).slice().sort()).toEqual(["ipad@x.com", "t@x.com"]));
  });

  // S2-8 (2026-09-04): "You Have That File cannot attach it." Tapping the
  // offer used to just type the note's name into the body in brackets and
  // tell him to attach it himself; it now actually attaches the note's
  // content, and that attachment has to survive all the way into the
  // outbox item Send queues.
  it("You Have That File attaches the note for real, not a bracketed name", async () => {
    const askThread = {
      id: "t1",
      messages: [{
        id: "m1", threadId: "t1", snippet: "",
        payload: {
          mimeType: "text/plain", body: { data: btoa("Can you send the waiver?") },
          headers: [
            { name: "From", value: "Ridgeley <t@x.com>" }, { name: "Subject", value: "Waiver" },
            { name: "Date", value: "Mon" }, { name: "Message-ID", value: "<a@x>" },
          ],
        },
      }],
    };
    let notesSvc: NotesService | undefined;
    const api = makeApi({ getThread: async () => askThread });
    render(wrapWithNotes(<MessagesFlow ai={noAI} configured />, (n) => { notesSvc = n; }, api));
    await waitFor(() => expect(notesSvc).toBeDefined());
    const noteId = await notesSvc!.createNote("Ridgeline Waiver 2026", "general");
    await notesSvc!.addBlock(noteId!, { type: "text", text: "Sign by Friday." });

    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Ridgeley"));
    fireEvent.click(await screen.findByText("Reply"));
    fireEvent.change(await screen.findByPlaceholderText("Message"), { target: { value: "Here's the waiver." } });

    fireEvent.click(await screen.findByText("Attach It"));
    await waitFor(() => expect(screen.getByText("Ridgeline Waiver 2026.txt")).toBeInTheDocument());
    // Taken, not just named: the offer card is gone and nothing was typed
    // into the message body to stand in for a real attachment.
    expect(screen.queryByText("Attach It")).not.toBeInTheDocument();
    expect((screen.getByPlaceholderText("Message") as HTMLTextAreaElement).value).toBe("Here's the waiver.");

    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(screen.getByText("Nothing has left yet")).toBeInTheDocument());
    const item = loadOutbox()[0]!;
    expect(item.attachment?.filename).toBe("Ridgeline Waiver 2026.txt");
    expect(item.attachment?.mimeType).toBe("text/plain");
    expect(item.attachment?.content).toBe("Ridgeline Waiver 2026\n\nSign by Friday.\n");
  });
});

// EMAIL-F-06 (2026-09-05): tap an email card on Today, land in the thread,
// and from then on every tap of the Email tab dropped back into that same
// thread. The intent was consumed once per mount and never cleared by its
// owner (the tab bar cleared thirteen others but not these two), and the shell
// remounts the flow on every tab switch, so the jump ran over.
describe("a Today email tap does not stick (EMAIL-F-06)", () => {
  function ShellLike() {
    // The shell's one-shot in miniature: the flow says when it is spent.
    const [intent, setIntent] = useState<{ value?: string; nonce: number }>({ value: "t1", nonce: 1 });
    const [visit, setVisit] = useState(0);
    return (
      <>
        <button onClick={() => setVisit((v) => v + 1)}>Switch Tab</button>
        <MessagesFlow
          key={visit}
          ai={noAI}
          configured
          openThreadId={intent.value}
          threadNonce={intent.nonce}
          onThreadConsumed={() => setIntent((i) => ({ nonce: i.nonce }))}
        />
      </>
    );
  }

  it("opens the thread once, then a later visit to the tab lands on the list", async () => {
    render(wrap(<ShellLike />));
    fireEvent.click(await screen.findByText("Connect Google"));
    // The deep link opened the thread itself, not the inbox.
    expect(await screen.findByText("Need the waiver by Friday")).toBeInTheDocument();

    // Leave and come back, which is what a tab switch does to this flow.
    fireEvent.click(screen.getByText("Switch Tab"));
    await waitFor(() => expect(screen.getByText("DoorDash")).toBeInTheDocument());
    expect(screen.queryByText("Need the waiver by Friday")).not.toBeInTheDocument();
  });
});
