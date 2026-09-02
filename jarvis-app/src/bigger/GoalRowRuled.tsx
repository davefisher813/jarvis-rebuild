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

export default function GoalRowRuled({ title, tone, body, status, bar, onOpen }: {
  title: string;
  /** A cat-fg-* class: the goal's home colour. */
  tone: string;
  body: string;
  status: { text: string; tone: "good" | "warn" } | null;
  bar: Progress | null;
  onOpen?: () => void;
}) {
  return (
    <div className="task-row p2 goal-row-ruled" role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen}>
      <div className="task-check-tap"><span className={"gm-slot " + tone}><TargetGlyph /></span></div>
      <div className="task-title">
        <span className="task-name">{title}</span>
        <div className="r-k">
          <span className="r-goal"><Nums text={body} /></span>
          {status && <span className={"gstat gstat-" + status.tone}>{status.text}</span>}
        </div>
        {bar && <Bar p={bar} />}
      </div>
      {onOpen && CHEV}
    </div>
  );
}
