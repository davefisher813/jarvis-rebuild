import { createPortal } from "react-dom";
import type { ProgramSuggestion } from "./patterns";
import { MUSCLE_LABEL } from "./muscles";
import { Tile } from "../shared/FormSheet";
import { CalendarDays, FileText, RotateCcw, Sparkles } from "../shared/icons";
import { lineCase } from "../shared/casing";
import { pressable } from "../shared/pressable";

const CHEV = <div className="chev" />;

/**
 * THE PROGRAM SUGGESTION (mockup 10, adapted; Dave 2026-10-09: "the program
 * emerges from behavior"). Shown once, on the way out of a receipt, when the
 * same workout from scratch keeps happening (the rule is gym/patterns.ts's).
 * Opt-in by construction: nothing is created or attached until he taps a row.
 * Not Now remembers this workout so it is not offered again; a tap outside
 * the sheet simply closes it and saves the workout as it is.
 *
 * Rows, not option cards: no red border, no tint and no glow, because red is
 * a verb. No corner X (no card carries a corner dismiss).
 */
export default function ProgramSuggestSheet({ suggestion, onCreate, onChoose, onNotNow, onDismiss }: {
  suggestion: ProgramSuggestion;
  /** Save this workout as a new program with the suggested name. */
  onCreate: () => void;
  /** Add it to a program day he already has. Absent when he has none. */
  onChoose?: () => void;
  /** Keep it as a one-off and stop offering this one. */
  onNotNow: () => void;
  /** A tap outside: keep it as a one-off, and ask again next time. */
  onDismiss: () => void;
}) {
  return createPortal(
    <div className="sheet-scrim" onClick={onDismiss}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Program Suggestion</div></div>
        <div className="pad-x sheet-form">
          <Tile tone="pink"><Sparkles className="ic" /></Tile>
          <div className="strand-head">{suggestion.title}</div>
          <div className="facts">
            {/* Lime is what is logged (§AM): these workouts happened. */}
            <span className="fact lime">{lineCase(`${suggestion.count} similar workouts`)}</span>
            {/* One fact per muscle, so the line wraps between them, never inside one. */}
            {suggestion.muscles.map((m) => <span className="fact" key={m}>{MUSCLE_LABEL[m]}</span>)}
          </div>
          <div className="grp"><div className="eyebrow">What to Do With It</div></div>
          <div className="card">
            <div className="row" {...pressable(onCreate)}>
              <Tile tone="green"><FileText className="ic" /></Tile>
              <div className="row-grow">
                <div className="conn-name">Create Program</div>
                <div className="conn-meta">{`Save as ${suggestion.name}`}</div>
              </div>
              {CHEV}
            </div>
            {onChoose && (
              <div className="row" {...pressable(onChoose)}>
                <Tile tone="sky"><CalendarDays className="ic" /></Tile>
                <div className="row-grow">
                  <div className="conn-name">Choose a Program</div>
                  <div className="conn-meta">Add It to a Program Day</div>
                </div>
                {CHEV}
              </div>
            )}
            <div className="row" {...pressable(onNotNow)}>
              <Tile tone="graphite"><RotateCcw className="ic" /></Tile>
              <div className="row-grow">
                <div className="conn-name">Not Now</div>
                <div className="conn-meta">Keep as a One-Off</div>
              </div>
              {CHEV}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
