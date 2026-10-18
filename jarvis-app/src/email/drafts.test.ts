import { describe, it, expect } from "vitest";
import {
  badAddresses, canonicalFields, ownWords, clearLocalDraft, emptyFields, hasManagedSignature, isAddress, loadLocalDrafts, normalizeAddress, outcomeOf, pausedOpenTarget, replaceSignature, replyFields, reviewExpired, sameFields,
  saveLocalDraft, signatureUntouched, splitAddresses, stripSignature, unsavedLocal, withSignature, type DraftFields, type DraftRow, type LocalDraft, type Reopened,
} from "./drafts";
import type { EmailAccount, MessageDetail } from "./emailClient";

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
    // A reply opens with the message it answers, quoted (Dave 2026-10-15, item 3), not an empty draft.
    expect(f.body_text).toMatch(/^\n\nOn Oct [34], \d{1,2}:05 [AP]M, Coach Miller wrote:\n> On it$/);
  });
  it("the quote is the sender's own lines behind '> ', from the html when there is no plain text, and ownWords tells it from what was typed", () => {
    const f = replyFields(message({ text: "Line one\n\n\nLine two\n", from_name: "" }), [], false);
    expect(f.body_text).toMatch(/^\n\nOn Oct [34], \d{1,2}:05 [AP]M, coach@example\.test wrote:\n> Line one\n>\n> Line two$/);
    expect(replyFields(message({ text: null, html: "<p>Tuesday 1:30 PM</p>" }), [], false).body_text).toContain("> Tuesday 1:30 PM");
    expect(replyFields(message({ text: "", html: null, snippet: "" }), [], false).body_text).toBe("");
    const typed = "Sounds good.\n\n" + f.body_text.trim() + "\n\n-- \nDave";
    expect(ownWords(typed)).toBe("Sounds good.\n\n-- \nDave");
    expect(ownWords("No quote here")).toBe("No quote here");
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

describe("the saved signature (Email v1 spec L3, AC17 to AC19)", () => {
  const acct = (o: Partial<EmailAccount> = {}): EmailAccount => ({
    id: "acct-dave", address: "dave@example.test", state: "connected", last_sync_at: null, sync_error: null, capabilities: {}, connected_at: "2026-10-08T00:00:00Z", scopes: [],
    cached: 0, signature_text: "Dave Fisher", signature_revision: 1, ...o,
  });

  it("appends a non-empty signature as its own block, once; an empty signature appends nothing", () => {
    expect(withSignature("On it.", "Dave Fisher")).toBe("On it.\n\n-- \nDave Fisher");
    expect(withSignature("On it.", "")).toBe("On it.");
    expect(withSignature("", "Dave Fisher")).toBe("\n\n-- \nDave Fisher");
  });

  it("knows the exact block from anything else at the end of the body", () => {
    expect(hasManagedSignature("On it.\n\n-- \nDave Fisher", "Dave Fisher")).toBe(true);
    expect(hasManagedSignature("On it.\n\n-- \nDave Fisher, edited", "Dave Fisher")).toBe(false);
    expect(hasManagedSignature("On it.", "Dave Fisher")).toBe(false);
    // Empty text is never a block to find: there is nothing a fresh compose would have appended.
    expect(hasManagedSignature("On it.", "")).toBe(false);
  });

  it("strips only the exact block, and only when it is really there", () => {
    expect(stripSignature("On it.\n\n-- \nDave Fisher", "Dave Fisher")).toBe("On it.");
    expect(stripSignature("On it.", "Dave Fisher")).toBe("On it.");
    expect(stripSignature("On it.\n\n-- \nDave Fisher", "")).toBe("On it.\n\n-- \nDave Fisher");
  });

  it("replaces the old untouched block with the new one, or drops it when the new signature is empty", () => {
    expect(replaceSignature("On it.\n\n-- \nDave Fisher", "Dave Fisher", "Dave F., Work")).toBe("On it.\n\n-- \nDave F., Work");
    expect(replaceSignature("On it.\n\n-- \nDave Fisher", "Dave Fisher", "")).toBe("On it.");
    // Nothing to strip: the new one is simply appended.
    expect(replaceSignature("On it.", "", "Dave F., Work")).toBe("On it.\n\n-- \nDave F., Work");
  });

  it("AC19: a draft's managed block is untouched only when it was ever inserted, the account's signature has not changed since, and the words still match exactly", () => {
    const body = "On it.\n\n-- \nDave Fisher";
    expect(signatureUntouched(body, 1, acct())).toBe(true);
    // Never inserted (a fresh draft, or the account's signature was empty at compose time).
    expect(signatureUntouched(body, null, acct())).toBe(false);
    // The account's signature moved on since insertion: the text it was inserted with is not known here.
    expect(signatureUntouched(body, 1, acct({ signature_revision: 2 }))).toBe(false);
    // The person edited the block.
    expect(signatureUntouched("On it.\n\n-- \nDave Fisher, Esq.", 1, acct())).toBe(false);
    // No account at all (an id that no longer resolves).
    expect(signatureUntouched(body, 1, null)).toBe(false);
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

describe("opening a paused send (migration 0069)", () => {
  const row = (o: Partial<DraftRow> = {}): DraftRow => ({ ...emptyFields(), id: "d-1", account_id: "acct-dave", account: "dave@example.test", send_state: "sending", saved_at: "2026-10-12T10:00:00Z", revision: 3, updated_at: "2026-10-12T10:00:00Z",
    sent_action_id: "act-1", provider_message_id: null, action_state: "approved", action_verb: null, outbox_state: "failed", error_code: "PROVIDER_AUTH", provider_ack: null, ...o });
  const answer = (o: Partial<Reopened>): { ok: true; value: Reopened } => ({ ok: true, value: { ...row(), released: true, editable: true, ...o } });

  it("a released draft opens in the composer with the server's words and revision as they are now", () => {
    const t = pausedOpenTarget(row(), answer({ send_state: "failed", body_text: "Newer words.", revision: 4 }));
    expect(t.kind).toBe("compose");
    expect(t.kind === "compose" && [t.draft.send_state, t.draft.body_text, t.draft.revision]).toEqual(["failed", "Newer words.", 4]);
  });

  it("one that is still the send's (held, sending, unknown) never opens a composer: it opens its outcome", () => {
    for (const st of ["sending", "unknown", "sent"] as const) expect(pausedOpenTarget(row(), answer({ send_state: st, released: false, editable: false })).kind).toBe("outcome");
  });

  it("gone is gone; any other refusal falls back to the row as listed, where the server's own guards still decide", () => {
    expect(pausedOpenTarget(row(), { ok: false, code: "NOT_FOUND", data: {} })).toEqual({ kind: "gone" });
    const listed = row({ body_text: "As listed." });
    expect(pausedOpenTarget(listed, { ok: false, code: "UNAVAILABLE", data: {} })).toEqual({ kind: "compose", draft: listed });
  });
});
