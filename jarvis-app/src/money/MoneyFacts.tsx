import { lineCase } from "../shared/casing";
import { normalizeVendor } from "./ledger/fingerprint";
import { fmtCents, fmtDay, type TxAbout } from "./tracker";

// THE MONEY MODULE'S FACT PRIMITIVES (2026-10-05, Dave's visual catalog gate).
//
// Two shapes kept coming back as one joined string in a grey run: a record and
// the payment it is matched to ("Stop & Shop $47.12 Sep 8" in a row's meta),
// and an amount inside a sentence. A joined string cannot be coloured by what
// each part MEANS and it is one grey run holding three facts (R1, R5, R6), so
// each part is its own .fact span here and the CSS draws the dots.

/** The amounts in a quiet money line step up to white (§AM F1: a number with
 *  no state inside a grey line is a white <b>); the words keep the line's one
 *  grey. The dollar sign goes with its number, so the split is on the amount. */
export function Amounts({ text }: { text: string }) {
  return <>{text.split(/([-\u2212]?\$\d{1,3}(?:,\d{3})*(?:\.\d+)?|[-\u2212]?\$\d+(?:\.\d+)?)/).map((s, i) => (i % 2 === 1 ? <b key={i}>{s}</b> : s))}</>;
}

/** What a matched record says about the other side, as separate facts: the
 *  amount a white number (no state), the day a small-caps date, and the name,
 *  the row's one grey, LAST because a long name is the one fact that may
 *  shrink. A day that is not there is simply not drawn, and the name is drawn
 *  only when it is not the vendor the sheet already says above it (`sameAs`):
 *  a line that repeats what is already on the sheet says nothing, and a long
 *  name beside the Unmatch capsule wrapped and left a separator hanging. Render
 *  it inside a `.conn-meta` (a Row's `meta`), where the dots come from the CSS. */
export function LinkedFacts({ name, sameAs, cents, day }: { name?: string; sameAs?: string; cents: number; day?: string }) {
  const showName = !!name && !!name.trim() && (sameAs === undefined || normalizeVendor(name) !== normalizeVendor(sameAs));
  return (
    <>
      <span className="fact"><b>{fmtCents(cents)}</b></span>
      {day && <span className="fact date">{fmtDay(day)}</span>}
      {showName && <span className="fact">{lineCase(name!)}</span>}
    </>
  );
}

/** What a fee was charged FOR, the way the bank statement labels it (Dave,
 *  via Alfred, 2026-10-17: four $35 overdraft fees on one day, each for its
 *  own purchase, drawn identically). Two facts: "For MTA $19.00", the words the
 *  row's one grey and the amount a white number inside it (§AM F1), then the
 *  day the purchase posted as a small-caps date (F5). On an Activity row this
 *  stands where the category fact stood: the dot at the row's head already
 *  carries the category's colour and the merchant already says Overdraft Fee,
 *  so the row keeps one grey. The dot between them is the CSS's (F3). */
export function FeeAboutFacts({ about }: { about: TxAbout }) {
  return (
    <>
      <span className="fact">{lineCase("For " + about.merchant)} <b>{fmtCents(about.amountCents)}</b></span>
      {about.date && <span className="fact date">{fmtDay(about.date)}</span>}
    </>
  );
}
