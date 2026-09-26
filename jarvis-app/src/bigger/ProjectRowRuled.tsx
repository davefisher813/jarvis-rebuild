import type { Progress } from "./progress";
import { Bar, Nums } from "./GoalRowRuled";
import { FolderOpenGlyph, GoalMark } from "../shared/glyphs";
import { useLongPress } from "../shared/useLongPress";

// THE PROJECT ROW IS THE GOAL ROW (Dave 2026-09-13: "Let's make the format of
// projects as much like Goals as possible... the goals page looks much
// better"). One anatomy wherever a project is listed, on the Projects lens
// and on a goal's own page, line for line the goal row:
//
//   glyph    the folder, in the project's area colour, where the goal row
//            carries its target
//   line 1   the title, and Close at its right edge when the work is all
//            done and the project is waiting to be closed
//   line 2   what moves it next: a NEXT label (orange, Dave: "next should be
//            yellow or orange") and the action in full ink; with no next
//            move, the goal it is filed to
//   line 3   the count the bar draws, "3 of 4 Done", with the status at its
//            right edge, or the hold's date in its place
//   bar      the same bar the goal row draws
//
// The pie is gone from the ring slot: the bar says the same number, and one
// meter per row is the goal row's rule.

export default function ProjectRowRuled({ title, glyphTone, next = null, goal = null, meter, hold = null, status, bar, onOpen, onClose, onHold }: {
  title: string;
  /** A cat-fg-* class: the project's area colour. */
  glyphTone: string;
  next?: string | null;
  /** The goal it is filed to, shown only when there is no next move. The hue
   *  rides the goal mark only; the name stays the line's ink (§AM, 2026-09-26:
   *  the category is a mark, never the words). */
  goal?: { title: string; hue: string } | null;
  /** "3 of 4 Done", or empty for a project with no tasks: a row with
   *  nothing to say shows nothing (§AK). */
  meter: string;
  /** A hold's line replaces the count, in the warning ink. */
  hold?: string | null;
  status: { text: string; tone: "good" | "warn" } | null;
  bar: Progress | null;
  onOpen?: () => void;
  /** Present only when every task is done and the project is still open. */
  onClose?: () => void;
  /** MOVE TO GOAL (Dave 2026-09-13, "do the suggestions as well"): hold the
   *  row to refile the project without opening its sheet. The tap that ends
   *  the hold never also opens the project. */
  onHold?: () => void;
}) {
  const press = useLongPress({ onLongPress: () => onHold?.(), enabled: !!onHold });
  return (
    <div {...(onHold ? press : {})} className="task-row p2 goal-row-ruled proj-row-ruled" role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen}>
      <div className="task-check-tap"><span className={"gm-slot " + glyphTone}><FolderOpenGlyph /></span></div>
      <div className="task-title">
        <div className="proj-line1">
          <span className="task-name">{title}</span>
          {onClose && (
            <button className="pill-act proj-close" onClick={(e) => { e.stopPropagation(); onClose(); }}>Close</button>
          )}
        </div>
        {(next || goal) && (
          <div className="r-k goal-sub">
            {next
              ? <span className="r-next-in"><span className="r-next-k">Next</span><span className="r-next-v">{next}</span></span>
              : goal && <span className={"r-goal r-is-goal " + goal.hue}><GoalMark /><span className="r-goal-t">{goal.title}</span></span>}
          </div>
        )}
        {/* No count, no hold and no status: no line at all, not an empty
            one holding its margin under the title. */}
        {(hold || meter || status) && (
          <div className="goal-meter">
            <span className={"r-goal" + (hold ? " r-stalled" : "")}><Nums text={hold ?? meter} /></span>
            {status && <span className={"gstat gstat-" + status.tone}>{status.text}</span>}
          </div>
        )}
        {bar && <Bar p={bar} />}
      </div>
      {onOpen && <div className="chev" />}
    </div>
  );
}
