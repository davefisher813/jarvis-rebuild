import { useState } from "react";
import { createRoot } from "react-dom/client";
import ConditioningFace from "../gym/ConditioningFace";
import CondReceipt from "../gym/CondReceipt";
import type { CondBlock, Exercise, SetEntry } from "../gym/types";
import "../styles/jarvis-design-system.css";
import "../styles/uniformity.css";
import "../styles/components.css";
import "../styles/ruled.css";

// Conditioning bench (dev only): the face and the receipt, standalone, so
// both states can be looked at and screenshotted without building a program
// first. ?face=amrap|emom|tabata|for_time opens that face on load.

const BLOCKS: Record<string, CondBlock> = {
  amrap: { format: "amrap", capSec: 720 },
  emom: { format: "emom", capSec: 600, intervalSec: 60, rounds: 10 },
  tabata: { format: "tabata", capSec: 240, intervalSec: 20, restSec: 10, rounds: 8 },
  for_time: { format: "for_time", capSec: 1200 },
};
const EX: Exercise = { id: "e1", name: "Cindy", kind: "rounds", sets: [], note: "5 pull-ups, 10 push-ups, 15 squats", cond: BLOCKS.amrap! };
const DONE: SetEntry[] = [{ id: "s1", r: 7, extra: 12, elapsed: 720, splits: [98, 202, 313, 435, 546, 663, 720] }];

function Bench() {
  const q = new URLSearchParams(location.search);
  const [face, setFace] = useState<string | null>(q.get("face"));
  const [entries, setEntries] = useState<SetEntry[]>(q.get("empty") ? [] : DONE);
  return (
    <div className="app-shell"><div className="app-scroll"><div className="screen ruled">
      <div className="sh2 sh2-quiet list-head"><span className="t">Conditioning</span></div>
      <div className="pad-x">
        <CondReceipt exercise={EX} entries={entries} onChange={setEntries} lastLine="Last: 6 + 4 · Aug 21" />
      </div>
      <div className="pad-x gym-log" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        {Object.keys(BLOCKS).map((k) => <button key={k} className="pill-act" onClick={() => setFace(k)}>{k}</button>)}
      </div>
      {face && BLOCKS[face] && (
        <ConditioningFace name="Cindy" cond={BLOCKS[face]!} onFinish={(r) => { setEntries((e) => [...e, { id: "s" + (e.length + 1), r: r.splits.length, elapsed: r.elapsed, splits: r.splits }]); setFace(null); }} onCancel={() => setFace(null)} />
      )}
    </div></div></div>
  );
}
document.documentElement.dataset.theme = "dark";
createRoot(document.getElementById("root")!).render(<Bench />);
