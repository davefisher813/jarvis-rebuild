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
import { pickNext, quickWins, rankOpen, reasonFor, QUICK_WINS_COUNT } from "./upnext";
import MusicChip from "../music/MusicChip";
import FocusScreen from "./FocusScreen";

// FOCUS, THE CONTAINER (remodelled 2026-09-17, rebuilt 2026-09-18). One card
// at a time, never a list: Next deals the single best task, Quick Wins deals
// a short timed run. This half holds the services, the deck and the clock;
// FocusScreen holds the look, which is also what the bench renders.
//
// It is now the ONE answer to "what do I do next": the Pick One slab on the
// Tasks list and the Do This sheet it opened are gone, and both doors that
// used to lead there lead here (see FocusScreen's own note).

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

  // How many more are behind this card, so the screen can say so.
  const deck = mode === "next"
    ? rankOpen(tasks, today).filter((t) => !skipped.includes(t.id))
    : winsDeck.slice(winsAt);

  const face = current ? {
    areaName: catName(current.data.category) || "Anything",
    areaSlot: catColor(current.data.category),
    reason: reasonFor(current, today, inPeak),
    text: current.data.text,
  } : null;

  const finale = winsOver ? {
    title: winsDone > 0 ? `${winsDone} Down.` : "The deck's still here.",
    sub: winsDone >= winsTotal && winsDeck.length > 0
      ? "A clean sweep."
      : winsDone > 0
        ? "That's momentum \u00b7 Ride it or rest"
        : "No pressure \u00b7 It'll be here",
  } : null;

  return (
    <>
      <FocusScreen
        mode={mode}
        onMode={(m) => { if (m === "wins") { if (mode !== "wins") startWins(); } else backToNext(); }}
        onClose={onClose}
        face={loaded ? face : null}
        waiting={Math.max(0, deck.length - 1)}
        {...(mode === "next" && onStartNow && current ? { onStartNow: () => onStartNow(current.id) } : {})}
        {...(onFifteen && !fifteen && current ? { onFifteen: () => onFifteen(current) } : {})}
        onDone={complete}
        doneBusy={completing.current}
        onSkip={skip}
        running={fifteen ? { text: fifteen.text, line: fifteen.line, over: fifteen.over } : null}
        {...(onFifteenDone ? { onRunDone: onFifteenDone } : {})}
        {...(onFifteenAgain ? { onRunAgain: onFifteenAgain } : {})}
        {...(onFifteenStop ? { onRunStop: onFifteenStop } : {})}
        winsLine={mode === "wins" && !winsOver ? `${winsDone} of ${winsTotal} \u00b7 ${fmtClock(secondsLeft)} left` : null}
        finale={finale}
        onBackToNext={backToNext}
        music={<MusicChip context="focus" />}
        guard={<HyperfocusLine guard={guard} />}
      />
      <Burst show={bursting} />
    </>
  );
}
