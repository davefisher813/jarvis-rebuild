import type { UserFile } from "../files/types";
import type { Receipt } from "./ledger/types";

// WHAT THE RECEIPTS SECTION LISTS (Money ledger, 2026-10-03).

/** Newest first, by the day on the receipt; the day it was written breaks a tie
 *  (the one just added is the one being looked for). */
export function newestFirst(receipts: Receipt[]): Receipt[] {
  const born = (r: Receipt): string => r.data.history?.[0]?.at ?? "";
  return [...receipts].sort((a, b) =>
    b.data.transactionDate.localeCompare(a.data.transactionDate) || born(b).localeCompare(born(a)) || a.id.localeCompare(b.id));
}

/** The uploaded files that have no receipt record: what the section held before
 *  records existed. A file a record names is shown through that record, and a
 *  row still uploading (no path yet) is not a file yet. */
export function legacyFiles(files: UserFile[], receipts: Receipt[]): UserFile[] {
  const used = new Set(receipts.map((r) => r.data.attachmentFileId).filter((x): x is string => !!x));
  return files.filter((f) => !used.has(f.id) && f.data.path !== "");
}
