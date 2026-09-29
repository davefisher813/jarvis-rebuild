import { readinessWord, toneForReadinessWord } from "./state";
import { watchingCount, type Readiness } from "../readiness";
import { Nums } from "../../bigger/GoalRowRuled";
import { lineCase } from "../../shared/casing";

// A READINESS ROW OPENS ITS OWN DETAIL (audit 2026-09-29). Tapping a row on
// What JARVIS Knows -> Readiness used to open the Add One Thing form: a row
// that says "Waiting" answered with a blank text box. The row is a detector
// JARVIS is still counting for, so what it opens is that count: the word, the
// evidence against the gate, what is still missing, and the way to add the
// fact yourself (Tell JARVIS, which is the form, one tap on purpose).
//
// It reads only the Readiness row it was handed, the same object the panel
// draws from, so the sheet and the row cannot disagree.
function missingLine(r: Readiness): string {
  if (r.state === "known") return "JARVIS already knows this";
  if (r.state === "muted") return "Switched off";
  if (r.state === "ready") return "Enough evidence, waiting for you to accept it";
  const short = Math.max(0, r.need - r.have);
  return lineCase(`${short} more ${r.unit} to go`);
}

export default function ReadinessSheet({ r, onTell, onClose }: { r: Readiness; onTell: () => void; onClose: () => void }) {
  const word = readinessWord(r.state);
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" role="dialog" aria-label={r.label} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow"><span><span className={"fact st " + toneForReadinessWord(word)}>{word}</span></span></div></div>
        <div className="pad-x sheet-form">
          <div className="strand-head">{r.label}</div>
          <div className="conn-meta">{watchingCount(r)}</div>
          {r.detail && <div className="conn-meta"><Nums text={r.detail} /></div>}
          <div className="conn-meta">{missingLine(r)}</div>
        </div>
        <div className="pad-x sheet-actions">
          <button type="button" className="btn btn-primary btn-block" onClick={onTell}>Tell JARVIS</button>
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
