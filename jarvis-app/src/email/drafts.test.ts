import { describe, it, expect } from "vitest";
import { badAddresses, canonicalFields, clearLocalDraft, emptyFields, isAddress, loadLocalDrafts, normalizeAddress, outcomeOf, replyFields, reviewExpired, sameFields, saveLocalDraft, splitAddresses, unsavedLocal, type DraftFields, type DraftRow, type LocalDraft } from "./drafts";
import type { MessageDetail } from "./emailClient";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };

const message = (o: Partial<MessageDetail> = {}): MessageDetail => ({
  id: "u-m2", account_id: "acct-dave", account: "dave@example.test", provider_id: "m2", thread_id: "t-a2", internal_date: "2026-10-03T13:05:00Z", from_address: "coach@example.test", from_name: "Coach Miller",
  to_addresses: [{ address: "dave@example.test", name: "Dave" }, { address: "parent@example.test", name: "" }], cc_addresses: [{ address: "Dave@Work.test", name: "" }, { address: "admin@school.test", name: "" }],
  subject: "Peña transcript", snippet: "", provider_labels: ["INBOX"], read: true, deleted: false, source_hash: "sh", attachments: [], has_body: true, text: "On it", html: null,
  reply_headers: { message_id: "<m2@example.test>", references: ["<m1@example.test>"], in_reply_to: "<m1@example.test>", reply_to: "" }, ...o,
});

describe("addresses", () => {
  it("splits names, brackets, commas, semicolons and lines into bare addresses, each once", () => {
    expect(splitAddresses('Coach Miller <coach@example.test>, "Doe, Jane" <jane@x.test>; coach@EXAMPLE.test\nz@y.test')).toEqual(["coach@example.test", "jane@x.test", "z@y.test"]);
  });
  it("knows an address from a not-address, and normalises the domain only", () => {
    expect(isAddress("Coach@Example.TEST")).toBe(true);
    expect(isAddress("not an address")).toBe(false);
    expect(isAddress("a@b")).toBe(false);
    expect(badAddresses(["ok@example.test", "nope", "a@b.c"])).toEqual(["nope"]);
    expect(normalizeAddress(" Coach@Example.TEST ")).toBe("Coach@example.test");
  });
});

describe("replies (E17)", () => {
  it("Reply answers the sender with Re:, the thread and the ids, and nobody else", () => {
    const f = replyFields(message(), ["dave@example.test", "dave@work.test"], false);
    expect(f.to_addresses).toEqual(["coach@example.test"]);
    expect(f.cc_addresses).toEqual([]);
    expect(f.bcc_addresses).toEqual([]);
    expect(f.subject).toBe("Re: Peña transcript");
    expect(f.reply_headers).toEqual({ in_reply_to: "<m2@example.test>", references: ["<m1@example.test>", "<m2@example.test>"], thread_id: "t-a2" });
    expect(f.thread_id).toBe("t-a2");
    expect(f.body_text).toBe("");
  });
  it("Reply All keeps everyone else on Cc, drops the person's own identities in any case, and never invents a Bcc", () => {
    const f = replyFields(message(), ["dave@example.test", "dave@work.test"], true);
    expect(f.to_addresses).toEqual(["coach@example.test"]);
    expect(f.cc_addresses).toEqual(["parent@example.test", "admin@school.test"]);
    expect(f.bcc_addresses).toEqual([]);
  });
  it("Reply honours a Reply-To and Reply All then keeps the writer on Cc", () => {
    const f = replyFields(message({ reply_headers: { message_id: "<m2@example.test>", references: [], reply_to: "desk@example.test" } }), ["dave@example.test"], true);
    expect(f.to_addresses).toEqual(["desk@example.test"]);
    expect(f.cc_addresses[0]).toBe("coach@example.test");
    expect(f.reply_headers.references).toEqual(["<m2@example.test>"]);
  });
  it("a message read without headers still replies, with no ids to carry", () => {
    const f = replyFields(message({ reply_headers: undefined, subject: "(no subject)" }), [], false);
    expect(f.reply_headers).toEqual({ in_reply_to: null, references: [], thread_id: "t-a2" });
    expect(f.subject).toBe("Re:");
  });
});

describe("the local store (11, E22: a reload never loses the latest words)", () => {
  const fields = (body: string): DraftFields => ({ ...emptyFields(), to_addresses: ["coach@example.test"], subject: "Re: Transcript", body_text: body });
  const local = (key: string, body: string, savedAt: string, serverAt: string | null = null): LocalDraft => ({ key, draft_id: key.startsWith("local:") ? null : key, account_id: "acct-dave", fields: fields(body), revision: serverAt ? 2 : null, saved_at: savedAt, server_saved_at: serverAt });
  it("saves, lists the unsaved newest first, and clears", () => {
    const s = mem();
    saveLocalDraft("u1", local("local:a", "one", "2026-10-03T10:00:00Z"), s);
    saveLocalDraft("u1", local("d-2", "two", "2026-10-03T10:05:00Z", "2026-10-03T10:05:00Z"), s);
    saveLocalDraft("u1", local("d-3", "three edited", "2026-10-03T10:07:00Z", "2026-10-03T10:06:00Z"), s);
    expect(Object.keys(loadLocalDrafts("u1", s)).sort()).toEqual(["d-2", "d-3", "local:a"]);
    expect(unsavedLocal("u1", s).map((d) => d.key)).toEqual(["d-3", "local:a"]);
    expect(loadLocalDrafts("u2", s)).toEqual({});
    clearLocalDraft("u1", "local:a", s);
    expect(unsavedLocal("u1", s).map((d) => d.key)).toEqual(["d-3"]);
  });
  it("equal words are equal whatever the object order", () => {
    const a = fields("x");
    const b = { ...a, reply_headers: { thread_id: null, references: [], in_reply_to: null } };
    expect(sameFields(a, b)).toBe(true);
    expect(sameFields(a, { ...a, bcc_addresses: ["me@example.test"] })).toBe(false);
    expect(canonicalFields(a).reply_headers).toEqual({ in_reply_to: null, references: [], thread_id: null });
  });
});

describe("outcomes and expiry", () => {
  const row = (o: Partial<DraftRow>): Pick<DraftRow, "send_state" | "action_state" | "outbox_state"> => ({ send_state: "draft", action_state: null, outbox_state: null, ...o });
  it("reads the draft's state first and the outbox's while sending", () => {
    expect(outcomeOf(row({ send_state: "sent" }))).toBe("sent");
    expect(outcomeOf(row({ send_state: "unknown" }))).toBe("unknown");
    expect(outcomeOf(row({ send_state: "failed" }))).toBe("failed");
    expect(outcomeOf(row({ send_state: "sending", outbox_state: "queued" }))).toBe("sending");
    expect(outcomeOf(row({ send_state: "sending", outbox_state: "confirmed" }))).toBe("sent");
    expect(outcomeOf(row({ send_state: "sending", outbox_state: "cancelled" }))).toBe("failed");
    expect(outcomeOf(row({ send_state: "draft" }))).toBe("draft");
  });
  it("a review is good until its expiry and not a second longer", () => {
    expect(reviewExpired("2026-10-03T15:05:00Z", new Date("2026-10-03T15:04:59Z"))).toBe(false);
    expect(reviewExpired("2026-10-03T15:05:00Z", new Date("2026-10-03T15:05:00Z"))).toBe(true);
    expect(reviewExpired("garbage", new Date())).toBe(true);
  });
});
