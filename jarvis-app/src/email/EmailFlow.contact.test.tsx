// @vitest-environment jsdom
// THE CONTACT SHEET ON THE SENDER'S CIRCLE, THROUGH THE REAL FLOW (issue 112, item 14; Email v1 spec 2.3 and 4, AC07, AC08, AC10).
// Against a fake session, through the real screens: the circle on a home row, on a search result, on a review row and in an open
// message's head each opens the sheet and never the message; the words of a row still open the message; the sheet says what the
// saved contacts say at the moment it opens (a rename or a delete is current the next time); its Recent Mail is mail FROM exactly
// that address, found in the cache, never mail that merely mentions it; and opening it writes nothing: no command, no save, no send.
// The words are written out here, not imported, so a rename of the copy constants cannot pass this by renaming both.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import EmailFlow from "./EmailFlow";
import { saveSnapshot } from "./deviceCache";
import type { EmailAccount, InboxRow, MessageDetail, RpcClient } from "./emailClient";
import { newestFirst } from "./emailClient";
import { resetToasts } from "../shared/toast";
import type { Category } from "../categories/types";
import type { Person } from "../people/types";

const NOW = new Date("2026-10-13T15:00:00Z");
const USER = "user-1";
const DAVE = "dave@example.test";
const MAYA = "maya@example.test";
const ALEX = "alex@example.test";

const ACCOUNT: EmailAccount = { id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-13T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true }, connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 4, signature_text: "", signature_revision: 1 };
const row = (id: string, iso: string, subject: string, o: Partial<InboxRow> = {}): InboxRow => ({
  id: `u-${id}`, account_id: "acct-dave", account: DAVE, provider_id: id, thread_id: `t-${id}`, internal_date: iso, from_address: MAYA, from_name: "Maya C.",
  subject, snippet: "Thanks for the update", has_body: true, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh", read: true, ...o,
});
// What the inbox page holds: two from Maya (saved), one from Alex (not saved), one from the person's own mailbox.
const INBOX: InboxRow[] = [
  row("m1", "2026-10-13T12:00:00Z", "Lunch on Friday"),
  row("a1", "2026-10-13T11:00:00Z", "Contract draft", { from_address: ALEX, from_name: "Alex Morgan" }),
  row("m2", "2026-10-12T09:00:00Z", "Roster update"),
  row("d1", "2026-10-11T09:00:00Z", "Reminder to self", { from_address: DAVE, from_name: "Dave Fisher" }),
];
// What the cache holds beyond that page: older mail from Maya and Alex, a message Maya's was trashed, and a decoy that is NOT from
// Maya but names her address in its subject and words (the cached search returns it for her address, and it must never be hers).
const CACHE_ONLY: InboxRow[] = [
  row("mold", "2026-09-20T09:00:00Z", "Old thread", { thread_id: "t-old" }),
  row("mtrash", "2026-10-01T09:00:00Z", "Trashed already", { provider_labels: ["TRASH"] }),
  row("decoy", "2026-10-13T13:00:00Z", `Please call ${MAYA} today`, { from_address: "boss@example.test", from_name: "The Boss", snippet: `cc ${MAYA}` }),
  row("aold", "2026-09-01T09:00:00Z", "Older contract", { from_address: ALEX, from_name: "Alex Morgan" }),
];
const AREAS: Category[] = [{ id: "c-family", data: { name: "Family", color: "green", order: 0 } }, { id: "c-bridge", data: { name: "Bridge", color: "sky", order: 1 } }];
const person = (id: string, name: string, o: Partial<Person["data"]> = {}): Person => ({ id, data: { name, group: "contacts", ...o } });
const P_MAYA = person("p-maya", "Maya Chen", { email: MAYA, emails: [{ value: MAYA }], categoryIds: ["c-family", "c-bridge"] });
const P_ME = person("p-dave", "Dave Fisher", { email: DAVE });
const PEOPLE: Person[] = [P_MAYA, P_ME, person("p-other", "Someone Else", { email: "else@example.test" })];

const detailOf = (r: InboxRow): MessageDetail => ({
  id: r.id, account_id: r.account_id, account: r.account, provider_id: r.provider_id, thread_id: r.thread_id, internal_date: r.internal_date, from_address: r.from_address, from_name: r.from_name,
  to_addresses: [{ address: DAVE, name: "" }], cc_addresses: [], subject: r.subject, snippet: r.snippet, provider_labels: r.provider_labels, read: r.read, deleted: false, source_hash: r.source_hash,
  attachments: [], has_body: true, text: "Thanks for the update, see you Friday.", html: null,
});

type Fn = (args: Record<string, unknown>) => unknown;
function rig(extra: Partial<Record<string, Fn>> = {}, inbox: InboxRow[] = INBOX) {
  const all = [...inbox].sort(newestFirst);
  const everything = [...inbox, ...CACHE_ONLY];
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const table: Record<string, Fn> = {
    email_accounts: () => [ACCOUNT],
    email_inbox: (a) => ({ rows: all.slice(0, a.p_limit as number), cached_total: all.length, page: a.p_limit }),
    email_message_read: (a) => { const r = everything.find((x) => x.id === a.p_message); return r ? detailOf(r) : { error: "NOT_FOUND" }; },
    // The server's own search: a literal substring over sender, name, subject and words, newest first, 50 at most.
    email_search_cached: (a) => {
      const q = String(a.p_q).toLowerCase();
      const hit = everything.filter((r) => [r.from_address, r.from_name, r.subject, r.snippet].some((t) => t.toLowerCase().includes(q))).sort(newestFirst);
      return { rows: hit.slice(0, 50), coverage: "cached", q: a.p_q, window: everything.length };
    },
    substrate_readiness: () => ({ registered: [] }),
    candidates_for: () => [],
    candidate_review_count: () => ({ count: 0, messages: 0 }),
    ...extra,
  };
  const client: RpcClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args: (args ?? {}) as Record<string, unknown> });
      const f = table[fn];
      if (!f) return { data: null, error: { code: "PGRST202", message: "no fake for " + fn } };
      return { data: f((args ?? {}) as Record<string, unknown>), error: null };
    },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    posts.push({ path: url, body });
    const answer = url.endsWith("/api/email/sync") ? { status: 200, body: { ok: true, synced: 0, removed: 0, next_page: null, complete: true, resynced: false } }
      : url.endsWith("/api/email/message") ? { status: 200, body: { ok: true, message_id: "x", labels: ["INBOX"], read: true, in_inbox: true, in_trash: false, receipt: null } }
        : url.endsWith("/api/email/search") ? { status: 200, body: { ok: true, q: `"${body.q}"`, rows: everything.filter((r) => r.subject.toLowerCase().includes(String(body.q).toLowerCase())), covered: [DAVE], failed: [], next_page: null, coverage: "provider" } }
          : { status: 404, body: { code: "NOT_FOUND" } };
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body } as Response;
  }));
  return { client, calls, posts };
}

const openEntity = vi.fn();
type Props = Partial<Parameters<typeof EmailFlow>[0]>;
const flow = (r: ReturnType<typeof rig>, extra: Props = {}) => (
  <EmailFlow client={r.client} token="jwt" userId={USER} categories={AREAS} people={PEOPLE} now={() => NOW} onOpenConnections={() => {}} onOpenEntity={openEntity} {...extra} />
);
const mount = (r: ReturnType<typeof rig>, extra: Props = {}) => render(flow(r, extra));

const words = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s/g, " ").trim();
const rowEls = () => [...document.querySelectorAll(".erow")] as HTMLElement[];
const rowOf = (subject: string) => rowEls().find((e) => (e.getAttribute("aria-label") ?? "").includes(subject))!;
const avatarOf = (subject: string) => rowOf(subject).querySelector("button.mav") as HTMLElement;
/** A message sheet is up: its own bar is on screen (portals, so never inside render's container). */
const messageUp = () => document.querySelector(".msg-sheet-bar") !== null;
const subjectUp = () => words(document.querySelector(".email-head .email-subject"));
const contactSheet = () => [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.getAttribute("aria-label") ?? "").startsWith("Contact ")) as HTMLElement | undefined;
const sheetHead = () => contactSheet()!.querySelector(".email-head")!;
const sheetFacts = () => [...sheetHead().querySelectorAll(".fact")].map((f) => words(f));
const recentRows = () => [...(contactSheet()?.querySelectorAll(".list-card-ruled .row") ?? [])] as HTMLElement[];
const recentSubjects = () => recentRows().map((r) => words(r.querySelector(".conn-name")));
const openSheet = async (subject: string) => {
  await waitFor(() => expect(avatarOf(subject)).toBeTruthy());
  fireEvent.click(avatarOf(subject));
  await waitFor(() => expect(contactSheet()).toBeTruthy());
};
const actionWords = () => [...document.querySelectorAll(".action-sheet button")].map((b) => words(b));
const searchFor = async (text: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.change(screen.getByPlaceholderText("Search Mail"), { target: { value: text } });
};
const written = (r: ReturnType<typeof rig>) => r.calls.filter((c) => !/^(email_accounts|email_inbox|email_message_read|email_search_cached|substrate_readiness|candidates_for|candidate_review_count|candidates_to_review|draft_list)$/.test(c.fn));

beforeEach(() => {
  localStorage.clear();
  resetToasts();
  openEntity.mockReset();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.classList.remove("selecting"); });

describe("the circle on a home row", () => {
  it("opens the contact sheet and not the message: the saved name and groups, the raw address, and mail from exactly that address", async () => {
    const r = rig();
    mount(r);
    await openSheet("Lunch on Friday");
    expect(messageUp()).toBe(false);
    expect(contactSheet()).toHaveAttribute("aria-label", `Contact ${MAYA}`);
    expect(words(sheetHead().querySelector(".email-from-name"))).toBe("Maya Chen");
    expect(sheetFacts()).toEqual([MAYA, "Family", "Bridge"]);
    expect(actionWords()).toEqual(["Open Contact", "Done"]);
    // What is loaded is there at once; the cache adds the older mail. The decoy that only names her, and the trashed one, are not hers.
    await waitFor(() => expect(recentSubjects()).toEqual(["Lunch on Friday", "Roster update", "Old thread"]));
    expect(words(contactSheet()!)).not.toMatch(/Please call|Trashed already|Contract draft/);
    // The list underneath is exactly as it was: the sender's own name, not the saved one.
    expect(words(rowOf("Lunch on Friday").querySelector(".mfrom"))).toBe("Maya C.");
  });

  it("a Recent Mail row closes the sheet and opens that message", async () => {
    const r = rig();
    mount(r);
    await openSheet("Lunch on Friday");
    await waitFor(() => expect(recentSubjects()).toContain("Old thread"));
    fireEvent.click(recentRows().find((x) => words(x).includes("Old thread"))!);
    expect(contactSheet()).toBeUndefined();
    await waitFor(() => expect(messageUp()).toBe(true));
    await waitFor(() => expect(subjectUp()).toBe("Old thread"));
  });

  it("the words of the row still open the message, and no contact sheet comes with it", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(rowEls().length).toBe(4));
    fireEvent.click(within(rowOf("Lunch on Friday")).getByText("Lunch on Friday"));
    await waitFor(() => expect(messageUp()).toBe(true));
    expect(contactSheet()).toBeUndefined();
    expect(subjectUp()).toBe("Lunch on Friday");
  });

  it("every row's circle is a button named for its sender, and the row text, the time and the chevron are not", async () => {
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(4));
    const names = rowEls().map((e) => e.querySelector("button.mav")?.getAttribute("aria-label"));
    expect(names).toEqual(["Contact Details for Maya C.", "Contact Details for Alex Morgan", "Contact Details for Maya C.", "Contact Details for Dave Fisher"]);
    for (const e of rowEls()) expect(e.querySelectorAll("button")).toHaveLength(1);
  });

  it("Select mode keeps the circle a plain mark, and a tap is the row's selection", async () => {
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(4));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(rowEls().every((e) => e.querySelector("button") === null && e.querySelector(".mav")!.tagName === "SPAN")).toBe(true);
    fireEvent.click(rowOf("Lunch on Friday"));
    expect(rowOf("Lunch on Friday")).toHaveAttribute("aria-pressed", "true");
    expect(contactSheet()).toBeUndefined();
    expect(messageUp()).toBe(false);
  });
});

describe("what the sheet says about the address, from the contacts as they stand", () => {
  it("a sender who is not saved says Not in Contacts, keeps the sender's own name and the address, and offers no contact; the cache supplies their older mail", async () => {
    mount(rig());
    await openSheet("Contract draft");
    expect(words(sheetHead().querySelector(".email-from-name"))).toBe("Alex Morgan");
    expect(sheetFacts()).toEqual([ALEX, "Not in Contacts"]);
    expect(actionWords()).toEqual(["Done"]);
    await waitFor(() => expect(recentSubjects()).toEqual(["Contract draft", "Older contract"]));
  });

  it("the person's own mailbox says Your Mailbox even though a contact carries the address", async () => {
    mount(rig());
    await openSheet("Reminder to self");
    expect(sheetFacts()).toEqual([DAVE, "Your Mailbox"]);
    expect(words(sheetHead().querySelector(".email-from-name"))).toBe("Dave Fisher");
    expect(actionWords()).toEqual(["Done"]);
    expect(words(contactSheet()!)).not.toMatch(/Open Contact|Choose Contact|Not in Contacts/);
  });

  it("two contacts that carry the address are offered, never chosen between: Choose Contact lists both, each a door to its own contact", async () => {
    const twin = person("p-twin", "Maya Chen-Ortiz", { emails: [{ value: "MAYA@Example.test" }], categoryIds: ["c-bridge"] });
    mount(rig(), { people: [P_MAYA, twin] });
    await openSheet("Lunch on Friday");
    expect(words(contactSheet()!.querySelector(".sh2 .t"))).toBe("Choose Contact");
    // The Choose Contact card comes first, then Recent Mail's.
    const doors = [...contactSheet()!.querySelectorAll(".list-card-ruled")[0]!.querySelectorAll(".row")] as HTMLElement[];
    expect(doors.map((d) => words(d.querySelector(".conn-name")))).toEqual(["Maya Chen", "Maya Chen-Ortiz"]);
    expect(sheetFacts()).toEqual([MAYA]);
    expect(actionWords()).toEqual(["Done"]);
    fireEvent.click(doors[1]!);
    expect(openEntity).toHaveBeenCalledTimes(1);
    expect(openEntity).toHaveBeenCalledWith("person", "p-twin");
    expect(contactSheet()).toBeUndefined();
  });

  it("with no People store to read, it claims nothing about contacts and still shows the sender and their mail", async () => {
    mount(rig(), { people: undefined });
    await openSheet("Lunch on Friday");
    expect(words(sheetHead().querySelector(".email-from-name"))).toBe("Maya C.");
    expect(sheetFacts()).toEqual([MAYA]);
    expect(words(contactSheet()!)).not.toMatch(/Not in Contacts|Choose Contact|Your Mailbox/);
    expect(actionWords()).toEqual(["Done"]);
    await waitFor(() => expect(recentSubjects()).toEqual(["Lunch on Friday", "Roster update", "Old thread"]));
  });

  it("Open Contact goes to that contact through the shell, once, and closes the sheet", async () => {
    mount(rig());
    await openSheet("Lunch on Friday");
    fireEvent.click(within(contactSheet()!).getByRole("button", { name: "Open Contact" }));
    expect(openEntity).toHaveBeenCalledTimes(1);
    expect(openEntity).toHaveBeenCalledWith("person", "p-maya");
    expect(contactSheet()).toBeUndefined();
  });

  it("with no way into the Contacts module (a build that gave none) Open Contact is not drawn: no dead button", async () => {
    mount(rig(), { onOpenEntity: undefined });
    await openSheet("Lunch on Friday");
    expect(actionWords()).toEqual(["Done"]);
    expect(words(sheetHead().querySelector(".email-from-name"))).toBe("Maya Chen");
  });

  it("a rename or a deletion is current the next time the sheet opens, and the list under it never changes (AC10)", async () => {
    const r = rig();
    const ui = mount(r);
    await openSheet("Lunch on Friday");
    expect(words(sheetHead().querySelector(".email-from-name"))).toBe("Maya Chen");
    fireEvent.click(within(document.body).getByRole("button", { name: "Done" }));
    expect(contactSheet()).toBeUndefined();

    ui.rerender(flow(r, { people: [{ ...P_MAYA, data: { ...P_MAYA.data, name: "Maya Chen-Ortiz", categoryIds: ["c-family"] } }] }));
    fireEvent.click(avatarOf("Lunch on Friday"));
    await waitFor(() => expect(contactSheet()).toBeTruthy());
    expect(words(sheetHead().querySelector(".email-from-name"))).toBe("Maya Chen-Ortiz");
    expect(sheetFacts()).toEqual([MAYA, "Family"]);
    fireEvent.click(within(document.body).getByRole("button", { name: "Done" }));

    ui.rerender(flow(r, { people: [] }));
    fireEvent.click(avatarOf("Lunch on Friday"));
    await waitFor(() => expect(contactSheet()).toBeTruthy());
    expect(sheetFacts()).toEqual([MAYA, "Not in Contacts"]);
    expect(words(sheetHead().querySelector(".email-from-name"))).toBe("Maya C.");
    // The message list itself: the sender as the mail said it, the subject, untouched.
    expect(rowOf("Lunch on Friday").getAttribute("aria-label")).toBe("Maya C. · Lunch on Friday");
  });
});

describe("opening it writes nothing", () => {
  it("asks the cache for exactly the address, once, and sends no command: no save, no send, no capture, no provider call", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(rowEls().length).toBe(4));
    const callsBefore = r.calls.length;
    const postsBefore = r.posts.length;
    fireEvent.click(avatarOf("Lunch on Friday"));
    await waitFor(() => expect(recentSubjects()).toContain("Old thread"));
    const added = r.calls.slice(callsBefore);
    expect(added.map((c) => c.fn)).toEqual(["email_search_cached"]);
    expect(added[0]!.args).toMatchObject({ p_q: MAYA, p_accounts: null });
    expect(r.posts.length).toBe(postsBefore);
    expect(written(r)).toEqual([]);
    // Closing it, and opening it again, asks again: nothing is kept.
    fireEvent.click(within(document.body).getByRole("button", { name: "Done" }));
    fireEvent.click(avatarOf("Contract draft"));
    await waitFor(() => expect(recentSubjects()).toContain("Older contract"));
    expect(r.calls.slice(callsBefore).filter((c) => c.fn === "email_search_cached").map((c) => c.args.p_q)).toEqual([MAYA, ALEX]);
    expect(r.posts.length).toBe(postsBefore);
  });

  it("offline, the sheet opens with the loaded mail only, asks the cache for nothing, and shows no error", async () => {
    saveSnapshot(USER, { accounts: [ACCOUNT], rows: INBOX });
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const r = rig();
    mount(r);
    await waitFor(() => expect(rowEls().length).toBe(4));
    fireEvent.click(avatarOf("Lunch on Friday"));
    await waitFor(() => expect(contactSheet()).toBeTruthy());
    expect(recentSubjects()).toEqual(["Lunch on Friday", "Roster update"]);
    expect(r.calls.some((c) => c.fn === "email_search_cached")).toBe(false);
    expect(words(contactSheet()!)).not.toMatch(/Couldn't|Unavailable|Offline|Error|Try Again/i);
    expect(sheetFacts()).toEqual([MAYA, "Family", "Bridge"]);
  });

  it("a cache that fails to answer leaves the loaded mail and says nothing about it", async () => {
    const r = rig({ email_search_cached: () => { throw new Error("the cache is down"); } });
    mount(r);
    await openSheet("Lunch on Friday");
    await waitFor(() => expect(r.calls.some((c) => c.fn === "email_search_cached")).toBe(true));
    expect(recentSubjects()).toEqual(["Lunch on Friday", "Roster update"]);
    expect(words(contactSheet()!)).not.toMatch(/Couldn't|Unavailable|Error|Try Again/i);
  });

  it("an answer that arrives after the sheet moved on is dropped: a slow search for one sender never lands in another's sheet", async () => {
    const slow: Array<() => void> = [];
    const r = rig({
      email_search_cached: (a) => {
        // The answer is held until the test releases it, so the second sheet is open when the first one's arrives.
        const q = String(a.p_q);
        return new Promise((done) => { slow.push(() => done({ rows: q === MAYA ? [CACHE_ONLY[0]!] : [CACHE_ONLY[3]!], coverage: "cached", q, window: 1 })); }) as unknown;
      },
    });
    // rpc awaits the function's return value only if it is a promise: wrap the fake so a promise is awaited.
    const base = r.client.rpc.bind(r.client);
    r.client.rpc = async (fn, args) => { const out = await base(fn, args); return { data: await Promise.resolve(out.data), error: out.error }; };
    mount(r);
    await openSheet("Lunch on Friday");
    fireEvent.click(within(document.body).getByRole("button", { name: "Done" }));
    fireEvent.click(avatarOf("Contract draft"));
    await waitFor(() => expect(slow.length).toBe(2));
    slow[0]!();
    slow[1]!();
    await waitFor(() => expect(recentSubjects()).toContain("Older contract"));
    expect(recentSubjects()).not.toContain("Old thread");
  });
});

describe("a move the sheet did not make", () => {
  it("a message another surface asks for (a deep link) opens, and the contact sheet does not wait behind it to come back", async () => {
    const r = rig();
    const ui = mount(r);
    await openSheet("Lunch on Friday");
    ui.rerender(flow(r, { openId: "u-m2", openNonce: 1 }));
    await waitFor(() => expect(subjectUp()).toBe("Roster update"));
    expect(contactSheet()).toBeUndefined();
    // Leaving that message lands on the inbox with no sheet over it.
    fireEvent.click(document.querySelector(".msg-sheet-bar .nav-back") as HTMLElement);
    await waitFor(() => expect(messageUp()).toBe(false));
    expect(contactSheet()).toBeUndefined();
    expect(document.querySelector(".sheet-scrim")).toBeNull();
  });
});

describe("from an open message", () => {
  it("the circle in the message head opens the contact sheet over the message; Done comes back to the message", async () => {
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(4));
    fireEvent.click(rowOf("Lunch on Friday"));
    await waitFor(() => expect(subjectUp()).toBe("Lunch on Friday"));
    const head = document.querySelector(".email-head .email-avatar") as HTMLElement;
    expect(head.tagName).toBe("BUTTON");
    expect(head).toHaveAccessibleName("Contact Details for Maya C.");
    fireEvent.click(head);
    await waitFor(() => expect(contactSheet()).toBeTruthy());
    // Two layers, the contact sheet last: it stacks over the message by DOM order.
    const scrims = [...document.querySelectorAll(".sheet-scrim")];
    expect(scrims.length).toBeGreaterThanOrEqual(2);
    expect(scrims[scrims.length - 1]!.contains(contactSheet()!)).toBe(true);
    expect(messageUp()).toBe(true);
    expect(sheetFacts()).toEqual([MAYA, "Family", "Bridge"]);
    fireEvent.click(within(document.body).getByRole("button", { name: "Done" }));
    expect(contactSheet()).toBeUndefined();
    expect(messageUp()).toBe(true);
    expect(subjectUp()).toBe("Lunch on Friday");
  });

  it("another message of theirs, picked from the sheet, replaces the open one: the new subject, the new body, read on its own", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(rowEls().length).toBe(4));
    fireEvent.click(rowOf("Lunch on Friday"));
    await waitFor(() => expect(subjectUp()).toBe("Lunch on Friday"));
    fireEvent.click(document.querySelector(".email-head .email-avatar") as HTMLElement);
    await waitFor(() => expect(contactSheet()).toBeTruthy());
    await waitFor(() => expect(recentSubjects()).toContain("Roster update"));
    fireEvent.click(recentRows().find((x) => words(x).includes("Roster update"))!);
    await waitFor(() => expect(subjectUp()).toBe("Roster update"));
    expect(contactSheet()).toBeUndefined();
    await waitFor(() => expect(r.calls.filter((c) => c.fn === "email_message_read").map((c) => c.args.p_message)).toContain("u-m2"));
    expect(document.querySelectorAll(".msg-sheet-bar")).toHaveLength(1);
  });
});

describe("from a search and from the review list", () => {
  it("a search result's circle opens the sheet over the search, and a message picked there goes back to the same search", async () => {
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(4));
    await searchFor("Contract");
    await waitFor(() => expect(rowOf("Contract draft")).toBeTruthy());
    expect(rowOf("Contract draft").querySelector("button.mav")).toBeTruthy();
    fireEvent.click(avatarOf("Contract draft"));
    await waitFor(() => expect(contactSheet()).toBeTruthy());
    expect(messageUp()).toBe(false);
    expect(sheetFacts()).toEqual([ALEX, "Not in Contacts"]);
    await waitFor(() => expect(recentSubjects()).toEqual(["Contract draft", "Older contract"]));
    fireEvent.click(recentRows().find((x) => words(x).includes("Older contract"))!);
    await waitFor(() => expect(subjectUp()).toBe("Older contract"));
    // Back from the message lands on the search it was reached from, not on the inbox.
    fireEvent.click(document.querySelector(".msg-sheet-bar .nav-back") as HTMLElement);
    await waitFor(() => expect(messageUp()).toBe(false));
    expect(screen.getByPlaceholderText("Search Mail")).toHaveValue("Contract");
  });

  it("a review row's circle opens the sheet over the review list, and a message picked there goes back to the review list", async () => {
    const r = rig({ candidates_to_review: () => ({ count: 1, rows: [INBOX[1]], candidates: [] }) });
    mount(r, { focus: { kind: "candidates" }, focusNonce: 1 });
    await waitFor(() => expect(screen.getAllByText("To Review").length).toBeGreaterThan(0));
    await waitFor(() => expect(rowOf("Contract draft")).toBeTruthy());
    fireEvent.click(avatarOf("Contract draft"));
    await waitFor(() => expect(contactSheet()).toBeTruthy());
    expect(messageUp()).toBe(false);
    await waitFor(() => expect(recentSubjects()).toContain("Older contract"));
    fireEvent.click(recentRows().find((x) => words(x).includes("Older contract"))!);
    await waitFor(() => expect(subjectUp()).toBe("Older contract"));
    fireEvent.click(document.querySelector(".msg-sheet-bar .nav-back") as HTMLElement);
    await waitFor(() => expect(messageUp()).toBe(false));
    expect(screen.getAllByText("To Review").length).toBeGreaterThan(0);
    expect(rowOf("Contract draft")).toBeTruthy();
  });
});
