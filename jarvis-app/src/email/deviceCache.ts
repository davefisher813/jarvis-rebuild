// WHAT THIS PHONE REMEMBERS OF THE INBOX (docs/jarvis-unified, slice 05;
// IMPLEMENTATION-SPEC.md 08 E22, 11). Offline, the last page the person saw
// and the messages they opened stay readable; nothing else. The keys ride
// under the mail cache's owner prefix (messages/mailCache.ts), so sign-out
// and Clear Local Data remove them with the rest, and one owner's mail never
// shows under another's session. Browser storage is not secrecy (11) and is
// never described as such; it is a copy of what Gmail already holds, scoped
// and versioned (the stored-shapes law).

import { ACCOUNT_PREFIX } from "../messages/mailCache";
import { mailAccountKey } from "../messages/mailIdentity";
import type { EmailAccount, InboxRow, MessageDetail } from "./emailClient";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const SNAPSHOT_ROWS_MAX = 300;
const MESSAGES_MAX = 40;

const key = (userId: string, name: string): string => ACCOUNT_PREFIX + mailAccountKey({ userId, account: "unified" }) + ":" + name + ".v1";

export interface InboxSnapshot {
  v: 1;
  savedAt: string;
  accounts: EmailAccount[];
  rows: InboxRow[];
}

export function loadSnapshot(userId: string, storage: Store = localStorage): InboxSnapshot | null {
  try {
    const raw = JSON.parse(storage.getItem(key(userId, "inbox")) || "null") as Partial<InboxSnapshot> | null;
    if (!raw || raw.v !== 1 || !Array.isArray(raw.rows) || !Array.isArray(raw.accounts) || typeof raw.savedAt !== "string") return null;
    return { v: 1, savedAt: raw.savedAt, accounts: raw.accounts, rows: raw.rows };
  } catch { return null; }
}

export function saveSnapshot(userId: string, s: { accounts: EmailAccount[]; rows: InboxRow[] }, now: () => string = () => new Date().toISOString(), storage: Store = localStorage): void {
  const snap: InboxSnapshot = { v: 1, savedAt: now(), accounts: s.accounts, rows: s.rows.slice(0, SNAPSHOT_ROWS_MAX) };
  try { storage.setItem(key(userId, "inbox"), JSON.stringify(snap)); } catch { /* private mode or full: the next load reads the server */ }
}

interface MessageStore { v: 1; items: Record<string, { at: string; m: MessageDetail }> }

function loadStore(userId: string, storage: Store): MessageStore {
  try {
    const raw = JSON.parse(storage.getItem(key(userId, "messages")) || "null") as Partial<MessageStore> | null;
    if (!raw || raw.v !== 1 || !raw.items || typeof raw.items !== "object") return { v: 1, items: {} };
    return { v: 1, items: raw.items };
  } catch { return { v: 1, items: {} }; }
}

export function loadMessage(userId: string, id: string, storage: Store = localStorage): MessageDetail | null {
  return loadStore(userId, storage).items[id]?.m ?? null;
}

/** Keeps the newest MESSAGES_MAX opened messages; the oldest open leaves first. */
export function saveMessage(userId: string, m: MessageDetail, now: () => string = () => new Date().toISOString(), storage: Store = localStorage): void {
  const store = loadStore(userId, storage);
  store.items[m.id] = { at: now(), m };
  const ids = Object.keys(store.items).sort((a, b) => store.items[b]!.at.localeCompare(store.items[a]!.at));
  for (const id of ids.slice(MESSAGES_MAX)) delete store.items[id];
  try { storage.setItem(key(userId, "messages"), JSON.stringify(store)); } catch { /* private mode or full */ }
}

/** A message that left the inbox (archived, trashed) or left Gmail: forgotten here too, so it cannot come back from this phone. */
export function forgetMessage(userId: string, id: string, storage: Store = localStorage): void {
  const store = loadStore(userId, storage);
  if (!(id in store.items)) return;
  delete store.items[id];
  try { storage.setItem(key(userId, "messages"), JSON.stringify(store)); } catch { /* private mode */ }
}
