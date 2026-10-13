// WHY THIS SECTION? (Email v1 spec 3.2: "Click Why this section? for the rule and evidence"; issue 112, item 15).
//
// A small sheet that says, in facts, why one message sits in the section it does: the rule that decided it, and the evidence
// that rule read. It is the answer sections.ts already computed (whySection), never a second opinion, so it cannot disagree
// with where the row is drawn. At most three rows, each a name and one facts line with at most one grey, and no pill inside
// any of them:
//
//   Rule              what is true of the message ("You Sent a Message in This Thread")
//   Evidence          what the rule read: the mailbox, the calendar structure, the registered sender and the registry's word
//                     for the message, the list header; or the one honest caveat when the data is thin. Absent when it adds nothing.
//   Without Your Move only for a message the person moved: the section its own facts would give it
//
// The actions are the sheet's own, below the rows (a quiet text action each, never a capsule in a row): Move to Section, the
// same picker the message sheet opens, and Use Its Own Section when the person moved it. Reading this sheet writes nothing,
// reads no body and changes nothing in Gmail. Modelled on AccountStatusSheet: one card of rows and actions, one card with Done.
// Per-sender rules are not here and not offered: the spec rules out a rules builder, and a move applies to its one message.

import { createPortal } from "react-dom";
import type { InboxRow } from "./emailClient";
import EmailFacts from "./EmailFacts";
import { whenFacts, type EmailFact } from "./format";
import { DONE } from "./AccountStatusSheet";
import {
  MOVE_TO_SECTION, PUT_BACK_SECTION, WHY_CAL, WHY_LIST, WHY_MONEY_AMBIGUOUS, WHY_MONEY_WORD, WHY_NO_FACTS, WHY_ROW_EVIDENCE, WHY_ROW_RULE,
  WHY_ROW_WITHOUT_MOVE, WHY_RULE, WHY_SAVED_HERE, WHY_SECTION, WHY_SENT_FOUND, whyIn,
} from "./copy";
import { SECTION_NAME, SECTION_SLOT, whySection, type Overrides, type SectionKey, type SectionWhy, type WhyEvidence } from "./sections";
import { titleCase } from "../shared/casing";

/** A section as a fact: its name with its own dot (the colour its heading wears), or in white when it has none (Other). Never a second grey. */
function sectionFact(key: SectionKey): EmailFact {
  const slot = SECTION_SLOT[key];
  return slot ? { text: SECTION_NAME[key], cat: slot } : { text: SECTION_NAME[key], strong: true };
}

/** The one honest thing to say when a row's facts are thin, or nothing. Two Money templates fitting outranks missing facts: it is why the row is Other. */
function caveatFacts(e: Extract<WhyEvidence, { kind: "other" }>): EmailFact[] {
  if (e.moneyAmbiguous) return [{ text: WHY_MONEY_AMBIGUOUS }];
  return e.factsKept ? [] : [{ text: WHY_NO_FACTS }];
}

/** What the rule read, as facts. Every line is a fact the resolver used; the mailbox and the sender are the data's own words, in white. */
function evidenceFacts(e: WhyEvidence, row: Pick<InboxRow, "account">, movedAt: string | null, now: Date): EmailFact[] {
  switch (e.kind) {
    case "moved": return [{ text: WHY_SAVED_HERE }, ...(movedAt ? whenFacts(movedAt, now) : [])];
    case "conversation": return [{ text: WHY_SENT_FOUND }, { text: row.account, strong: true }];
    case "calendar": return [{ text: WHY_CAL[e.hit] }];
    case "money": return [{ text: titleCase(e.issuer), strong: true }, { text: WHY_MONEY_WORD[e.semantics] }, { text: e.sender, strong: true }];
    case "list": return [{ text: e.listId && e.unsubscribe ? WHY_LIST.both : e.listId ? WHY_LIST.id : WHY_LIST.unsubscribe }];
    case "other": return caveatFacts(e);
  }
}

/** The sheet's rows, each a name and its facts. A row with nothing to say is not in the list. */
function whyRows(row: Pick<InboxRow, "account">, why: SectionWhy, movedAt: string | null = null, now: Date = new Date()): Array<[string, EmailFact[]]> {
  const e = why.evidence;
  const rows: Array<[string, EmailFact[]]> = [
    [WHY_ROW_RULE, [{ text: WHY_RULE[e.kind] }]],
    [WHY_ROW_EVIDENCE, evidenceFacts(e, row, movedAt, now)],
  ];
  if (e.kind === "moved") {
    const own = e.natural.evidence;
    rows.push([WHY_ROW_WITHOUT_MOVE, [sectionFact(e.natural.key), ...(own.kind === "other" ? caveatFacts(own) : [])]]);
  }
  return rows.filter(([, facts]) => facts.length > 0);
}

export default function WhySectionSheet({ row, overrides, movedAt = null, now = new Date(), onMove, onPutBack, onClose }: {
  row: InboxRow;
  overrides: Overrides;
  /** When the person's move was made (Settings keeps it beside the move). Absent: the sheet says nothing about when. */
  movedAt?: string | null;
  now?: Date;
  /** Open the Move to Section picker, the flow's own. */
  onMove: () => void;
  /** Use Its Own Section, the flow's own with its receipt and Undo. Offered only for a message the person moved. */
  onPutBack: () => void;
  onClose: () => void;
}) {
  const why = whySection(row, overrides);
  const rows = whyRows(row, why, movedAt, now);
  const acts: Array<{ label: string; run: () => void }> = [
    { label: MOVE_TO_SECTION, run: onMove },
    ...(why.evidence.kind === "moved" ? [{ label: PUT_BACK_SECTION, run: onPutBack }] : []),
  ];
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" role="dialog" aria-label={WHY_SECTION} onClick={(e) => e.stopPropagation()}>
        {/* Where the message sits, as every row sheet names its row; the dialog's name says what this is. */}
        <div className="grp"><div className="eyebrow">{whyIn(SECTION_NAME[why.key])}</div></div>
        <div className="list-card-ruled">
          {rows.map(([label, facts]) => (
            <div className="row" key={label}>
              <div className="row-grow">
                <div className="conn-name">{label}</div>
                <EmailFacts wrap facts={facts} />
              </div>
            </div>
          ))}
        </div>
        <div className="action-sheet">
          {acts.map((a) => <button key={a.label} onClick={() => { onClose(); a.run(); }}>{a.label}</button>)}
        </div>
      </div>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="action-sheet"><button className="cancel" onClick={onClose}>{DONE}</button></div>
      </div>
    </div>,
    document.body,
  );
}
