import type { MailAttachment } from "../connections/google/map";

// ATTACHMENTS BECOME THINGS (N2, plus N6 receipts, Dave 2026-08-20).
//
// A file in an inbox is a chore in a costume. An invoice PDF is a bill with
// an amount and a date. A .ics is events. A waiver is a task with someone's
// name on it. The file stops being a file the moment the app reads what it
// actually is.
//
// Laws:
//   - The FILENAME and the MIME type are evidence, never proof. Everything
//     here is an offer with a visible source; nothing is created silently.
//   - Money is never guessed from a filename. An amount comes from the body
//     or the sender's own words, or there is no amount and the bill offer
//     does not appear.
//   - A .ics is handled by the calendar handoff that already exists; this
//     only recognises it.

export type AttachKind = "bill" | "calendar" | "document" | "image" | "unknown";

const BILL_NAME = /(invoice|receipt|statement|bill|payment|remittance|due)/i;
const RECEIPT_SUBJECT = /(your (order|receipt)|order confirm|payment (received|confirm)|receipt for|invoice)/i;

export function attachKind(a: MailAttachment): AttachKind {
  const name = (a.filename || "").toLowerCase();
  const mime = (a.mime || "").toLowerCase();
  if (mime === "text/calendar" || name.endsWith(".ics")) return "calendar";
  if (mime.startsWith("image/")) return "image";
  if (BILL_NAME.test(name) && /pdf|msword|officedocument|octet-stream/.test(mime)) return "bill";
  if (/pdf|msword|officedocument|text\/plain/.test(mime)) return "document";
  return "unknown";
}

// Money, from the message rather than the filename. Currency-marked amounts
// only: "Net 15" and "Order #D2565" are numbers, not prices, and treating
// them as money is how a bill for $2,565 appears out of nowhere.
const MONEY = /(?:^|[\s(])[$£€]\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/g;

export function amountIn(text: string): number | null {
  MONEY.lastIndex = 0;
  const found: number[] = [];
  for (const m of text.matchAll(MONEY)) {
    const n = Number((m[1] ?? "").replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) found.push(n);
  }
  if (found.length === 0) return null;
  // The largest is the total far more often than the first: subtotals, tax
  // lines and per-item prices all appear before it.
  return Math.max(...found);
}

export interface AttachOfferInput {
  from: string;
  subject: string;
  body: string;
  attachments: MailAttachment[];
}

export interface AttachOffer {
  kind: "bill" | "calendar" | "task";
  title: string;
  sub: string;
  action: string;
  amount?: number;
  filename?: string;
  // The id needed to FETCH the file (2026-08-25). The calendar offer used to
  // carry only a filename, which is why its button could never do more than
  // tell you to open the attachment yourself.
  attachmentId?: string;
}

// One offer per message, the strongest one. A row of four offers under an
// email is a decision, and this exists to remove decisions.
export function attachOffer(input: AttachOfferInput): AttachOffer | null {
  const kinds = input.attachments.map((a) => ({ a, k: attachKind(a) }));

  const cal = kinds.find((x) => x.k === "calendar");
  if (cal) {
    return {
      kind: "calendar",
      title: "Add It to Your Calendar",
      sub: `${cal.a.filename} · From ${input.from}`,
      action: "Add",
      filename: cal.a.filename,
      attachmentId: cal.a.attachmentId,
    };
  }

  const bill = kinds.find((x) => x.k === "bill");
  const looksLikeMoney = bill || RECEIPT_SUBJECT.test(input.subject);
  if (looksLikeMoney) {
    const amount = amountIn(input.body);
    // No amount, no bill offer. A bill with no number is a task at best, and
    // inventing the number is not on the table.
    if (amount !== null) {
      return {
        kind: "bill",
        title: input.subject.trim().slice(0, 60) || "New Bill",
        sub: `$${amount.toLocaleString()} · From ${input.from}`,
        action: "Add Bill",
        amount,
        filename: bill?.a.filename,
      };
    }
  }

  // A bill-named file with no amount behind it is still a document he has to
  // deal with. It falls through to here rather than vanishing, because the
  // alternative to a made-up bill is a task, not silence.
  const doc = kinds.find((x) => x.k === "document" || x.k === "bill");
  if (doc) {
    return {
      kind: "task",
      title: `Deal With ${doc.a.filename}`,
      sub: `From ${input.from}`,
      action: "Add Task",
      filename: doc.a.filename,
    };
  }
  return null;
}
