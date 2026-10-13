// THE CONTACT SHEET (issue 112, item 14; Email v1 spec 2.3 and 4: "tap avatar for contact sheet", "Each source row has one tap
// target for detail plus an avatar target for contact"; the trim decisions keep "Name, avatar/initials, group badge, recent email
// threads" and defer interaction facts, coverage disclosure and notes).
//
// It opens over whatever is showing (the inbox, a search, the review list, an open message) when the sender's circle is tapped.
// It says who the address is, from the People store as it stands this moment (contactResolve.ts), and nothing it cannot prove:
//
//   the head      the circle, the name (the saved one when exactly one contact carries the address, else the sender's own), the
//                 raw address as the head's one grey, and the status: the contact's saved groups with their Area dots, or
//                 Not in Contacts, or Your Mailbox. Nothing at all when the People store could not be read.
//   Choose Contact  only when two or more contacts carry the address: each is a door to that contact. No silent winner.
//   Recent Mail   up to five messages from exactly this address, newest first, each a door to its message.
//   Open Contact  the one action, only when a single contact matched and the shell gave Email a way to open one.
//
// Not here, on purpose (trim decisions and the P0 map, AC09): sent counts, last sent, first seen, notes, linked records, Waiting
// for this contact, Add to Contacts. Rows are plain doors with no pill inside; the action sits in the sheet's own action line.
// Everything is drawn from existing primitives, so light and dark differ in colour only.

import { createPortal } from "react-dom";
import { titleCase } from "../shared/casing";
import { rowDoor } from "../shared/rowDoor";
import type { Category } from "../categories/types";
import { faceSlot } from "../messages/rowAnatomy";
import { DONE } from "./AccountStatusSheet";
import { CHOOSE_CONTACT, CONTACT_LABEL, NOT_IN_CONTACTS, NO_SUBJECT, OPEN_CONTACT, RECENT_MAIL, YOUR_MAILBOX } from "./copy";
import { groupFacts, type Resolved } from "./contactResolve";
import type { InboxRow } from "./emailClient";
import EmailFacts from "./EmailFacts";
import { whenFacts, type EmailFact } from "./format";
import { initialsOf } from "./MailRow";

/** The sender as the message wrote them: the raw address (always shown) and the display name (possibly empty). */
export interface ContactTarget { address: string; name: string }

/** The line under the address: what the People store says about it, as facts. Empty draws nothing. */
function statusFacts(resolved: Resolved, categories: readonly Category[]): EmailFact[] {
  switch (resolved.kind) {
    case "one": return groupFacts(resolved.person, categories);
    case "none": return [{ text: NOT_IN_CONTACTS, strong: true }];
    case "own": return [{ text: YOUR_MAILBOX, strong: true }];
    // Many says so in its own heading below; Unknown claims nothing.
    case "many":
    case "unknown": return [];
  }
}

export default function ContactSheet({ target, resolved, categories, recent, labels, now, onOpenMessage, onOpenContact, onClose }: {
  target: ContactTarget;
  resolved: Resolved;
  categories: readonly Category[];
  /** Mail from exactly this address, newest first, already narrowed (contactResolve.ts recentFrom). */
  recent: readonly InboxRow[];
  /** The label each mailbox wears; empty when there is one mailbox. */
  labels: Record<string, string>;
  now: Date;
  /** A recent message was tapped: the sheet closes first, then the flow opens it. */
  onOpenMessage: (row: InboxRow) => void;
  /** Open this contact in the Contacts module. Absent (a build with no way there): the rows are not doors and Open Contact is not drawn. */
  onOpenContact?: (personId: string) => void;
  onClose: () => void;
}) {
  const person = resolved.kind === "one" ? resolved.person : null;
  const sentName = target.name.trim();
  const name = person ? person.data.name : sentName || target.address;
  // The circle says what the row's own circle says, from the name this sheet shows (the saved one when there is one).
  const initials = initialsOf({ from_name: person ? person.data.name : sentName, from_address: target.address });
  const go = (id: string) => { onClose(); onOpenContact?.(id); };
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" role="dialog" aria-label={`${CONTACT_LABEL} ${target.address}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="pad-x sheet-list">
          <div className="email-head">
            <div className="email-from">
              {/* The contact badge: the very circle the person tapped on the row (mail-rows.css .mav, the sender's own hue, two letters), not the message head's neutral one-letter face. */}
              <span className={"mav cat-fg-" + faceSlot(target.address)} aria-hidden="true">{initials}</span>
              <div className="email-from-who">
                <div className="email-from-top"><span className="email-from-name">{name}</span></div>
                {/* The raw address stays visible (spec 4). When it already is the title it is not said twice. */}
                {name !== target.address && <EmailFacts wrap facts={[{ text: target.address }]} />}
                <EmailFacts wrap facts={statusFacts(resolved, categories)} />
              </div>
            </div>
          </div>

          {resolved.kind === "many" && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">{CHOOSE_CONTACT}</span></div>
              <div className="card list-card-ruled">
                {resolved.people.map((p) => (
                  <div className="row" key={p.id} {...(onOpenContact ? rowDoor(() => go(p.id)) : {})}>
                    <div className="row-grow">
                      <div className="conn-name truncate">{p.data.name}</div>
                      <EmailFacts facts={groupFacts(p, categories)} />
                    </div>
                    {onOpenContact && <div className="chev" />}
                  </div>
                ))}
              </div>
            </>
          )}

          {recent.length > 0 && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">{RECENT_MAIL}</span></div>
              <div className="card list-card-ruled">
                {recent.map((r) => {
                  const mailbox = labels[r.account];
                  return (
                    <div className="row" key={r.id} {...rowDoor(() => { onClose(); onOpenMessage(r); })}>
                      <div className="row-grow">
                        <div className="conn-name truncate">{r.subject.trim() || NO_SUBJECT}</div>
                        {/* The mailbox, when there is more than one, is the small-caps label the inbox row wears (Waiting draws it the same way). */}
                        <EmailFacts facts={[...whenFacts(r.internal_date, now), ...(mailbox ? [{ text: titleCase(mailbox), tone: "date" as const }] : [])]} />
                      </div>
                      <div className="chev" />
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <div className="xs-foot" />
        </div>

        {person && onOpenContact && (
          <div className="action-sheet"><button onClick={() => go(person.id)}>{OPEN_CONTACT}</button></div>
        )}
      </div>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="action-sheet"><button className="cancel" onClick={onClose}>{DONE}</button></div>
      </div>
    </div>,
    document.body,
  );
}
