import type { Exercise, SetEntry } from "./types";
import { COND_LABEL } from "./types";
import { condScore, condScoreLabel, condSummary, elapsedOf, mmss, perRound } from "./conditioning";

// THE SECOND STATE (Check, Health, Stop, Dave 2026-09-02: "The receipt:
// every round with its delta"). The clock stops, the block collapses back
// onto the session screen as a receipt: the format, the movements, the cap;
// then round by round, how long it took and how it compared with the round
// before, amber slower and green faster; then the one score line. On an
// AMRAP the reps past the last full round are the one thing typed by hand,
// because nobody auto-detects a rep.

function Delta({ d }: { d: number | null }) {
  if (d == null || d === 0) return <td className="cr-d" />;
  return <td className={"cr-d " + (d > 0 ? "up" : "dn")}>{d > 0 ? "+" : "−"}{Math.abs(d)}</td>;
}

export default function CondReceipt({ exercise, entries, onChange, lastLine }: {
  exercise: Exercise;
  entries: SetEntry[];
  onChange: (entries: SetEntry[]) => void;
  /** "Last: 6 + 4 · Aug 21", when there is a last time. */
  lastLine?: string | null;
}) {
  const cond = exercise.cond!;
  const setExtra = (id: string, raw: string) => {
    const n = raw.trim() === "" ? undefined : Math.max(0, Math.floor(Number(raw)));
    onChange(entries.map((e) => (e.id === id ? { ...e, ...(n == null || Number.isNaN(n) ? { extra: undefined } : { extra: n }) } : e)));
  };
  return (
    <div className="card cond-receipt">
      <div className="cr-head">
        <span className="cr-fmt">{COND_LABEL[cond.format]}</span>
        <span className="cr-name">{exercise.note ?? exercise.name}</span>
        <span className="cr-cap">{condSummary(cond).replace(COND_LABEL[cond.format] + " · ", "")}</span>
      </div>
      {entries.length === 0 && (
        <div className="cr-empty">{lastLine ?? "Not run yet"}</div>
      )}
      {entries.map((e, i) => {
        const rounds = perRound(e.splits ?? []);
        const ran = elapsedOf(exercise, e);
        return (
          <div className="cr-attempt" key={e.id}>
            {entries.length > 1 && <div className="cr-attempt-t">Attempt {i + 1}</div>}
            {rounds.length > 0 && (
              <table className="cr-table">
                <tbody>
                  {rounds.map((r) => (
                    <tr key={r.round}>
                      <td className="cr-n">{r.round}</td>
                      <td className="cr-t">{mmss(r.sec)}</td>
                      <Delta d={r.delta} />
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="cr-score">
              <span className="cr-score-l">
                {condScoreLabel(exercise)}{ran != null && exercise.kind !== "time_faster" && exercise.kind !== "time_longer" ? ` · ${mmss(ran)}` : ""}
              </span>
              {exercise.kind === "rounds" ? (
                <span className="cr-score-v">
                  <b>{e.r ?? 0}</b>
                  <span className="cr-plus">+</span>
                  <input
                    className="cr-extra"
                    inputMode="numeric"
                    aria-label="Reps past the last round"
                    placeholder="0"
                    value={e.extra ?? ""}
                    onChange={(ev) => setExtra(e.id, ev.target.value)}
                  />
                </span>
              ) : (
                <span className="cr-score-v"><b>{condScore(exercise, e)}</b></span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
