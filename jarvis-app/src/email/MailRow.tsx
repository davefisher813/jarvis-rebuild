// ONE INBOX ROW (docs/jarvis-unified, slice 05; IMPLEMENTATION-SPEC.md 08
// E01, 09 M1). The anatomy is the approved mail row (mail-rows.css, Dave's
// picks 2026-09-12): a 34px lead slot with a face or a machine's rail, the
// sender and the time on line one, the subject on line two, bold only when
// unread, the account as small caps after it when more than one mailbox is
// in the list. The whole row is the door; it holds no control of its own.

import { memo } from "react";
import { Paperclip } from "../shared/icons";
// The approved row anatomy. MessagesFlow imports this sheet for itself; this
// tab mounts instead of it, so it brings the sheet along.
import "../styles/mail-rows.css";
import { pressable } from "../shared/pressable";
import { leadFor } from "../messages/rowAnatomy";
import { senderOf, whenShort } from "./format";
import type { InboxRow } from "./emailClient";

function MailRowBody({ row, accountLabel, now, onOpen }: {
  row: InboxRow;
  /** More than one mailbox is in the list, so each row says whose it is; empty when there is one. */
  accountLabel: string;
  now: Date;
  onOpen: (row: InboxRow) => void;
}) {
  const name = senderOf(row);
  const lead = leadFor({ from: row.from_name, fromEmail: row.from_address, displayName: name }, now);
  const strong = !row.read;
  const line2 = row.subject.trim() || row.snippet.trim() || "(No Subject)";
  return (
    <div className="row mrow" {...pressable(() => onOpen(row))} aria-label={`${name} · ${line2}${strong ? " · Unread" : ""}`}>
      <span className="mlead">
        {lead.kind === "rail"
          ? <span className={"mrail" + (lead.railTone === "warn" ? " due" : "")}></span>
          : <span className={"mface cat-bg-" + lead.face} aria-hidden="true">{lead.initial}</span>}
      </span>
      <div className="ms">
        <div className="mline1">
          <span className={"mfrom" + (strong ? " strong" : "")}>{name}</span>
          <span className="mwhen">{whenShort(row.internal_date, now)}</span>
        </div>
        <div className={"mline2" + (strong ? " strong" : "")}>
          {line2}
          {row.attachment_metadata.length > 0 && <Paperclip className="mclip" aria-label="Has Attachments" />}
          {accountLabel && <span className="macct">{accountLabel}</span>}
        </div>
      </div>
    </div>
  );
}

// A LONG LIST DOES NOT REDRAW EVERY ROW (slice 09; IMPLEMENTATION-SPEC.md 17:
// "500-row cache scroll free of repeated full-list rerenders"). The parent
// re-renders on every keystroke, card and sync; a row redraws only when its
// own row object, its label or its handler changed, or the clock crossed a
// minute (the time words are minute-coarse). InboxList.test.tsx counts.
const sameMinute = (a: Date, b: Date): boolean => Math.floor(a.getTime() / 60000) === Math.floor(b.getTime() / 60000);
const MailRow = memo(MailRowBody, (a, b) => a.row === b.row && a.accountLabel === b.accountLabel && a.onOpen === b.onOpen && sameMinute(a.now, b.now));
export default MailRow;
