import { useCallback, useEffect, useRef, useState } from "react";
import { useTasks, useRoutine } from "../data/NotesProvider";
import { HyperfocusLine, useHyperfocusGuard } from "../today/useHyperfocusGuard";
import type { TaskItem } from "../tasks/TasksService";
import { todayISO } from "../tasks/grouping";
import { catColor, catName } from "../shared/categories";
import { Burst, useBurst } from "../shared/Burst";
import { showToast } from "../shared/toast";
import { attemptWrite } from "../shared/guard";
import { chronotypeFor, peakWindowFor } from "../schedule/energy";
import { DEFAULT_ROUTINE } from "../routine/types";
import { pickNext, quickWins, reasonFor, QUICK_WINS_COUNT } from "./upnext";
import MusicChip from "../music/MusicChip";
import { Timer } from "../shared/icons";

// FOCUS (remodelled 2026-09-17, Dave: "the focus screen is a disaster"). One
// card at a time, never a list: Next deals the single best task, Quick Wins
// deals a short timed run. The card is the app's own card with the area and
// the reason as a facts line, the task in the display size, the next hard
// commitment as a fact, then the verbs: Start Now (the first-step screen)
// as the one filled action, Focus 15 Minutes (the countdown, which used to
// hide behind Today's Start pill) and Done as quiet capsules, Not This One
// as a text button. A running block shows at the top with what is left and
// its own three answers, so the countdown lives here. The views are chips,
// never a second tab bar.

const WINS_SECONDS = 10 * 60;

function fmtClock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface FifteenFace { taskId: string; text: string; line: string; over: boolean }

export default function UpNextFlow({ onClose, onStartNow, onFifteen, fifteen, onFifteenDone, onFifteenAgain, onFifteenStop }: {
  onClose: () => void;
  /** The Start screen for a task (Start Now). */
  onStartNow?: (id: string) => void;
  /** The fifteen-minute block on a task. */
  onFifteen?: (t: TaskItem) => void;
  /** The block running right now, if one is. */
  fifteen?: FifteenFace | null;
  onFifteenDone?: () => void;
  onFifteenAgain?: () => void;
  onFifteenStop?: () => void;
}) {
  const svc = useTasks();
  const routine = useRoutine();
  const guard = useHyperfocusGuard();
  const today = todayISO();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"next" | "wins">("next");
  const [skipped, setSkipped] = useState<string[]>([]);
  const [inPeak, setInPeak] = useState(false);
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
  const backToNext = () => { setMode("next"); };

  const current: TaskItem | null =
    mode === "next" ? pickNext(tasks, today, skipped) : winsDeck[winsAt] ?? null;

  // Optimistic completion: the burst plays, the write lands 600ms later, the
  // next card slides in. attemptWrite guards the write and the latch always
  // releases (B6-2). Undo restores the pre-tick snapshot, never a second
  // toggle, which re-rolls a recurring task.
  const complete = () => {
    const t = current;
    if (!t || completing.current) return;
    completing.current = true;
    fireBurst();
    setTimeout(async () => {
      try {
        const before = await svc.task(t.id);
        const ok = await attemptWrite(() => svc.toggleDone(t.id));
        if (!ok) return;
        await reload();
        if (mode === "wins") {
          setWinsDone((d) => d + 1);
          setWinsAt((i) => i + 1);
        }
        if (before) showToast({
          message: "Task completed",
          actionLabel: "Undo",
          onAction: async () => { await attemptWrite(() => svc.restoreCompletion(t.id, before)); await reload(); },
        });
      } finally {
        completing.current = false;
      }
    }, 600);
  };

  const skip = () => {
    if (!current) return;
    setSkipped((s) => [...s, current.id]);
  };

  const winsOver = mode === "wins" && (secondsLeft === 0 || winsAt >= winsDeck.length);
  const winsTotal = Math.min(QUICK_WINS_COUNT, winsDeck.length);
  const leadsWithStart = mode === "next" && !!onStartNow;

  const card = (t: TaskItem) => (
    <div className="card pad upnext-card">
      <div className="facts upnext-facts">
        <span className="fact cat"><span className={"cd cat-bg-" + catColor(t.data.category)} />{catName(t.data.category) || "Anything"}</span>
        <span className="fact">{reasonFor(t, today, inPeak)}</span>
      </div>
      <div className="upnext-task">{t.data.text}</div>
      <HyperfocusLine guard={guard} />
      <div className="upnext-done-wrap">
        {/* ONE FILLED ACTION, by branch: Next leads with the first step;
            Quick Wins is a run of Done taps and leads with Done. */}
        {leadsWithStart
          ? <button className="btn btn-primary btn-block" onClick={() => onStartNow!(t.id)}>Start Now</button>
          : <button className="btn btn-primary btn-block" onClick={complete} disabled={completing.current}>Done</button>}
        <Burst show={bursting} />
      </div>
      {mode === "next" && (
        <div className="upnext-grid">
          {onFifteen && !fifteen && <button className="btn btn-secondary" onClick={() => onFifteen(t)}><Timer className="ic" />Focus 15 Minutes</button>}
          {leadsWithStart && <button className="btn btn-secondary" onClick={complete} disabled={completing.current}>Done</button>}
        </div>
      )}
      {mode === "next" && (
        <button className="upnext-skip" onClick={skip}>Not This One</button>
      )}
    </div>
  );

  return (
    <div className="search-overlay ruled">
      <div className="nav-bar">
        <div className="nav-large">Focus</div>
        <button className="nav-action-text" onClick={onClose}>Close</button>
      </div>
      <div className="pad-x">
        <div className="chip-row chip-wrap-row" role="group" aria-label="Focus views">
          <div className={"chip" + (mode === "next" ? " active" : "")} role="button" tabIndex={0} aria-pressed={mode === "next"} onClick={backToNext}>Next</div>
          <div className={"chip" + (mode === "wins" ? " active" : "")} role="button" tabIndex={0} aria-pressed={mode === "wins"} onClick={() => { if (mode !== "wins") startWins(); }}>Quick Wins</div>
        </div>
        {mode === "next" && <MusicChip context="focus" />}
      </div>
      {mode === "wins" && !winsOver && (
        <div className="upnext-pill-row">
          <span className="qw-pill">{winsDone} of {winsTotal} · {fmtClock(secondsLeft)} left</span>
        </div>
      )}
      {/* THE RUNNING BLOCK: what is on the clock and what is left, with its
          three answers, so the countdown lives in Focus. */}
      {fifteen && (
        <div className="pad-x">
          <div className="card upnext-live">
            <div className="row">
              <div className="row-ico cat-bg-brand"><Timer className="ic" /></div>
              <div className="row-stack">
                <div className="conn-name truncate">{fifteen.text}</div>
                <div className={"conn-meta" + (fifteen.over ? " warn" : "")}>{fifteen.line}</div>
              </div>
            </div>
            <div className="upnext-grid three">
              {onFifteenDone && <button className="btn btn-secondary" onClick={onFifteenDone}>Done</button>}
              {onFifteenAgain && <button className="btn btn-secondary" onClick={onFifteenAgain}>Another 15</button>}
              {onFifteenStop && <button className="btn btn-secondary" onClick={onFifteenStop}>Stop</button>}
            </div>
          </div>
        </div>
      )}
      <div className="upnext-body pad-x">
        {!loaded ? null : winsOver ? (
          <div className="card pad upnext-card">
            <div className="upnext-task">{winsDone > 0 ? `${winsDone} Down.` : "The deck's still here."}</div>
            <div className="conn-meta">
              {winsDone >= winsTotal && winsDeck.length > 0
                ? "A clean sweep."
                : winsDone > 0
                  ? "That's momentum · Ride it or rest"
                  : "No pressure · It'll be here"}
            </div>
            <div className="upnext-grid">
              <button className="btn btn-secondary" onClick={backToNext}>Back to Next</button>
              <button className="btn btn-secondary" onClick={onClose}>Back to Today</button>
            </div>
          </div>
        ) : current ? (
          card(current)
        ) : (
          <div className="card pad upnext-card">
            <div className="upnext-task">Nothing waiting.</div>
            <div className="conn-meta">Enjoy it</div>
            <div className="upnext-grid">
              <button className="btn btn-secondary" onClick={onClose}>Back to Today</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
