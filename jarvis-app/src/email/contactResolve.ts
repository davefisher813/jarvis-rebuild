// THE SENDER'S CONTACT, RESOLVED THE MOMENT THE SHEET OPENS (issue 112, item 14; Email v1 spec section 4, "Recognize a
// person": saved group, tap the circle for the contact sheet, never infer familiarity from a display name).
//
// What this answers is one question: is the address on this message one the person has saved? Exactly, or not at all.
//   - The address is compared with every email a contact carries (the primary and the rest), trimmed, bare or inside angle
//     brackets, lowercased. Dots and plus tags are NEVER stripped: that is a provider's rule, and guessing it merges two
//     real people (people/contactMethods.ts normEmail says the same in so many words).
//   - A name is never matched. Two people called Maya Chen are two people, and a sender who writes "Maya Chen" is not the
//     contact of that name unless the address says so (AC08). Aliases are names, so they are not read either.
//   - The person's own mailboxes are not contacts, even when one is saved as a contact (spec 4: own addresses excluded).
//   - Two or more contacts that carry the address are Many, listed for the person to choose from. There is no silent winner,
//     and nothing here saves a link: choosing one only opens that contact in the Contacts module, where merging is the
//     owner's explicit act. Email invents no merge engine.
//   - A People store that could not be read is Unknown, which claims nothing. Saying Not in Contacts then would be a
//     fabricated fact (AC10: a fact that is unavailable is omitted, never guessed).
// Nothing is stored. The answer is recomputed on every open, which is what makes a rename or a deletion current.

import { emailsOf, normEmail } from "../people/contactMethods";
import type { Person } from "../people/types";
import type { Category } from "../categories/types";
import { newestFirst, type InboxRow } from "./emailClient";
import type { EmailFact } from "./format";

export type Resolved =
  | { kind: "unknown" }
  | { kind: "own" }
  | { kind: "none" }
  | { kind: "one"; person: Person }
  | { kind: "many"; people: Person[] };

/** How many messages the sheet lists. The sheet is a glance at the sender, not a mailbox view. */
const RECENT_MAX = 5;

/** The key two addresses are compared on: the address alone (the part inside < > when there is one), trimmed and lowercased. */
export function addressKey(raw: string): string {
  const s = raw.trim();
  const inside = /<([^<>]*)>/.exec(s);
  return normEmail(inside ? inside[1]! : s);
}

/**
 * The contact behind an address. `people` is null when the store could not be read; `own` is every connected mailbox's address.
 * Order matters: the person's own mailbox is certain without the store, so it is answered before the store is asked.
 */
export function resolveSender(address: string, people: readonly Person[] | null, own: readonly string[]): Resolved {
  const key = addressKey(address);
  if (!key) return { kind: "none" };
  if (own.some((a) => addressKey(a) === key)) return { kind: "own" };
  if (people === null) return { kind: "unknown" };
  const hit = people.filter((p) => emailsOf(p.data).some((m) => addressKey(m.value) === key));
  if (hit.length === 0) return { kind: "none" };
  if (hit.length === 1) return { kind: "one", person: hit[0]! };
  return { kind: "many", people: hit };
}

/** A contact's saved groups (the Areas they belong to) as facts: the name with the area's own dot. An id with no area left is skipped. */
export function groupFacts(p: Person, categories: readonly Category[]): EmailFact[] {
  const out: EmailFact[] = [];
  const seen = new Set<string>();
  for (const id of p.data.categoryIds ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const c = categories.find((x) => x.id === id);
    if (c) out.push({ text: c.data.name, cat: c.data.color });
  }
  return out;
}

/**
 * Recent mail FROM exactly this address, newest first, one message per thread (the newest from them), at most five.
 * The cached search that feeds this also returns mail that merely mentions the address in its words, so the sender is
 * checked here, on the exact address, and nothing else counts. Trash and Spam are not recent mail. Pools are given in order
 * of trust: when the same message is in two, the first one's copy is kept (the flow's loaded rows carry the read state the
 * person has just changed).
 */
export function recentFrom(address: string, pools: readonly (readonly InboxRow[])[], max: number = RECENT_MAX): InboxRow[] {
  const key = addressKey(address);
  if (!key) return [];
  const byId = new Map<string, InboxRow>();
  for (const pool of pools) {
    for (const r of pool) {
      if (addressKey(r.from_address) !== key) continue;
      if (r.provider_labels.includes("TRASH") || r.provider_labels.includes("SPAM")) continue;
      if (!byId.has(r.id)) byId.set(r.id, r);
    }
  }
  const byThread = new Map<string, InboxRow>();
  for (const r of byId.values()) {
    // A message with no thread id is its own thread: two such messages are not one conversation.
    const k = r.thread_id ? r.account_id + "\u0000" + r.thread_id : "message:" + r.id;
    const have = byThread.get(k);
    if (!have || newestFirst(r, have) < 0) byThread.set(k, r);
  }
  return [...byThread.values()].sort(newestFirst).slice(0, max);
}
