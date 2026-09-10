import type { Progress } from "./progress";
import { TargetGlyph } from "../shared/glyphs";

// THE GOAL ROW (Goals and Projects, Dave 2026-09-02: "One card, status
// capsule on the right"). One anatomy wherever a goal is listed, on the
// Goals lens and on a category's page: the target in the goal's category
// colour where a task's check sits, the title, the measure line with the
// numbers bold, the status capsule right-aligned, and the thin bar.

const CHEV = <div className="chev" />;

/** Numbers in a measure line read bold, words stay quiet: "1 of 4 Done". */
export function Nums({ text }: { text: string }) {
  // A duration keeps its unit in the bold ("2h 15m"), so the split runs on
  // the whole fused token, not the digits alone.
  const parts = text.split(/(\d[\d,.:]*(?:[hm](?=\s|$|·))?)/);
  return <>{parts.map((s, i) => (i % 2 === 1 ? <b key={i}>{s}</b> : s))}</>;
}

export function Bar({ p }: { p: Progress }) {
  return <div className="bp-bar"><div className="bp-bar-fill" style={{ width: Math.max(2, p.pct) + "%" }} /></div>;
}

export default function GoalRowRuled({ title, tone, body, status, bar, kind, onOpen }: {
  title: string;
  /** A cat-fg-* class: the goal's home colour. */
  tone: string;
  body: string;
  status: { text: string; tone: "good" | "warn" } | null;
  bar: Progress | null;
  /** WHAT KIND OF GOAL THIS IS (Dave 2026-09-10: "health specific goals are
   *  like workout goals... That should be a little bit different to me. It
   *  shouldn't just be like everything else"). A short chip -- LIFT, SESSIONS
   *  -- so a goal measured off the workout log reads as one at a glance
   *  instead of looking like every other goal in the app. Absent on a goal
   *  with no measure of its own, and the chip is absent with it. */
  kind?: { text: string; hue: string } | null;
  onOpen?: () => void;
}) {
  return (
    <div className="task-row p2 goal-row-ruled" role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen}>
      <div className="task-check-tap"><span className={"gm-slot " + tone}><TargetGlyph /></span></div>
      <div className="task-title">
        <span className="task-name">{title}</span>
        <div className="r-k">
          {kind && <span className={"gkind " + kind.hue}>{kind.text}</span>}
          <span className="r-goal"><Nums text={body} /></span>
          {status && <span className={"gstat gstat-" + status.tone}>{status.text}</span>}
        </div>
        {bar && <Bar p={bar} />}
      </div>
      {onOpen && CHEV}
    </div>
  );
}
