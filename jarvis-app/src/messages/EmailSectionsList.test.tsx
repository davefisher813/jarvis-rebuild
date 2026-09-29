// SPEC: EMAIL SECTIONS ON THE EMAIL TAB (2026-09-29): saved local filters
// beside the three AI buckets. Using one is a filter over loaded mail: no AI
// call, no Gmail call, and every thread keeps the bucket the sort gave it.
// @vitest-environment jsdom
import "../shared/tiptapTest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useProfile } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { AIService } from "../ai/AIService";
import type { GmailMeta, GmailThreadMeta } from "../connections/google/map";
import type { ProfileService } from "../profile/ProfileService";
import MessagesFlow from "./MessagesFlow";
import { resetOutboxForTest } from "./outbox";
import { newSectionId, type EmailSection } from "./emailSections";

const meta = (id: string, from: string, subject: string, snippet: string, dateMs: number): GmailMeta => ({
  id, snippet, labelIds: ["INBOX"], internalDate: String(dateMs),
  payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] },
});
const thread = (id: string, from: string, subject: string, snippet: string, dateMs: number): GmailThreadMeta => ({
  id, messages: [meta("m-" + id, from, subject, snippet, dateMs)],
});

const THREADS: GmailThreadMeta[] = [
  thread("t1", "Ridgeley <t@x.com>", "Waiver", "Need the waiver by Friday", 300),
  thread("t2", "DoorDash <no@dd.com>", "Your receipt", "Order total $20", 200),
  thread("t3", "Marco Rossi <marco@northlake.org>", "Lunch", "Waiver of fees for Thursday", 100),
];

let aiCalls = 0;
const aiFor = (buckets: Record<string, string>) => new AIService({
  available: true,
  getToken: () => "tok",
  fetchImpl: (async () => {
    aiCalls++;
    const text = JSON.stringify(Object.entries(buckets).map(([id, bucket]) => ({ id, bucket, gist: id + " gist" })));
    return { ok: true, status: 200, json: async () => ({ text }), text: async () => "" };
  }) as unknown as typeof fetch,
});
const noAI = new AIService({ available: false });

const sec = (name: string, ...m: [("sender" | "subject"), string][]): EmailSection => ({
  id: newSectionId(), name, matchers: m.map(([field, text]) => ({ field, text })),
});

let profileRef: ProfileService | null = null;
function Grab() { profileRef = useProfile(); return null; }

const mutations = { modifyThread: vi.fn(), trashThread: vi.fn(), untrashThread: vi.fn(), modifyMessage: vi.fn(), sendMessage: vi.fn(), createDraft: vi.fn(), updateDraft: vi.fn(), deleteDraft: vi.fn() };
const listMax: number[] = [];
const apiWith = (threads: GmailThreadMeta[]) => makeFakeGoogleApi({
  listThreads: async (max: number) => { listMax.push(max); return threads.slice(0, max); },
  ...mutations,
});

async function openEmail(sections: EmailSection[], ai: AIService, threads = THREADS) {
  const user = "u-esec-" + Math.random().toString(36).slice(2);
  const api = apiWith(threads);
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(profileRef).toBeTruthy());
  if (sections.length) await profileRef!.save({ emailSections: sections });
  view.rerender(
    <NotesProvider userId={user}><Grab />
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}><MessagesFlow ai={ai} configured /></GoogleSessionProvider>
    </NotesProvider>,
  );
  fireEvent.click(await screen.findByText("Connect Google"));
  return { view, api };
}
const bar = () => screen.queryByRole("group", { name: "Sections" });
const chip = (name: string) => within(bar()!).getByRole("button", { name });
const rowsText = () => Array.from(document.querySelectorAll(".mrow .mfrom")).map((e) => e.textContent);

beforeEach(() => {
  localStorage.clear(); resetOutboxForTest(); aiCalls = 0; listMax.length = 0; profileRef = null;
  Object.values(mutations).forEach((m) => m.mockReset());
});
afterEach(() => vi.restoreAllMocks());

describe("section chips", () => {
  it("draw nothing at all when no section exists", async () => {
    await openEmail([], noAI);
    await screen.findByText("Ridgeley");
    expect(bar()).toBeNull();
    expect(rowsText()).toEqual(["Ridgeley", "DoorDash", "Marco Rossi"]);
  });

  it("appear as All plus one chip per section once one exists", async () => {
    await openEmail([sec("Forms", ["subject", "waiver"]), sec("Team", ["sender", "marco"])], noAI);
    await screen.findByText("Ridgeley");
    await waitFor(() => expect(bar()).toBeTruthy());
    expect(chip("All Sections")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Forms")).toBeInTheDocument();
    expect(chip("Team")).toBeInTheDocument();
  });

  it("filter the loaded list by the saved matchers and All brings it back", async () => {
    await openEmail([sec("Forms", ["subject", "waiver"]), sec("Team", ["sender", "marco"])], noAI);
    await screen.findByText("Ridgeley");
    await waitFor(() => expect(bar()).toBeTruthy());
    fireEvent.click(chip("Forms"));
    // Subject or preview: t1's subject and t3's snippet.
    expect(rowsText()).toEqual(["Ridgeley", "Marco Rossi"]);
    expect(chip("Forms")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip("Team"));
    expect(rowsText()).toEqual(["Marco Rossi"]);
    fireEvent.click(chip("All Sections"));
    expect(rowsText()).toEqual(["Ridgeley", "DoorDash", "Marco Rossi"]);
  });

  it("a thread in two sections shows once in each and never twice in one", async () => {
    await openEmail([sec("Forms", ["subject", "waiver"]), sec("Team", ["sender", "marco"])], noAI);
    await screen.findByText("Ridgeley");
    await waitFor(() => expect(bar()).toBeTruthy());
    // t3 matches Forms (its snippet) and Team (its sender).
    fireEvent.click(chip("Forms"));
    expect(rowsText().filter((n) => n === "Marco Rossi")).toHaveLength(1);
    fireEvent.click(chip("Team"));
    expect(rowsText().filter((n) => n === "Marco Rossi")).toHaveLength(1);
  });

  it("a thread keeps the AI bucket the sort gave it inside a section", async () => {
    await openEmail([sec("Everyone", ["sender", "@"])], aiFor({ t1: "needs_you", t2: "noise", t3: "worth_knowing" }));
    await screen.findByRole("tab", { name: /Needs You/ });
    await waitFor(() => expect(bar()).toBeTruthy());
    fireEvent.click(chip("Everyone"));
    // Needs You still holds t1, and the fold still holds the other two.
    expect(screen.getByText(/t1 gist/)).toBeInTheDocument();
    expect(screen.queryByText(/t2 gist/)).toBeNull();
    fireEvent.click(screen.getByText("The Rest"));
    expect(screen.getByText("Worth Knowing")).toBeInTheDocument();
    expect(screen.getByText(/t3 gist/)).toBeInTheDocument();
    expect(screen.getByText("Noise")).toBeInTheDocument();
  });

  it("narrow each bucket to the section: a section with only a noise thread shows no Needs You", async () => {
    await openEmail([sec("Receipts", ["sender", "doordash"])], aiFor({ t1: "needs_you", t2: "noise", t3: "worth_knowing" }));
    await screen.findByRole("tab", { name: /Needs You/ });
    await waitFor(() => expect(bar()).toBeTruthy());
    fireEvent.click(chip("Receipts"));
    expect(screen.queryByRole("tab", { name: /Needs You/ })).toBeNull();
    expect(screen.queryByText(/t1 gist/)).toBeNull();
    fireEvent.click(screen.getByText("The Rest"));
    expect(screen.getByText("Noise")).toBeInTheDocument();
  });

  it("choosing a section makes no AI call and no Gmail call of any kind", async () => {
    const { api } = await openEmail([sec("Forms", ["subject", "waiver"]), sec("Team", ["sender", "marco"])], aiFor({ t1: "needs_you", t2: "noise", t3: "worth_knowing" }));
    await screen.findByRole("tab", { name: /Needs You/ });
    await waitFor(() => expect(bar()).toBeTruthy());
    const ai0 = aiCalls;
    expect(ai0, "the sort itself did call the model, so the counter is live").toBeGreaterThan(0);
    const lists0 = listMax.length;
    const getThread = vi.spyOn(api, "getThread");
    for (const name of ["Forms", "Team", "All Sections", "Forms"]) fireEvent.click(chip(name));
    expect(aiCalls).toBe(ai0);
    expect(listMax.length).toBe(lists0);
    expect(getThread).not.toHaveBeenCalled();
    for (const [name, fn] of Object.entries(mutations)) expect(fn, name).not.toHaveBeenCalled();
  });

  it("changing section clears a selection made under the last one", async () => {
    await openEmail([sec("Receipts", ["sender", "doordash"])], aiFor({ t1: "needs_you", t2: "worth_knowing", t3: "worth_knowing" }));
    fireEvent.click(await screen.findByText("The Rest"));
    fireEvent.click(await screen.findByText("Select"));
    fireEvent.click(screen.getByText(/t2 gist/));
    expect(screen.getByText("Archive 1")).toBeInTheDocument();
    await waitFor(() => expect(bar()).toBeTruthy());
    fireEvent.click(chip("Receipts"));
    expect(screen.queryByText("Archive 1")).toBeNull();
    expect(screen.queryByLabelText("Picked")).toBeNull();
    expect(mutations.modifyThread).not.toHaveBeenCalled();
  });
});

describe("a section with no matches", () => {
  const many = Array.from({ length: 30 }, (_, i) => thread("f" + i, "Sender" + i + " <s" + i + "@x.com>", "Note " + i, "hello " + i, 1000 - i));

  it("says No Matches in Loaded Mail and keeps Load More while Gmail has more pages", async () => {
    await openEmail([sec("Nothing", ["subject", "zzz-not-here"])], noAI, many);
    await screen.findByText("Sender0");
    await waitFor(() => expect(bar()).toBeTruthy());
    fireEvent.click(chip("Nothing"));
    expect(screen.getByText("No Matches in Loaded Mail")).toBeInTheDocument();
    const before = listMax.length;
    fireEvent.click(screen.getByRole("button", { name: "Load More" }));
    await waitFor(() => expect(listMax.length).toBeGreaterThan(before));
    expect(Math.max(...listMax)).toBeGreaterThan(30);
    // The way back is on the card too.
    fireEvent.click(screen.getByRole("button", { name: "Show All Mail" }));
    await waitFor(() => expect(screen.queryByText("No Matches in Loaded Mail")).toBeNull());
    expect(chip("All Sections")).toHaveAttribute("aria-pressed", "true");
  });

  it("says plain No Matches, with no Load More, once every page is in", async () => {
    await openEmail([sec("Nothing", ["subject", "zzz-not-here"])], noAI);
    await screen.findByText("Ridgeley");
    await waitFor(() => expect(bar()).toBeTruthy());
    fireEvent.click(chip("Nothing"));
    expect(screen.getByText("No Matches")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load More" })).toBeNull();
  });
});
