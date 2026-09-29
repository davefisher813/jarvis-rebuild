// SPEC: BRAIN "FILE IT" ON AN EMAIL THREAD (2026-09-29).
// @vitest-environment jsdom
import "../shared/tiptapTest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useProfile, useOptionalBrainMemory } from "../data/NotesProvider";
import { GOOGLE_SCOPES } from "../connections/google/config";
import type { GoogleApi } from "../connections/google/api";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { AIService } from "../ai/AIService";
import type { GmailMeta, GmailThreadMeta } from "../connections/google/map";
import type { BrainMemoryService } from "../ai/brainMemoryService";
import MessagesFlow from "./MessagesFlow";
import { resetOutboxForTest } from "./outbox";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";

const gate = vi.hoisted(() => ({ brainOff: false }));
vi.mock("../data/NotesProvider", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../data/NotesProvider")>();
  return { ...mod, useOptionalBrainMemory: () => (gate.brainOff ? null : mod.useOptionalBrainMemory()) };
});
const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a) }));

// AI is off, and a trap on fetch proves nothing on this path reaches for a model.
const noAI = new AIService({ available: false });
const fetchTrap = vi.fn();

const meta = (id: string, from: string, subject: string, snippet: string, dateMs: number): GmailMeta => ({
  id, snippet, labelIds: ["INBOX"], internalDate: String(dateMs),
  payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] },
});
const full = (id: string, threadId: string, from: string, subject: string, body: string, snippet = "") => ({
  id, threadId, snippet,
  payload: { mimeType: "text/plain", body: { data: btoa(body) },
    headers: [{ name: "From", value: from }, { name: "Subject", value: subject }, { name: "Date", value: "Mon" }, { name: "Message-ID", value: "<" + id + "@x>" }] },
});

interface Th { id: string; from: string; subject: string; rowSnippet: string; body: string; fullSnippet?: string }
const apiFor = (ths: Th[]) => makeFakeGoogleApi({
  listThreads: async () => ths.map((t): GmailThreadMeta => ({ id: t.id, messages: [meta("m-" + t.id, t.from, t.subject, t.rowSnippet, 100)] })),
  getThread: async (id: string) => {
    const t = ths.find((x) => x.id === id)!;
    return { id, messages: [full("m-" + id, id, t.from, t.subject, t.body, t.fullSnippet ?? "")] };
  },
});

let brainRef: BrainMemoryService | null = null;
function Grab() { brainRef = useOptionalBrainMemory(); return null; }

function OneAccount({ api, user, children }: { api: GoogleApi; user: string; children: React.ReactNode }) {
  return (
    <NotesProvider userId={user}>
      <Grab />
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>{children}</GoogleSessionProvider>
    </NotesProvider>
  );
}

function TwoAccounts({ apiOf, children }: { apiOf: (email: string) => GoogleApi; children: React.ReactNode }) {
  const profile = useProfile();
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    const seed = [
      { email: "a@x.com", mail: true, cal: true, scopes: GOOGLE_SCOPES },
      { email: "b@x.com", mail: true, cal: true, scopes: GOOGLE_SCOPES },
    ];
    void profile.save({ googleAccounts: seed }).then(() => setSeeded(true));
  }, [profile]);
  if (!seeded) return null;
  return (
    <GoogleSessionProvider
      broker={{ authorize: async () => ({ token: "t-a@x.com", email: "a@x.com" }), silent: async (email) => ({ ok: true, token: "t-" + email, email, expiresAt: Date.now() + 3600e3, remembered: true, status: 200 }) }}
      makeApi={(_token, email) => apiOf(email ?? "a@x.com")}
    >
      {children}
    </GoogleSessionProvider>
  );
}

const WAIVER: Th = { id: "t1", from: "Ridgeley <t@x.com>", subject: "Waiver", rowSnippet: "Haven&#39;t seen it yet", body: "Haven't seen it yet. Please send the waiver." };

beforeEach(() => { localStorage.clear(); resetOutboxForTest(); showToast.mockReset(); fetchTrap.mockReset(); vi.stubGlobal("fetch", fetchTrap); gate.brainOff = false; brainRef = null; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function openDetail(th: Th = WAIVER, user = "u-emailfile-" + Math.random().toString(36).slice(2)) {
  const view = render(<OneAccount api={apiFor([th])} user={user}><MessagesFlow ai={noAI} configured /></OneAccount>);
  fireEvent.click(await screen.findByText("Connect Google"));
  fireEvent.click(await screen.findByText(th.from.split(" <")[0]!));
  await screen.findByLabelText("Archive");
  return view;
}
const box = () => screen.getByLabelText("What to Remember") as HTMLTextAreaElement;
const facts = async () => brainRef!.listByCategory("fact");

describe("email File It", () => {
  it("sits beside Archive and Delete in the thread bar, apart from Who Is This?", async () => {
    await openDetail();
    const file = screen.getByRole("button", { name: "File It" });
    const bar = file.closest(".nav-actions")!;
    expect(bar).toContainElement(screen.getByLabelText("Archive"));
    expect(bar).toContainElement(screen.getByLabelText("Delete"));
    expect(file.closest(".msg-more-row")).toBeNull();
  });

  it("shows no button at all when the Brain service does not exist", async () => {
    gate.brainOff = true;
    await openDetail();
    expect(screen.queryByRole("button", { name: "File It" })).toBeNull();
    expect(screen.getByLabelText("Archive")).toBeInTheDocument();
  });

  it("opens the one filing sheet, remember mode, with subject, a blank line and the snippet decoded", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "File It" }));
    expect(await screen.findByText("Remember This", { selector: ".eyebrow" })).toBeInTheDocument();
    expect(box().value).toBe("Waiver\n\nHaven't seen it yet");
    expect(document.querySelectorAll(".sheet-scrim")).toHaveLength(1);
    // Philosophy, Value and Fact are all on offer.
    for (const k of ["Philosophy", "Value", "Fact"]) expect(screen.getByRole("radio", { name: k })).toBeInTheDocument();
  });

  it("prefers the fetched latest message's snippet, and falls back to plain body text", async () => {
    await openDetail({ ...WAIVER, rowSnippet: "old row text", fullSnippet: "Fresh &amp; current" });
    fireEvent.click(screen.getByRole("button", { name: "File It" }));
    expect((await screen.findByLabelText("What to Remember") as HTMLTextAreaElement).value).toBe("Waiver\n\nFresh & current");
  });

  it("derives plain text from the message when neither snippet is there, never HTML", async () => {
    await openDetail({ ...WAIVER, rowSnippet: "", body: "Line one of the message.\nLine two." });
    fireEvent.click(screen.getByRole("button", { name: "File It" }));
    expect((await screen.findByLabelText("What to Remember") as HTMLTextAreaElement).value).toBe("Waiver\n\nLine one of the message.\nLine two.");
    expect(box().value).not.toMatch(/<[a-z]/i);
  });

  it("files source email with no linked ids (a Gmail id is not an entity here), and Undo removes it", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "File It" }));
    await screen.findByLabelText("What to Remember");
    fireEvent.click(screen.getByRole("radio", { name: "Value" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await brainRef!.listByCategory("value")).toHaveLength(1));
    const row = (await brainRef!.listByCategory("value"))[0]!;
    expect(row.data.source).toBe("email");
    expect(row.data.linkedItemIds).toBeUndefined();
    expect(JSON.stringify(row.data)).not.toContain("t1");
    await waitFor(() => expect(screen.queryByLabelText("What to Remember")).toBeNull());
    const undo = showToast.mock.calls.map((c) => c[0] as { actionLabel?: string; onAction?: () => void }).find((c) => c.actionLabel === "Undo")!;
    undo.onAction!();
    await waitFor(async () => expect(await brainRef!.listByCategory("value")).toHaveLength(0));
    expect(fetchTrap).not.toHaveBeenCalled();
  });

  it("Cancel and a tap outside write nothing", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "File It" }));
    await screen.findByLabelText("What to Remember");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByLabelText("What to Remember")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "File It" }));
    await screen.findByLabelText("What to Remember");
    fireEvent.click(document.querySelector(".sheet-scrim")!);
    await waitFor(() => expect(screen.queryByLabelText("What to Remember")).toBeNull());
    expect(await facts()).toHaveLength(0);
  });

  it("a failed save keeps the edits; a double tap files once", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "File It" }));
    await screen.findByLabelText("What to Remember");
    fireEvent.change(box(), { target: { value: "my edit" } });
    vi.spyOn(brainRef!, "file").mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: WRITE_FAILED_MESSAGE }));
    expect(box().value).toBe("my edit");
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByLabelText("What to Remember")).toBeNull());
    expect(await facts()).toHaveLength(1);
  });

  it("leaving the thread closes the sheet, and it does not resurface when a thread is opened again", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "File It" }));
    await screen.findByLabelText("What to Remember");
    fireEvent.click(screen.getByText("Email", { selector: ".nav-back" }));
    await screen.findByText("Ridgeley");
    expect(screen.queryByLabelText("What to Remember")).toBeNull();
    fireEvent.click(screen.getByText("Ridgeley"));
    await screen.findByLabelText("Archive");
    expect(screen.queryByLabelText("What to Remember")).toBeNull();
    expect(await facts()).toHaveLength(0);
  });

  it("with two accounts, the sheet opens on the thread of the account you are reading", async () => {
    const a: Th = { id: "ta1", from: "Alpha <a@y.com>", subject: "Alpha Subject", rowSnippet: "from account a", body: "a body" };
    const b: Th = { id: "tb1", from: "Beta <b@y.com>", subject: "Beta Subject", rowSnippet: "from account b", body: "b body" };
    const apis: Record<string, GoogleApi> = { "a@x.com": apiFor([a]), "b@x.com": apiFor([b]) };
    render(
      <NotesProvider userId="u-emailfile-two">
        <Grab />
        <TwoAccounts apiOf={(e) => apis[e]!}><MessagesFlow ai={noAI} configured /></TwoAccounts>
      </NotesProvider>,
    );
    fireEvent.click(await screen.findByText("Beta"));
    await screen.findByLabelText("Archive");
    fireEvent.click(screen.getByRole("button", { name: "File It" }));
    expect((await screen.findByLabelText("What to Remember") as HTMLTextAreaElement).value).toBe("Beta Subject\n\nfrom account b");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await facts()).toHaveLength(1));
    expect((await facts())[0]!.data).toMatchObject({ source: "email", text: "Beta Subject\n\nfrom account b" });
  });
});
