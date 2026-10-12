// ONE INBOX ROW (Email v1 spec 2026-10-08 sections 2.3, 4, 15 V01; the
// approved inbox visual of 2026-10-08). The contact badge (a sender's initials
// in a colour of their own, the same colour every time, from the category
// palette and never the brand red) with the unread dot at its shoulder; the
// sender, bold, and the time on line one; the subject; the first words of the
// message in the row's one grey; a chevron. The account rides after those words
// as small caps when more than one mailbox is in the list, and "Same Content"
// beside it when another connected mailbox holds the exact same Message-ID
// (3.3): a label, never a merge. The whole row is the door; in select mode the
// whole row is the selection circle's door instead (spec 11).

import { memo } from "react";
import { Check, ChevronRight, Paperclip } from "../shared/icons";
import "../styles/mail-rows.css";
import { pressable } from "../shared/pressable";
import { faceSlot } from "../messages/rowAnatomy";
import { senderOf, whenShort } from "./format";
import { SAME_CONTENT } from "./copy";
import type { InboxRow } from "./emailClient";

/** Two letters for the badge: the first and last word of the name, else the address's first two. */
export function initialsOf(r: Pick<InboxRow, "from_name" | "from_address">): string {
  const words = r.from_name.replace(/["'(),.<>@]/g, " ").trim().split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  if (words.length >= 2) return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  const local = r.from_address.split("@")[0] ?? "";
  return (local.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2) || "?").toUpperCase();
}

function MailRowBody({ row, accountLabel, now, onOpen, selecting = false, picked = false, onPick, sameContent = false }: {
  row: InboxRow;
  /** More than one mailbox is in the list, so each row says whose it is; empty when there is one. */
  accountLabel: string;
  now: Date;
  onOpen: (row: InboxRow) => void;
  /** Select mode: the row toggles its circle instead of opening. */
  selecting?: boolean;
  picked?: boolean;
  onPick?: (row: InboxRow) => void;
  /** Another connected mailbox holds this exact Message-ID (3.3). */
  sameContent?: boolean;
}) {
  const name = senderOf(row);
  const unread = !row.read;
  const subject = row.subject.trim() || "(No Subject)";
  const snippet = row.snippet.trim();
  const tap = selecting && onPick ? () => onPick(row) : () => onOpen(row);
  const label = `${name} · ${subject}${unread ? " · Unread" : ""}${sameContent ? " · " + SAME_CONTENT : ""}`;
  return (
    <div className={"row mrow erow" + (picked ? " picked" : "")} {...pressable(tap)} aria-label={label}
      {...(selecting ? { "aria-pressed": picked } : {})}>
      {selecting && <span className={"sel-box" + (picked ? " on" : "")} aria-hidden="true">{picked && <Check className="ic" />}</span>}
      <span className={"mav cat-fg-" + faceSlot(row.from_address || name)} aria-hidden="true">
        {initialsOf(row)}
        {unread && <span className="munread" />}
      </span>
      <div className="ms">
        <div className="mline1">
          <span className={"mfrom" + (unread ? " strong" : "")}>{name}</span>
          <span className="mwhen">{whenShort(row.internal_date, now)}</span>
        </div>
        <div className="msubj">
          {subject}
          {row.attachment_metadata.length > 0 && <Paperclip className="mclip" aria-label="Has Attachments" />}
        </div>
        {(snippet || accountLabel || sameContent) && (
          <div className="mline3">
            {snippet && <span className="msnip">{snippet}</span>}
            {accountLabel && <span className="macct">{accountLabel}</span>}
            {sameContent && <span className="macct msame">{SAME_CONTENT}</span>}
          </div>
        )}
      </div>
      {!selecting && <ChevronRight className="mchev" aria-hidden="true" />}
    </div>
  );
}

// A LONG LIST DOES NOT REDRAW EVERY ROW (slice 09; IMPLEMENTATION-SPEC.md 17:
// "500-row cache scroll free of repeated full-list rerenders"). The parent
// re-renders on every keystroke, card and sync; a row redraws only when its
// own row object, its label, its selection or its handlers changed, or the
// clock crossed a minute (the time words are minute-coarse). InboxList.test.tsx counts.
const sameMinute = (a: Date, b: Date): boolean => Math.floor(a.getTime() / 60000) === Math.floor(b.getTime() / 60000);
const MailRow = memo(MailRowBody, (a, b) => a.row === b.row && a.accountLabel === b.accountLabel && a.onOpen === b.onOpen && sameMinute(a.now, b.now)
  && a.selecting === b.selecting && a.picked === b.picked && a.onPick === b.onPick && a.sameContent === b.sameContent);
export default MailRow;
