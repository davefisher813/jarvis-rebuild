import { createPortal } from "react-dom";

// THE RULE, PUBLISHED (2026-10-17, section 10, brief section 7: "the rule is
// published in the app"). The same words as the top of progression.ts, in the
// order the engine applies them, reachable from the Why row in a session and
// from Settings, Training. Short lines, never a paragraph (shortCopy law);
// never the word AI; a lighter week is a lighter week, never anything else.
// Nothing here is a draft, so the one way out is Done.

const RULES: { head: string; lines: string[] }[] = [
  { head: "The Range", lines: ["Your Plan's Reps Are a Range, Low to High", "A Single Target Is the Top; Two Under It Is the Bottom", "Hold the Weight and Add Reps Until Every Set Reaches the Top"] },
  { head: "The Step", lines: ["Every Set at the Top Steps the Weight About 2.5%, Never Over 5%", "Rounded to the Smallest Jump Your Equipment Makes", "Reps Reset to the Bottom of the Range, and the Expected Reps Are Shown", "A Jump Over 7% of the Weight Adds 3 Reps to the Range Instead"] },
  { head: "Each Set on Its Own", lines: ["A Setting, After 12 Sessions of a Lift", "A Set at the Top Steps for That Set Only; the Rest Add Reps"] },
  { head: "Two Strikes", lines: ["One Session Under the Bottom Repeats the Same Numbers", "A Second Miss Cuts the Weight 5%, or 10% Under 12 Sessions", "A Stall at the Same Weight Again Asks for a Different Rep Range Before a Swap"] },
  { head: "A Lighter Week", lines: ["Half the Sets at About 10% Less, Nothing to Failure", "On a Back-Off Week of Your Program", "After 5 Sessions Up Without a Lighter One", "When 2 in 5 of Last Week's Lifts Missed, or Last Week's Tonnage Fell 10%"] },
  { head: "Sets", lines: ["At Most 1 Set More for Each Lift Each Week", "Never in the Week the Weight Steps, and Only After a Week With No Misses", "Whether You Feel Recovered Is Your Call; the App Keeps No Reading of It"] },
  { head: "Inside a Session", lines: ["Set 1 Two or More Reps Short, or Marked Hard, Drops the Rest 5%", "Set 1 at the Top and Marked Easy Offers 2.5% More for the Rest, After 12 Sessions"] },
  { head: "Your Marks", lines: ["Easy, Right and Hard Are Never Required", "All Easy Lets a Step Through; Hard Holds It; Right Leaves the Reps to Decide"] },
  // Dave 2026-10-17: prefill. The step is in the fields; logging it as it is
  // takes it; a changed weight is his, and that step is offered from then on.
  { head: "Trust", lines: ["Every Suggestion Names Your Own Last Sets", "The Next Step Is Filled In; Log It as It Is to Take It", "Nothing Moves Until You Log It", "Change the Weight and Your Numbers Become the Baseline", "A Step You Changed Is Offered Next Time, Never Filled In; the App Never Argues Twice"] },
];

export default function HowSuggestionsSheet({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" role="dialog" aria-label="How Suggestions Work" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">How Suggestions Work</div></div>
        <div className="sheet-form pad-x">
          <div className="legal-body">
            {RULES.map((r) => (
              <div key={r.head}>
                <h4 className="legal-h">{r.head}</h4>
                {r.lines.map((l) => <p key={l}>{l}</p>)}
              </div>
            ))}
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button type="button" className="btn btn-tertiary btn-block" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
