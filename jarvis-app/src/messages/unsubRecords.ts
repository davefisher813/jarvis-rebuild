import { capAfterNumber } from "../shared/casing";

// THE PURGE, COMPLETED (UP-MIND-17, Email E3 and 5.9).
//
// 90% of non-spam mail is machine-generated and Gmail's own unsubscribe
// panel has no select-all. The app already had the piles, the safety rules
// and the pre-selection; what it did not have was MEMORY. The asked list was
// a bare array of addresses (selfClean.ts loadAsked), so once you had asked
// a sender to stop, the app knew only that you had asked, forever: not when,
// not how, not from which account, and above all not whether it worked.
//
// "Asked 3 weeks ago, still sending" is the fact that earns the next move.
// It is also the honest reason to offer a Block, which is the app doing what
// the sender would not.
//
// The copy stays "asked them to stop". The app cannot unsubscribe anybody: it
// sends the request the sender published, and the sender decides.

const KEY = "jarvis.mail.unsub.v2";
const LEGACY = "jarvis.mail.tossasked.v1";
const CAP = 200;

export type UnsubVia = "header" | "link" | "rule";

export interface UnsubRecord {
  sender: string;
  /** Local YYYY-MM-DD the ask went out. */
  askedISO: string;
  via: UnsubVia;
  /** Which mail account asked. A sender only honours an unsubscribe from
   *  the subscribed address, so this is what a re-ask has to use. */
  account?: string;
}

function readRaw(storage: Pick<Storage, "getItem">): unknown {
  try { return JSON.parse(storage.getItem(KEY) || "null"); } catch { return null; }
}

export function loadUnsubs(storage: Pick<Storage, "getItem"> = localStorage): UnsubRecord[] {
  const raw = readRaw(storage);
  const out: UnsubRecord[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (typeof v !== "object" || v === null) continue;
      const { sender, askedISO, via, account } = v as Record<string, unknown>;
      if (typeof sender !== "string" || !sender.trim()) continue;
      if (typeof askedISO !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(askedISO)) continue;
      out.push({
        sender: sender.toLowerCase(),
        askedISO,
        via: via === "header" || via === "link" || via === "rule" ? via : "header",
        ...(typeof account === "string" && account ? { account } : {}),
      });
    }
    return out;
  }
  // MIGRATION. The v1 list held addresses and nothing else. They keep their
  // place (the app must not re-offer a sender the user already answered
  // about) with NO askedISO of their own, which is why the since-count below
  // treats a missing date as "unknown" and says so rather than inventing a
  // day the ask went out.
  try {
    const legacy = JSON.parse(storage.getItem(LEGACY) || "[]") as unknown;
    if (!Array.isArray(legacy)) return [];
    return legacy
      .filter((x): x is string => typeof x === "string" && !!x.trim())
      .map((sender) => ({ sender: sender.toLowerCase(), askedISO: "", via: "header" as UnsubVia }))
      // askedISO "" fails the shape check above on the way back IN, so these
      // are only ever the read-through of a device that has not asked again.
      .slice(-CAP);
  } catch {
    return [];
  }
}

export function recordUnsub(
  r: UnsubRecord,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): UnsubRecord[] {
  const sender = r.sender.trim().toLowerCase();
  if (!sender) return loadUnsubs(storage);
  const next = [...loadUnsubs(storage).filter((x) => x.sender !== sender), { ...r, sender }].slice(-CAP);
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

/** Every address that has been asked, for the offer paths that only need to
 *  know "have we already asked about this one". Keeps loadAsked's contract. */
export function askedSenders(records: UnsubRecord[]): string[] {
  return records.map((r) => r.sender);
}

export interface StillSending {
  record: UnsubRecord;
  /** Threads from that sender dated after the ask. */
  since: number;
}

// THREE IS THE NUMBER. One more mail after an unsubscribe is the queue
// draining, which is normal and is what "takes a few days" means. Three is a
// sender that did not stop.
export const BLOCK_AFTER = 3;

/** Who is still sending after being asked, from the rows already loaded. No
 *  fetch: this is a fact about mail already in hand. */
export function stillSending(
  records: UnsubRecord[],
  rows: { fromEmail: string; dateMs: number }[],
): StillSending[] {
  const out: StillSending[] = [];
  for (const r of records) {
    if (!r.askedISO) continue; // migrated: no date, so nothing can be counted from it
    const after = Date.parse(r.askedISO + "T23:59:59");
    if (!isFinite(after)) continue;
    const since = rows.filter((x) => (x.fromEmail || "").toLowerCase() === r.sender && x.dateMs > after).length;
    if (since > 0) out.push({ record: r, since });
  }
  return out.sort((a, b) => b.since - a.since);
}

function daysAgo(iso: string, today: string): number {
  const a = Date.parse(iso + "T12:00:00");
  const b = Date.parse(today + "T12:00:00");
  if (!isFinite(a) || !isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** The receipt line: when you asked, and whether it worked. A fact, and the
 *  Block offer is a separate control rather than a sentence telling anybody
 *  what to do about it. */
export function unsubReceipt(r: UnsubRecord, since: number, today: string): string {
  if (!r.askedISO) return since > 0 ? capAfterNumber(`Asked · ${since} since`) : "Asked";
  const d = daysAgo(r.askedISO, today);
  const when = d === 0 ? "today" : d === 1 ? "yesterday" : d < 14 ? `${d} days ago` : `${Math.round(d / 7)} weeks ago`;
  return capAfterNumber(since > 0 ? `Asked ${when} · Still sending` : `Asked ${when}`);
}

export function canBlock(s: StillSending): boolean {
  return s.since >= BLOCK_AFTER;
}
