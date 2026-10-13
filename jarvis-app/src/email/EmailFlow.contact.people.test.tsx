// @vitest-environment jsdom
// THE CONTACT SHEET READS THE APP'S OWN PEOPLE STORE, AFRESH EACH TIME (issue 112, item 14; AC10: a contact renamed or removed
// is current the next time, and a store that cannot be read is never taken for an empty one). The other contact tests hand the
// flow its contacts; this one lets the flow find its own, through the same optional accessor the shell provides
// (data/NotesProvider useOptionalPeople), here answered by a fake service so each read can be counted, held back and refused.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom";

const svc = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../data/NotesProvider", async (importOriginal) => ({ ...(await importOriginal<typeof import("../data/NotesProvider")>()), useOptionalPeople: () => svc }));

import EmailFlow from "./EmailFlow";
import type { EmailAccount, InboxRow, RpcClient } from "./emailClient";
import type { Category } from "../categories/types";
import type { Person } from "../people/types";

const NOW = new Date("2026-10-13T15:00:00Z");
const DAVE = "dave@example.test";
const MAYA = "maya@example.test";
const ACCOUNT: EmailAccount = { id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-13T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true }, connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 1, signature_text: "", signature_revision: 1 };
const ROW: InboxRow = {
  id: "u-m1", account_id: "acct-dave", account: DAVE, provider_id: "m1", thread_id: "t-m1", internal_date: "2026-10-13T12:00:00Z", from_address: MAYA, from_name: "Maya C.",
  subject: "Lunch on Friday", snippet: "Thanks for the update", has_body: true, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh", read: true,
};
const AREAS: Category[] = [{ id: "c-family", data: { name: "Family", color: "green", order: 0 } }];
const maya = (name: string, categoryIds: string[] = ["c-family"]): Person => ({ id: "p-maya", data: { name, group: "contacts", email: MAYA, categoryIds } });

const client: RpcClient = {
  rpc: async (fn) => {
    const table: Record<string, unknown> = {
      email_accounts: [ACCOUNT], email_inbox: { rows: [ROW], cached_total: 1, page: 30 }, email_search_cached: { rows: [ROW], coverage: "cached", q: MAYA, window: 1 },
      substrate_readiness: { registered: [] }, candidates_for: [], candidate_review_count: { count: 0, messages: 0 }, draft_list: { drafts: [], sent: [] },
    };
    return fn in table ? { data: table[fn], error: null } : { data: null, error: { code: "PGRST202", message: "no fake for " + fn } };
  },
};

const mount = (extra: Partial<Parameters<typeof EmailFlow>[0]> = {}) =>
  render(<EmailFlow client={client} token="jwt" userId="user-1" categories={AREAS} now={() => NOW} onOpenConnections={() => {}} onOpenEntity={() => {}} {...extra} />);
const words = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s/g, " ").trim();
const sheet = () => [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.getAttribute("aria-label") ?? "").startsWith("Contact ")) as HTMLElement | undefined;
const head = () => sheet()!.querySelector(".email-head")!;
const facts = () => [...head().querySelectorAll(".fact")].map((f) => words(f));
const tapCircle = async () => {
  await waitFor(() => expect(document.querySelector(".erow button.mav")).toBeTruthy());
  fireEvent.click(document.querySelector(".erow button.mav")!);
  await waitFor(() => expect(sheet()).toBeTruthy());
};
const done = () => fireEvent.click(within(document.body).getByRole("button", { name: "Done" }));

beforeEach(() => {
  localStorage.clear();
  svc.list.mockReset();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, synced: 0, removed: 0, next_page: null, complete: true, resynced: false }) }) as Response));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the app's People store", () => {
  it("is read when the sheet opens and read again the next time: a rename shows, and a removal falls back to Not in Contacts", async () => {
    svc.list.mockResolvedValueOnce([maya("Maya Chen")]);
    mount();
    await waitFor(() => expect(document.querySelector(".erow")).toBeTruthy());
    expect(svc.list).not.toHaveBeenCalled();
    await tapCircle();
    await waitFor(() => expect(words(head().querySelector(".email-from-name"))).toBe("Maya Chen"));
    expect(facts()).toEqual([MAYA, "Family"]);
    expect(svc.list).toHaveBeenCalledTimes(1);
    done();

    svc.list.mockResolvedValueOnce([maya("Maya Chen-Ortiz", [])]);
    await tapCircle();
    await waitFor(() => expect(words(head().querySelector(".email-from-name"))).toBe("Maya Chen-Ortiz"));
    expect(facts()).toEqual([MAYA]);
    expect(svc.list).toHaveBeenCalledTimes(2);
    done();

    svc.list.mockResolvedValueOnce([]);
    await tapCircle();
    await waitFor(() => expect(facts()).toEqual([MAYA, "Not in Contacts"]));
    expect(words(head().querySelector(".email-from-name"))).toBe("Maya C.");
    expect(svc.list).toHaveBeenCalledTimes(3);
  });

  it("the sheet is up at once and says nothing about contacts until the store answers, then says what it found", async () => {
    let answer: (list: Person[]) => void = () => {};
    svc.list.mockReturnValueOnce(new Promise<Person[]>((resolve) => { answer = resolve; }));
    mount();
    await tapCircle();
    expect(words(sheet()!)).not.toMatch(/Not in Contacts|Choose Contact/);
    expect(facts()).toEqual([MAYA]);
    expect(within(sheet()!).queryByRole("button", { name: "Open Contact" })).toBeNull();
    await act(async () => { answer([maya("Maya Chen")]); });
    await waitFor(() => expect(facts()).toEqual([MAYA, "Family"]));
    expect(within(sheet()!).getByRole("button", { name: "Open Contact" })).toBeInTheDocument();
  });

  it("a store that cannot be read is not an empty one: the sheet never says Not in Contacts, and the sheet still works", async () => {
    svc.list.mockRejectedValueOnce(new Error("the store is down"));
    mount();
    await tapCircle();
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(words(sheet()!.querySelector(".sh2 .t"))).toBe("Recent Mail"));
    expect(words(sheet()!)).not.toMatch(/Not in Contacts|Choose Contact|Your Mailbox/);
    expect(facts()).toEqual([MAYA]);
    done();
    expect(sheet()).toBeUndefined();
  });

  it("contacts handed to the flow outrank the store, which is then not asked", async () => {
    mount({ people: [maya("Maya From The Prop")] });
    await tapCircle();
    expect(words(head().querySelector(".email-from-name"))).toBe("Maya From The Prop");
    expect(svc.list).not.toHaveBeenCalled();
  });

  it("nothing is read until the circle is tapped, and the list itself never waits on the store", async () => {
    svc.list.mockReturnValue(new Promise<Person[]>(() => {}));
    mount();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Maya C\./ }).length).toBeGreaterThan(0));
    expect(svc.list).not.toHaveBeenCalled();
    // A store that never answers leaves the sheet open and unjudged, and closeable.
    await tapCircle();
    expect(facts()).toEqual([MAYA]);
    done();
    expect(sheet()).toBeUndefined();
  });
});
