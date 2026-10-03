import type { BillSource, ReceiptSource, TxSource } from "./types";

// ONE PURCHASE, ONE RECORD (ledger, hard rule 4). A fingerprint is a plain,
// readable string so a duplicate can be explained to a person, not a hash that
// can only be compared.

/** Lowercase, punctuation stripped, spaces collapsed: "Stop & Shop!" and
 *  "STOP  SHOP" are the same vendor. Matching and fingerprints both use this. */
export function normalizeVendor(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

/** What counts as "the same source" for a duplicate. Typed and photographed
 *  are one class ("local"): the same purchase entered twice by hand and by
 *  camera is a double count, not two receipts. An email is its message. */
export function sourceKey(src: BillSource | ReceiptSource | TxSource): string {
  if (typeof src === "string") return src === "import" ? "import" : "local";
  return "email:" + src.fingerprint;
}

export type FingerprintKind = "bill" | "receipt" | "tx";

export function fingerprintOf(p: {
  kind: FingerprintKind;
  vendor: string;
  amountCents: number;
  /** due date for a bill, transaction date for a receipt, date for a tx. Empty when there is none. */
  date?: string;
  source: BillSource | ReceiptSource | TxSource;
}): string {
  return [p.kind, normalizeVendor(p.vendor), String(p.amountCents), p.date ?? "", sourceKey(p.source)].join("|");
}

/** The first existing record with this fingerprint, or undefined. A materially
 *  changed repeat (other amount, other date, a cancellation) has another
 *  fingerprint and is a new record that may surface again. */
export function findDuplicate<T extends { data: { fingerprint?: string } }>(existing: T[], fingerprint: string): T | undefined {
  return existing.find((r) => r.data.fingerprint === fingerprint);
}
