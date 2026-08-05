// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { AIService } from "../ai/AIService";
import type { GmailMeta, GmailThreadMeta } from "../connections/google/map";
import MessagesFlow from "./MessagesFlow";

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
    msg("m1", "Tucci <t@x.com>", "Waiver", "Need the waiver by Friday", ["INBOX"], 100),
    msg("m2", "Tucci <t@x.com>", "Re: Waiver", "Haven't seen it yet", ["INBOX", "UNREAD"], 300),
  ] },
  { id: "t2", messages: [msg("m3", "DoorDash <no@dd.com>", "20% off", "Order now", ["INBOX"], 200)] },
];

const fullThread = {
  id: "t1",
  messages: [
    { id: "m1", threadId: "t1", snippet: "", payload: { mimeType: "text/plain", body: { data: btoa("Need the waiver by Friday") },
      headers: [{ name: "From", value: "Tucci <t@x.com>" }, { name: "Subject", value: "Waiver" }, { name: "Date", value: "Mon" }, { name: "Message-ID", value: "<a@x>" }] } },
    { id: "m2", threadId: "t1", snippet: "", payload: { mimeType: "text/plain", body: { data: btoa("Haven't seen it yet") },
      headers: [{ name: "From", value: "Tucci <t@x.com>" }, { name: "Subject", value: "Re: Waiver" }, { name: "Date", value: "Thu" }, { name: "Message-ID", value: "<b@x>" }] } },
  ],
};

function makeApi(o: Parameters<typeof makeFakeGoogleApi>[0] = {}) {
  return makeFakeGoogleApi({
    listThreads: async () => THREADS,
    getThread: async () => fullThread,
    ...o,
  });
}

function wrap(node: React.ReactNode, api = makeApi()) {
  return (
    <NotesProvider userId="u1">
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>{node}</GoogleSessionProvider>
    </NotesProvider>
  );
}

beforeEach(() => localStorage.clear());

describe("MessagesFlow (threads)", () => {
  it("connects and lists threads: latest sender's voice, first message's subject, count", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    expect(await screen.findByText("Tucci")).toBeInTheDocument();
    expect(screen.getByText(/Waiver · 2/)).toBeInTheDocument(); // subject without Re:, with count
    expect(screen.getByText("DoorDash")).toBeInTheDocument();
  });

  it("without AI there is no fake triage: no headline, no buckets, threads newest-first", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("Tucci");
    expect(screen.queryByText(/needs? you/i)).toBeNull();
    expect(screen.queryByText("Noise")).toBeNull();
    const names = screen.getAllByText(/^(Tucci|DoorDash)$/).map((n) => n.textContent);
    expect(names).toEqual(["Tucci", "DoorDash"]); // t1 latest msg 300 > t2 200
  });

  it("with AI, one triage pass buckets the inbox with gists and the honest headline", async () => {
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "needs_you", gist: "Tucci needs the waiver by Friday." },
      { id: "t2", bucket: "noise", gist: "DoorDash promo." },
    ]));
    render(wrap(<MessagesFlow ai={ai} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    expect(await screen.findByText("Needs You")).toBeInTheDocument();
    expect(screen.getByText("1 needs you. The rest is handled.")).toBeInTheDocument();
    expect(screen.getByText(/Tucci needs the waiver by Friday/)).toBeInTheDocument();
    // THE FOLD: everything that does not need him is one line, not a section.
    expect(screen.getByText("The rest · 1")).toBeInTheDocument();
    expect(screen.queryByText("Noise")).toBeNull();
    expect(screen.queryByText("1 automated email")).toBeNull();
    // It expands in place, and noise inside it is still collapsed to a count.
    fireEvent.click(screen.getByText("The rest · 1"));
    expect(screen.getByText("Noise")).toBeInTheDocument();
    expect(screen.getByText("1 automated email")).toBeInTheDocument();
    expect(screen.queryByText(/DoorDash promo/)).toBeNull();
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
    fireEvent.click(await screen.findByText("The rest · 1"));
    fireEvent.click(await screen.findByText("Archive All"));
    await waitFor(() => expect(archived).toEqual(["t2"]));
    expect(screen.getByText("1 conversation archived")).toBeInTheDocument();
    expect(screen.queryByText("Noise")).toBeNull();
    expect(screen.getByText(/Tucci/)).toBeInTheDocument(); // needs_you untouched
  });

  it("opens a thread: every message shown, thread marked read", async () => {
    let readCleared: string | null = null;
    const api = makeApi({ modifyThread: async (id, _a, remove) => { if (remove.includes("UNREAD")) readCleared = id; } });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Tucci"));
    expect(await screen.findByText("Need the waiver by Friday")).toBeInTheDocument();
    expect(screen.getByText("Haven't seen it yet")).toBeInTheDocument();
    expect(screen.getByText("2 messages")).toBeInTheDocument();
    await waitFor(() => expect(readCleared).toBe("t1"));
  });

  it("reply targets the LAST message in the thread", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Tucci"));
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
    await screen.findByText("Tucci");
    fireEvent.change(screen.getByPlaceholderText("Search all mail"), { target: { value: "llc" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Search all mail"), { key: "Enter" });
    expect(await screen.findByText("Sarah")).toBeInTheDocument();
    expect(q).toBe("llc");
    expect(screen.queryByText("Tucci")).toBeNull(); // results replace the list
    fireEvent.change(screen.getByPlaceholderText("Search all mail"), { target: { value: "" } });
    expect(await screen.findByText("Tucci")).toBeInTheDocument(); // clearing restores
  });

  it("triage failure lands on a calm state, never the wall and never an invented sort", async () => {
    const ai = aiReturning("I refuse to answer with JSON today.");
    render(wrap(<MessagesFlow ai={ai} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    // The law: a failed sort must not dump the raw list back on him.
    expect(await screen.findByText("Couldn’t sort your mail")).toBeInTheDocument();
    expect(screen.queryByText("Tucci")).toBeNull();
    expect(screen.queryByText("Needs You")).toBeNull();
    expect(screen.queryByText("Noise")).toBeNull();
    // One way out, and he chooses it.
    fireEvent.click(screen.getByText("Show All Mail"));
    expect(await screen.findByText("Tucci")).toBeInTheDocument();
  });

  it("a triage request that hangs is not allowed to trap the user", async () => {
    const hanging = new AIService({
      available: true,
      getToken: () => "tok",
      fetchImpl: (() => new Promise(() => {})) as unknown as typeof fetch,
    });
    render(wrap(<MessagesFlow ai={hanging} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("Reading your inbox");
    // The exit is on screen while it is still trying, not only after failure.
    fireEvent.click(screen.getByText("Show all mail instead"));
    expect(await screen.findByText("Tucci")).toBeInTheDocument();
  });

  it("while triage is still running, For You is a calm state and never the wall", async () => {
    const pending = new AIService({
      available: true,
      getToken: () => "tok",
      fetchImpl: (() => new Promise(() => {})) as unknown as typeof fetch,
    });
    render(wrap(<MessagesFlow ai={pending} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    expect(await screen.findByText("Reading your inbox")).toBeInTheDocument();
    expect(screen.queryByText("Tucci")).toBeNull();
    expect(screen.queryByText("DoorDash")).toBeNull();
  });

  it("a thread that has needed him for days is caught by the net, exactly once", async () => {
    // Pretend this inbox has been seen before: the first run deliberately
    // absorbs the backlog instead of dumping it into the task list.
    localStorage.setItem("jarvis.mail.netted.seeded.v1", "1");
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "needs_you", gist: "Tucci needs the waiver by Friday." },
      { id: "t2", bucket: "noise", gist: "DoorDash promo." },
    ]));
    const { unmount } = render(wrap(<MessagesFlow ai={ai} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    expect(await screen.findByText(/moved to your tasks/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("jarvis.mail.netted.v1") || "[]")).toContain("t1");
    unmount();

    // Second run of the app: the thread is already netted, so nothing is
    // created again and there is no receipt to show. Nagging is the failure
    // mode this feature exists to avoid.
    render(wrap(<MessagesFlow ai={ai} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    expect(await screen.findByText("The rest · 1")).toBeInTheDocument();
    expect(screen.queryByText(/moved to your tasks/)).toBeNull();
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
    fireEvent.click(await screen.findByText("Tucci"));
    fireEvent.click(await screen.findByLabelText("Delete"));
    await waitFor(() => expect(trashed).toEqual(["t1"]));
    expect(permanentDeleteCalled).toBe(false);
    expect(await screen.findByText(/trash for 30 days/)).toBeInTheDocument();
    expect(screen.queryByText("Tucci")).toBeNull(); // gone from the list too
  });

  it("swipe actions exist on every mail row: archive and delete", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("Tucci");
    // Two rows, each with its own pair of actions.
    expect(screen.getAllByLabelText("Archive")).toHaveLength(2);
    expect(screen.getAllByLabelText("Delete")).toHaveLength(2);
  });

  it("archiving from the list needs no thread open", async () => {
    const archived: string[] = [];
    const api = makeApi({ modifyThread: async (id, _a, remove) => { if (remove.includes("INBOX")) archived.push(id); } });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("Tucci");
    fireEvent.click(screen.getAllByLabelText("Archive")[0]!);
    await waitFor(() => expect(archived).toEqual(["t1"]));
    expect(screen.queryByText("Tucci")).toBeNull();
  });

  it("only one offer can be on screen at a time", async () => {
    const ai = aiReturning(JSON.stringify([
      { id: "t1", bucket: "needs_you", gist: "g" },
      { id: "t2", bucket: "noise", gist: "promo" },
    ]));
    // This sender is already over the self-cleaning threshold, and Archive All
    // arms the auto-noise offer. Both want the same slot.
    localStorage.setItem("jarvis.mail.tossed.v1", JSON.stringify({ "no@dd.com": 4 }));
    render(wrap(<MessagesFlow ai={ai} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("The rest · 1"));
    fireEvent.click(await screen.findByText("Archive All"));
    expect(await screen.findByText(/Send them straight to Noise/)).toBeInTheDocument();
    expect(screen.queryByText("Clear Noise Automatically From Now On")).toBeNull();
  });

  it("archive can be undone from the toast", async () => {
    const calls: string[] = [];
    const api = makeApi({ modifyThread: async (id, add, remove) => {
      if (remove.includes("INBOX")) calls.push("archive:" + id);
      if (add.includes("INBOX")) calls.push("restore:" + id);
    } });
    render(wrap(<MessagesFlow ai={noAI} configured />, api));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("Tucci");
    fireEvent.click(screen.getAllByLabelText("Archive")[0]!);
    await waitFor(() => expect(calls).toContain("archive:t1"));
    expect(screen.queryByText("Tucci")).toBeNull();
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(calls).toContain("restore:t1"));
    expect(await screen.findByText("Tucci")).toBeInTheDocument();
  });

  it("a muted thread never comes back, and the rules screen can unmute it", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("Tucci"));
    fireEvent.click(await screen.findByText("Mute this thread"));
    await waitFor(() => expect(screen.queryByText("Tucci")).toBeNull());
    expect(screen.getByText("DoorDash")).toBeInTheDocument(); // only that thread
    fireEvent.click(screen.getByText("Standing rules"));
    fireEvent.click(await screen.findByText("Unmute"));
    fireEvent.click(screen.getByText("Email"));
    expect(await screen.findByText("Tucci")).toBeInTheDocument();
  });

  it("composes and sends", async () => {
    render(wrap(<MessagesFlow ai={noAI} configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByLabelText("New message"));
    fireEvent.change(screen.getByPlaceholderText("To"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(screen.getByText("Sent")).toBeInTheDocument());
  });

  it("shows an honest setup state when unconfigured", () => {
    render(wrap(<MessagesFlow ai={noAI} configured={false} />));
    expect(screen.getByText("Email setup required")).toBeInTheDocument();
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
    await waitFor(() => expect(deleted).toBe("d1"));
  });
});
