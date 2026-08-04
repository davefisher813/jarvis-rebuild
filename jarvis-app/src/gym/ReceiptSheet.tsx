import { createPortal } from "react-dom";
import type { Receipt } from "./prs";

// The finish moment. Volume is the star when it exists: a real number that
// feels enormous, and a beginner racks it up on day one, so the reward works
// before strength does. When no weight moved, the tile simply is not there.
export default function ReceiptSheet({ dayName, receipt, onDone }: {
  dayName: string;
  receipt: Receipt;
  onDone: () => void;
}) {
  const tiles: { num: string; label: string }[] = [
    { num: String(receipt.minutes), label: "Minutes" },
    { num: String(receipt.exercises), label: receipt.exercises === 1 ? "Exercise" : "Exercises" },
  ];
  if (receipt.volumeUnit) tiles.push({ num: receipt.volume.toLocaleString(), label: `${receipt.volumeUnit} moved` });
  if (receipt.prs.length) tiles.push({ num: String(receipt.prs.length), label: receipt.prs.length === 1 ? "PR" : "PRs" });

  return createPortal(
    <div className="sheet-scrim" onClick={onDone}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Session Done</div></div>
        <div className="pad-x sheet-form">
          <div className="p3-q">{dayName}</div>
          <div className="stat-row">
            {tiles.slice(0, 2).map((t) => (
              <div className="stat-tile" key={t.label}><div className="stat-num">{t.num}</div><div className="stat-label">{t.label}</div></div>
            ))}
          </div>
          {tiles.length > 2 && (
            <div className="stat-row stat-row-gap">
              {tiles.slice(2).map((t) => (
                <div className="stat-tile" key={t.label}><div className="stat-num">{t.num}</div><div className="stat-label">{t.label}</div></div>
              ))}
            </div>
          )}
          {receipt.prs.length > 0 && (
            <>
              <div className="grp"><div className="eyebrow">New Best</div></div>
              <div className="card">
                {receipt.prs.map((p) => (
                  <div className="row" key={p.name}>
                    <div className="row-grow">
                      <div className="conn-name truncate">{p.name}</div>
                      <div className="eyebrow">{p.text}{p.from ? ` · up from ${p.from}` : " · first time"}</div>
                    </div>
                    <span className="pill pill-good">PR</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={onDone}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
