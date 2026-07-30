import { useCallback, useEffect, useRef, useState } from "react";
import { useTasks, useRoutine } from "../data/NotesProvider";
import type { TaskItem } from "../tasks/TasksService";
import { todayISO } from "../tasks/grouping";
import { catColor, catName } from "../shared/categories";
import { Burst, useBurst } from "../shared/Burst";
import { chronotypeFor, peakWindowFor } from "../schedule/energy";
import { DEFAULT_ROUTINE } from "../routine/types";
import { pickNext, quickWins, reasonFor, QUICK_WINS_COUNT } from "./upnext";

// Up Next (ADHD strategy Phase 1): one card at a time, never a list. Next mode
// deals the single best task; Quick Wins deals a short rapid-fire run. Two
// skips in Next mode offer Quick Wins instead of an infinite shuffle
// (design law: escape hatches lead somewhere).

const WINS_SECONDS = 10 * 60;

function fmtClock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function UpNextFlow({ onClose }: { onClose: () => void }) {
  const svc = useTasks();
  const routine = useRoutine();
  const today = todayISO();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"next" | "wins">("next");
  const [skipped, setSkipped] = useState<string[]>([]);
  const [inPeak, setInPeak] = useState(false);

  // Quick Wins run state: the deck is dealt once when the mode starts, so
  // completing a card never reshuffles the run under the user.
  const [winsDeck, setWinsDeck] = useState<TaskItem[]>([]);
  const [winsAt, setWinsAt] = useState(0);
  const [winsDone, setWinsDone] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(WINS_SECONDS);

  const [bursting, fireBurst] = useBurst();
  const completing = useRef(false);

  const reload = useCallback(async () => {
    const items = await svc.listTasks();
    setTasks(items);
    setLoaded(true);
  }, [svc]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    let on = true;
    routine.get().then((r) => {
      if (!on) return;
      const data = r ?? DEFAULT_ROUTINE;
      const peak = peakWindowFor(data, chronotypeFor(data));
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      setInPeak(nowMin >= peak.s && nowMin <= peak.e);
    });
    return () => { on = false; };
  }, [routine]);

  // The countdown only runs while Quick Wins is live.
  useEffect(() => {
    if (mode !== "wins" || secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [mode, secondsLeft]);

  const startWins = () => {
    setWinsDeck(quickWins(tasks, today));
    setWinsAt(0);
    setWinsDone(0);
    setSecondsLeft(WINS_SECONDS);
    setMode("wins");
  };

  const current: TaskItem | null =
    mode === "next" ? pickNext(tasks, today, skipped) : winsDeck[winsAt] ?? null;

  // Optimistic completion, same rhythm as everywhere else: burst plays, the
  // real toggle lands 600ms later, then the next card slides in.
  const complete = () => {
    const t = current;
    if (!t || completing.current) return;
    completing.current = true;
    fireBurst();
    setTimeout(async () => {
      await svc.toggleDone(t.id);
      await reload();
      if (mode === "wins") {
        setWinsDone((d) => d + 1);
        setWinsAt((i) => i + 1);
      }
      completing.current = false;
    }, 600);
  };

  const skip = () => {
    if (!current) return;
    setSkipped((s) => [...s, current.id]);
  };

  const winsOver = mode === "wins" && (secondsLeft === 0 || winsAt >= winsDeck.length);
  const offerWins = mode === "next" && skipped.length >= 2 && !!current;

  const card = (t: TaskItem) => (
    <div className="card pad upnext-card">
      <div className="eyebrow upnext-cat">
        <span className={"cat-dot cat-bg-" + catColor(t.data.category)} /> {catName(t.data.category) || "Anything"}
      </div>
      <div className="upnext-task">{t.data.text}</div>
      <div className="conn-meta">{reasonFor(t, today, inPeak)}</div>
      <div className="upnext-done-wrap">
        <button className="btn btn-primary btn-block" onClick={complete} disabled={completing.current}>Done</button>
        <Burst show={bursting} />
      </div>
      {mode === "next" && (
        <button className="upnext-skip" onClick={skip}>Not this one</button>
      )}
    </div>
  );

  return (
    <div className="search-overlay">
      <div className="nav-bar">
        <div className="nav-large">{mode === "next" ? "Up Next" : "Quick Wins"}</div>
        <button className="nav-action-text" onClick={onClose}>Close</button>
      </div>
      {mode === "next" && (
        <div className="pad-x">
          <div className="chip-wrap">
            <div className="chip active" role="button" tabIndex={0}>Next</div>
            <div className="chip" role="button" tabIndex={0} onClick={startWins}>Quick Wins</div>
          </div>
        </div>
      )}
      {mode === "wins" && !winsOver && (
        <div className="upnext-pill-row">
          <span className="qw-pill">{winsDone} of {Math.min(QUICK_WINS_COUNT, winsDeck.length)} · {fmtClock(secondsLeft)} left</span>
        </div>
      )}
      <div className="upnext-body pad-x">
        {!loaded ? null : winsOver ? (
          <div className="card pad upnext-card">
            <div className="upnext-task">{winsDone > 0 ? `${winsDone} down.` : "The deck's still here."}</div>
            <div className="conn-meta">
              {winsDone >= Math.min(QUICK_WINS_COUNT, winsDeck.length) && winsDeck.length > 0
                ? "A clean sweep."
                : winsDone > 0
                  ? "That's momentum. Ride it or rest, both count."
                  : "No pressure. It'll be here when you're ready."}
            </div>
            <div className="upnext-done-wrap">
              <button className="btn btn-primary btn-block" onClick={onClose}>Back to Today</button>
            </div>
          </div>
        ) : current ? (
          <>
            {card(current)}
            {offerWins && (
              <button className="btn btn-secondary btn-block" onClick={startWins}>
                Deal Five Quick Ones Instead
              </button>
            )}
          </>
        ) : (
          <div className="card pad upnext-card">
            <div className="upnext-task">Nothing waiting.</div>
            <div className="conn-meta">Enjoy it. That's the whole point.</div>
            <div className="upnext-done-wrap">
              <button className="btn btn-primary btn-block" onClick={onClose}>Back to Today</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
