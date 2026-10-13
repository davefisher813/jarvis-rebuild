// WHY THIS SECTION? ON A SECTION HEADING (issue 112 remainder, 2026-10-13). The heading's own answer: what the section is
// for, and, for the messages loaded under it, which rule put them there and the facts that rule read (the registered
// senders, the list headers, the calendar structure, the mailboxes). It is the resolver's own reading (sections.ts
// sectionSummary, built from whySection), never a second opinion. When the loaded mail carries no specific reason, the
// sheet says so in one plain line instead of filling the space. Reading it writes nothing and changes nothing in Gmail.
// Modelled on WhySectionSheet: one card of rows, one card with Done.

import { createPortal } from "react-dom";
import EmailFacts from "./EmailFacts";
import type { EmailFact } from "./format";
import { DONE } from "./AccountStatusSheet";
import {
  SECTION_PURPOSE, WHY_CAL, WHY_FACTS_NOT_KEPT, WHY_LIST, WHY_MONEY_AMBIGUOUS, WHY_ROW_CAVEAT, WHY_ROW_FOR, WHY_ROW_FROM, WHY_ROW_HERE,
  WHY_ROW_MAILBOXES, WHY_RULE, WHY_SECTION, WHY_SECTION_NONE, messagesCount, whyIn,
} from "./copy";
import { SECTION_NAME, type SectionSummary, type WhyVia } from "./sections";
import { titleCase } from "../shared/casing";

const VIA_ORDER: WhyVia[] = ["moved", "conversation", "calendar", "money", "list", "other"];

/** The sheet's rows: a name (or none, continuing the row above) and one facts line with at most one grey. */
export function sectionWhyRows(s: SectionSummary): Array<[string, EmailFact[]]> {
  const rows: Array<[string, EmailFact[]]> = [[WHY_ROW_FOR, [{ text: SECTION_PURPOSE[s.key] }]]];
  // Nothing loaded, or Other whose messages all predate the kept facts: no rule can be named, and the sheet says so.
  const onlyNoFacts = s.key === "other" && s.total > 0 && s.noFacts === s.total && !s.byVia.moved;
  if (s.total === 0 || onlyNoFacts) {
    rows.push([WHY_ROW_HERE, [{ text: WHY_SECTION_NONE }]]);
    return rows;
  }
  const group = (label: string, lines: EmailFact[][]) => lines.forEach((f, i) => rows.push([i === 0 ? label : "", f]));
  group(WHY_ROW_HERE, VIA_ORDER.filter((v) => s.byVia[v]).map((v) => [{ text: WHY_RULE[v] }, { text: messagesCount(s.byVia[v]!), strong: true }]));
  if (s.issuers.length) rows.push([WHY_ROW_FROM, s.issuers.slice(0, 4).map((i) => ({ text: titleCase(i), strong: true }))]);
  if (s.accounts.length) rows.push([WHY_ROW_MAILBOXES, s.accounts.map((a) => ({ text: a, strong: true }))]);
  const notes: EmailFact[][] = [];
  for (const k of Object.keys(WHY_CAL) as Array<keyof typeof WHY_CAL>) if (s.calendar[k]) notes.push([{ text: WHY_CAL[k] }, { text: messagesCount(s.calendar[k]!), strong: true }]);
  if (s.lists.id) notes.push([{ text: WHY_LIST.id }, { text: messagesCount(s.lists.id), strong: true }]);
  if (s.lists.unsubscribe) notes.push([{ text: WHY_LIST.unsubscribe }, { text: messagesCount(s.lists.unsubscribe), strong: true }]);
  if (s.moneyAmbiguous) notes.push([{ text: WHY_MONEY_AMBIGUOUS }, { text: messagesCount(s.moneyAmbiguous), strong: true }]);
  if (s.noFacts) notes.push([{ text: WHY_FACTS_NOT_KEPT }, { text: messagesCount(s.noFacts), strong: true }]);
  group(WHY_ROW_CAVEAT, notes);
  return rows;
}

export default function SectionWhySheet({ summary, onClose }: { summary: SectionSummary; onClose: () => void }) {
  const rows = sectionWhyRows(summary);
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" role="dialog" aria-label={WHY_SECTION} onClick={(e) => e.stopPropagation()}>
        <div className="grp"><div className="eyebrow">{whyIn(SECTION_NAME[summary.key])}</div></div>
        <div className="list-card-ruled">
          {rows.map(([label, facts], i) => (
            <div className="row" key={i}>
              <div className="row-grow">
                {label && <div className="conn-name">{label}</div>}
                <EmailFacts wrap facts={facts} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="action-sheet"><button className="cancel" onClick={onClose}>{DONE}</button></div>
      </div>
    </div>,
    document.body,
  );
}
