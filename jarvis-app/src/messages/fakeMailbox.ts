import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { HistoryExpiredError, type GoogleApi } from "../connections/google/api";
import type { GmailMeta, GmailThreadFull, GmailThreadMeta } from "../connections/google/map";

// A small, honest Gmail for tests: threads with labels, a history log with
// Gmail's real shape (an ever-growing id as a STRING, paged), and a counter
// on every kind of request, so a test can say "reopening an unchanged inbox
// cost two small reads, zero thread reads" and have it be a measurement.
//
// It is a test double, not a proof of Gmail: what it encodes is the contract
// the app relies on (a thread's historyId moves on any change; history lists
// what changed; history older than the oldest kept is a 404).

export interface Counters {
  list: number;
  history: number;
  metadata: number;
  bodies: number;
  mutation: number;
  profile: number;
}

interface FMessage { id: string; from: string; subject: string; snippet: string; at: number; labels: Set<string> }
interface FThread { id: string; messages: FMessage[]; historyId: bigint }

export class FakeMailbox {
  email: string;
  threads = new Map<string, FThread>();
  /** Gmail's counter. Starts above 2^53 so any number-typed handling would round it. */
  private hid = 9007199254740993n;
  private log: { id: bigint; threadId: string }[] = [];
  /** History older than this id answers 404, as Gmail's does after about a week. */
  oldestHistory = 0n;
  /** Entries per history page, small so pagination is exercised. */
  historyPageSize = 2;
  /** Refs per list page, small so the cursor is exercised when a test wants it. */
  listPageSize = 100;
  counters: Counters = { list: 0, history: 0, metadata: 0, bodies: 0, mutation: 0, profile: 0 };
  /** Ids whose metadata read fails with a 500. */
  failMeta = new Set<string>();
  failList = false;
  failHistory = false;
  private msgSeq = 1;
  private clock = 1_700_000_000_000;

  constructor(email = "dave@example.com") { this.email = email; }

  private bump(threadId: string): bigint {
    this.hid += 1n;
    this.log.push({ id: this.hid, threadId });
    const t = this.threads.get(threadId);
    if (t) t.historyId = this.hid;
    return this.hid;
  }

  get historyId(): string { return this.hid.toString(); }

  /** Adds a whole thread to the inbox. */
  add(id: string, opts: { from?: string; subject?: string; snippet?: string; unread?: boolean; messages?: number; at?: number } = {}): void {
    const msgs: FMessage[] = [];
    const n = opts.messages ?? 1;
    for (let i = 0; i < n; i++) {
      msgs.push({
        id: `${id}_m${this.msgSeq++}`, from: opts.from ?? "Wei <wei@x.com>", subject: opts.subject ?? `Subject ${id}`,
        snippet: opts.snippet ?? `snippet ${id}`, at: (opts.at ?? (this.clock += 60_000)) + i,
        labels: new Set(["INBOX", ...(opts.unread === false ? [] : ["UNREAD"])]),
      });
    }
    this.threads.set(id, { id, messages: msgs, historyId: this.hid });
    this.bump(id);
  }

  /** A new message arrives in an existing thread. */
  receive(threadId: string, opts: { from?: string; snippet?: string } = {}): string {
    const t = this.threads.get(threadId)!;
    const m: FMessage = {
      id: `${threadId}_m${this.msgSeq++}`, from: opts.from ?? "Wei <wei@x.com>", subject: t.messages[0]!.subject,
      snippet: opts.snippet ?? "a new reply", at: (this.clock += 60_000), labels: new Set(["INBOX", "UNREAD"]),
    };
    t.messages.push(m);
    this.bump(threadId);
    return m.id;
  }

  /** Read on another device: a label-only change. */
  markRead(threadId: string): void {
    for (const m of this.threads.get(threadId)!.messages) m.labels.delete("UNREAD");
    this.bump(threadId);
  }

  /** Archived elsewhere: leaves the inbox, stays in the mailbox. */
  archive(threadId: string): void {
    for (const m of this.threads.get(threadId)!.messages) m.labels.delete("INBOX");
    this.bump(threadId);
  }

  /** Deleted outright: the thread is gone. */
  remove(threadId: string): void {
    this.bump(threadId);
    this.threads.delete(threadId);
  }

  /** Deleting the newest message of a thread moves its content revision. */
  deleteLatestMessage(threadId: string): void {
    this.threads.get(threadId)!.messages.pop();
    this.bump(threadId);
  }

  /** Makes every history entry so far unreadable, like Gmail expiring them. */
  // Entries up to now are gone. A start id equal to now is still valid (it
  // simply has nothing after it), as it is in Gmail, which is what makes a
  // fresh boundary safe to replay from.
  expireHistory(): void { this.oldestHistory = this.hid; }

  private inboxThreads(): FThread[] {
    return [...this.threads.values()]
      .filter((t) => t.messages.some((m) => m.labels.has("INBOX")))
      .sort((a, b) => (b.messages.at(-1)!.at) - (a.messages.at(-1)!.at));
  }

  private metaOf(t: FThread): GmailThreadMeta {
    return {
      id: t.id,
      messages: t.messages.map((m): GmailMeta => ({
        id: m.id, snippet: m.snippet, labelIds: [...m.labels], internalDate: String(m.at),
        payload: { headers: [
          { name: "From", value: m.from }, { name: "Subject", value: m.subject }, { name: "Date", value: new Date(m.at).toUTCString() },
        ] },
      })),
    };
  }

  api(o: Partial<GoogleApi> = {}): GoogleApi {
    const c = this.counters;
    return makeFakeGoogleApi({
      getProfile: async () => { c.profile++; return { emailAddress: this.email, historyId: this.historyId }; },
      listInboxThreadRefs: async (max, token) => {
        c.list++;
        if (this.failList) throw new Error("threads 500");
        const all = this.inboxThreads();
        const from = token ? Number(token) : 0;
        const size = Math.min(max, this.listPageSize);
        const page = all.slice(from, from + size);
        const next = from + size < all.length ? String(from + size) : undefined;
        return { refs: page.map((t) => ({ id: t.id, historyId: t.historyId.toString() })), ...(next ? { nextPageToken: next } : {}) };
      },
      listHistory: async (start, token) => {
        c.history++;
        if (this.failHistory) throw new Error("history 500");
        if (BigInt(start) < this.oldestHistory) throw new HistoryExpiredError();
        const after = this.log.filter((e) => e.id > BigInt(start));
        const from = token ? Number(token) : 0;
        const page = after.slice(from, from + this.historyPageSize);
        const next = from + this.historyPageSize < after.length ? String(from + this.historyPageSize) : undefined;
        return { threadIds: page.map((e) => e.threadId), historyId: this.historyId, ...(next ? { nextPageToken: next } : {}) };
      },
      getThreadMeta: async (id) => {
        c.metadata++;
        if (this.failMeta.has(id)) throw new Error("thread meta 500");
        const t = this.threads.get(id);
        return t ? this.metaOf(t) : null;
      },
      getThread: async (id) => {
        c.bodies++;
        const t = this.threads.get(id);
        return (t ? this.metaOf(t) : { id, messages: [] }) as unknown as GmailThreadFull;
      },
      modifyThread: async () => { c.mutation++; },
      trashThread: async () => { c.mutation++; },
      untrashThread: async () => { c.mutation++; },
      ...o,
    });
  }
}
