// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useEffect } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NotesProvider, useProfile, useNotes } from "../data/NotesProvider";
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
    expect(screen.getByText("The Sweep")).toBeInTheDocument();
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
    await screen.findByText("Needs You");
    const lead = container.querySelector(".msg-headline")!;
    expect(lead).toHaveTextContent("Ridgeley needs the waiver by Friday.");
    const from = container.querySelector(".msg-from")!;
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
    expect(await screen.findByText("Needs You")).toBeInTheDocument();
    expect(screen.getByText("The Sweep")).toBeInTheDocument();
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
