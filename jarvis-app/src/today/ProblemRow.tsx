import { Fragment, useState } from "react";
import { pressable } from "../shared/pressable";

// TODAY'S PROBLEM ROW (issue 106 V2, approved by Dave 2026-10-13: "a recoverable problem on Today is ONE slim amber row below
// the greeting (per the amber ruling), actionable, and it disappears when resolved. Not a large red card at the top.").
//
// A problem used to be a ranked notice at the top of Your Move, the heaviest row in the stream: a glyph disc, a title, a grey
// line and a capsule (and the failed sweep's was red until issue 102 made it amber). Now Today has one place for what is wrong
// and can be mended: this row, directly under the greeting, drawn with the Email tab's connection strip whole (.conn-strip: the
// system amber fill, the dark on-fill ink, the outlined action), so Today and Email say one problem in one colour and nothing
// here is a new colour.
//
//  - ONE row, always. The first problem is drawn; any others are counted as a last part ("1 More") and take the row, one at a
//    time, as the first is mended. Nothing piles up.
//  - NO DISMISS AND NO SWIPE. A standing failure that could be waved off would be the false "all caught up" the connection
//    spec exists to end. It is gone only because it is no longer true: the row is drawn from live state every render and keeps
//    nothing of its own but "is this verb running".
//  - THE WORDS ARE PARTS, NOT A SENTENCE. Title Case, and the dot between two parts is drawn by the stylesheet (a part that opens
//    a wrapped line has none), never typed into a string.
//  - THE WORDS ARE A DOOR (Dave 2026-09-15, "I want all rows clickable"). With a verb, a tap on them does what the verb does;
//    with somewhere else to go (Connections), `onOpen` says where. With neither it is a plain status row and not button-shaped.

export interface Problem {
  /** The kind of problem, stable between renders: it names the row for tests and holds the verb's busy state. */
  key: string;
  /** The words in reading order, Title Case. Never a typed dot: the stylesheet draws the separator. */
  parts: string[];
  /** The one verb that mends it, or goes where it is mended. `run` reports its own failure (a toast): the row only holds
   *  still while it works, the button disabled (the app's own faded disabled button) and its label unchanged, because a longer
   *  label would widen the button, squeeze the words beside it and make the row jump as it is pressed. */
  action?: { label: string; run: () => void | Promise<void> };
  /** A tap on the words, for a problem whose door is not its verb. Without it the words take the verb's door, if there is one. */
  onOpen?: () => void;
}

/** The words, with a place to break after an @, a dot, a hyphen or an underscore. A narrow column (a 360 phone, large text) then
 *  cuts an address as "dave.fisher@" and "icloud.com", not "icloud.co" and "m". A <wbr> adds no character: the text, what a
 *  screen reader says and what is copied are the words themselves. */
function Words({ text }: { text: string }) {
  const bits = text.match(/[^@._-]+[@._-]?|[@._-]/g) ?? [text];
  return <>{bits.map((b, i) => <Fragment key={i}>{i > 0 && <wbr />}{b}</Fragment>)}</>;
}

export default function ProblemRow({ problems }: { problems: Problem[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const p = problems[0];
  if (!p) return null;
  const more = problems.length - 1;
  const parts = more > 0 ? [...p.parts, `${more} More`] : p.parts;
  const act = p.action;
  const working = !!act && busy === p.key;
  // One run at a time: a second tap while the first is working is the same tap twice.
  const go = async (): Promise<void> => {
    if (!act || working) return;
    setBusy(p.key);
    try { await act.run(); } finally { setBusy(null); }
  };
  const open = p.onOpen ?? (act ? () => void go() : undefined);
  return (
    <div className="conn-strip conn-strip-today" role="alert" data-problem={p.key}>
      <span className="conn-strip-text" {...(open ? pressable(open) : {})}>
        {parts.map((t, i) => <span key={i} className="conn-strip-part"><Words text={t} /></span>)}
      </span>
      {act && (
        <button type="button" className="conn-strip-act" disabled={working} aria-busy={working} onClick={() => void go()}>{act.label}</button>
      )}
    </div>
  );
}
