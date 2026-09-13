import type { Progress } from "./progress";
import { TargetGlyph } from "../shared/glyphs";
import { capAfterNumber } from "../shared/casing";

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

export default function GoalRowRuled({ title, tone, body, status, bar, kind, moving = 0, next = null, checkin = null, onOpen }: {
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
  // C-35 (Astra, 2026-09-12): projects under this goal whose bucket is
  // moving, as a sky fact. Zero says nothing.
  moving?: number;
  // C-36: the next milestone, as a sky fact.
  next?: string | null;
  // C-37: the last self-reported check-in, only where there is no status
  // capsule to disagree with it.
  checkin?: string | null;
  onOpen?: () => void;
}) {
  return (
    <div className="task-row p2 goal-row-ruled" role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen}>
      <div className="task-check-tap"><span className={"gm-slot " + tone}><TargetGlyph /></span></div>
      <div className="task-title">
        <span className="task-name">{title}</span>
        {/* WHAT MOVES IT, THEN HOW FAR (Dave 2026-09-13: "where it lists how
            many projects are moving it... that's where we should put how many
            tasks are done... right above the bar... you could just say three
            projects"). Line two is what feeds the goal: the kind, how many
            projects, the next milestone, a check-in. The line over the bar is
            the count the bar draws, with the status at its right edge, so the
            number and the bar read as one thing. */}
        {(kind || moving > 0 || next || (!status && checkin)) && (
          <div className="r-k goal-sub">
            {kind && <span className={"gkind " + kind.hue}>{kind.text}</span>}
            {moving > 0 && <span className="r-goal goal-proj">{capAfterNumber(`${moving} ${moving === 1 ? "project" : "projects"}`)}</span>}
            {next && <span className="r-next-in"><span className="r-next-k">Next</span><span className="r-next-v">{next}</span></span>}
            {!status && checkin && <span className="r-goal fact good">Check-in: {checkin}</span>}
          </div>
        )}
        {(body || status) && (
          <div className="goal-meter">
            <span className="r-goal"><Nums text={body} /></span>
            {status && <span className={"gstat gstat-" + status.tone}>{status.text}</span>}
          </div>
        )}
        {bar && <Bar p={bar} />}
      </div>
      {onOpen && CHEV}
    </div>
  );
}
