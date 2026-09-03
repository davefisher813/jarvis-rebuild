import { createPortal } from "react-dom";
import type { Receipt } from "./prs";
import type { Workout } from "./types";
import { doneCount } from "./history";

// The finish moment. Volume is the star when it exists: a real number that
// feels enormous, and a beginner racks it up on day one, so the reward works
// before strength does. When no weight moved, the tile simply is not there.
//
// THE `done` BLIND SPOT FIX (catalog §4.8): a session built entirely of
// mobility, cuff work, or conditioning used to land here with nothing but an
// exercise count -- the same receipt whether the work was real or skipped.
// `otherSets` gives non-weight_reps logging its own tile, and `doneNames`
// names the done-kind work instead of folding it into a number. Each name
// also gets a plain count fact ("done N times") pulled from history plus this
// session -- a count, never a streak, never red, never a target.
export default function ReceiptSheet({ dayName, receipt, workouts, onDone }: {
  dayName: string;
  receipt: Receipt;
  workouts: Workout[];
  onDone: () => void;
}) {
  const tiles: { num: string; label: string }[] = [
    { num: String(receipt.minutes), label: receipt.minutes === 1 ? "Minute" : "Minutes" },
    { num: String(receipt.exercises), label: receipt.exercises === 1 ? "Exercise" : "Exercises" },
  ];
  if (receipt.volumeUnit) tiles.push({ num: receipt.volume.toLocaleString(), label: `${receipt.volumeUnit} moved` });
  if (receipt.otherSets > 0) tiles.push({ num: String(receipt.otherSets), label: receipt.otherSets === 1 ? "Set" : "Sets" });
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
          {receipt.doneNames.length > 0 && (
            <>
              <div className="grp"><div className="eyebrow">Also Did</div></div>
              <div className="card">
                {receipt.doneNames.map((name) => {
                  // The just-finished workout is already in `workouts` by the
                  // time this sheet renders (GymFlow reloads before opening
                  // it), so this count is the true total, not one behind.
                  const n = doneCount(workouts, name);
                  return (
                    <div className="row" key={name}>
                      <div className="row-grow">
                        <div className="conn-name truncate">{name}</div>
                        {/* Row meta is quiet sentence case (gym reformat
                            2026-08-31); eyebrows are kickers. */}
                        <div className="conn-meta">{n > 1 ? `Done ${n} times` : "Done"}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {receipt.goalHits.length > 0 && (
            <>
              {/* D12: the celebration. Styled exactly like New Best below --
                  the app's one established "dopamine" pattern (stat tiles,
                  pills) -- rather than a separate full-screen confetti
                  moment the preview mocked but the real app has no
                  precedent for. */}
              <div className="grp"><div className="eyebrow">Goal Hit</div></div>
              <div className="card banner-good">
                {receipt.goalHits.map((g) => (
                  <div className="row" key={g.title}>
                    <div className="row-grow">
                      <div className="conn-name truncate">{g.title}</div>
                      <div className="conn-meta">{g.line}</div>
                    </div>
                    <span className="pill pill-good">Goal</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {receipt.prs.length > 0 && (
            <>
              <div className="grp"><div className="eyebrow">New Best</div></div>
              <div className="card">
                {receipt.prs.map((p) => (
                  <div className="row" key={p.name}>
                    <div className="row-grow">
                      <div className="conn-name truncate">{p.name}</div>
                      <div className="conn-meta">{p.text}{p.from ? ` · Up from ${p.from}` : " · First time"}</div>
                    </div>
                    <span className="pill pill-good">PR</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-launch btn-block" onClick={onDone}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
