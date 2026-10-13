import { titleCase } from "../shared/casing";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTasks, useRoutine } from "../data/NotesProvider";
import { bus } from "../events";
import { ENTITY_TASK } from "../notes/types";
import { HyperfocusLine, useHyperfocusGuard } from "../today/useHyperfocusGuard";
import type { TaskItem } from "../tasks/TasksService";
import { todayISO } from "../tasks/grouping";
import { catColor, catName } from "../shared/categories";
import { Burst, useBurst } from "../shared/Burst";
import { showToast } from "../shared/toast";
import { attemptWrite } from "../shared/guard";
import { chronotypeFor, peakWindowFor } from "../schedule/energy";
import { DEFAULT_ROUTINE } from "../routine/types";
import { daysBetween, pickNext, quickWins, rankOpen, reasonFor, QUICK_WINS_COUNT } from "./upnext";
import { clockLabel } from "../shared/duration";
import { countdown } from "../today/liveFifteen";
import { FIFTEEN } from "../tasks/rightNow";
import MusicChip from "../music/MusicChip";
import FocusScreen, { type FocusClock, type FocusReason } from "./FocusScreen";

// FOCUS, THE CONTAINER (remodelled 2026-09-17, rebuilt 2026-09-18). One card
// at a time, never a list: Next deals the single best task, Quick Wins deals
// a short timed run. This half holds the services, the deck and the clock;
// FocusScreen holds the look, which is also what the bench renders.
//
// It is now the ONE answer to "what do I do next": the Pick One slab on the
// Tasks list and the Do This sheet it opened are gone, and both doors that
// used to lead there lead here (see FocusScreen's own note).

const WINS_SECONDS = 10 * 60;

// The app's one running clock (shared/duration.ts): m:ss, h:mm:ss past an hour.
const fmtClock = clockLabel;

// THE REASON AS FACTS (§AM, 2026-09-26). reasonFor's line was one string with
// a typed dot, drawn as ONE grey fact, so a late task and a calm one looked
// the same. The due distance keeps reasonFor's own words and takes the key's
// colour for its window: late red, today or tomorrow amber, later a neutral
// date. The peak is the line's one grey. A task with no due date says
// nothing about it rather than saying so.
function reasonFacts(t: TaskItem, today: string, inPeak: boolean): FocusReason[] {
  const out: FocusReason[] = [];
  const due = t.data.due;
  if (due) {
    const d = daysBetween(today, due);
    out.push({ text: reasonFor(t, today, false), tone: d < 0 ? "red" : d <= 1 ? "warn" : "date" });
  }
  if (inPeak) out.push({ text: "Your Focus Peak" });
  return out;
}

export interface FifteenFace { taskId: string; text: string; line: string; over: boolean; clock: string }

export default function UpNextFlow({ onClose, onStartNow, onFifteen, fifteen, onFifteenDone, onFifteenAgain, onFifteenStop }: {
  onClose: () => void;
  /** The Start screen for a task (Start Now). */
  onStartNow?: (id: string) => void;
  /** The fifteen-minute block on a task. It may answer with a promise: the capsule holds still until it settles. */
  onFifteen?: (t: TaskItem) => void | Promise<void>;
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
  const [starting, setStarting] = useState(false);
  const [bursting, fireBurst] = useBurst();
  const completing = useRef(false);

  const reload = useCallback(async () => {
    const items = await svc.listTasks();
    setTasks(items);
    setLoaded(true);
  }, [svc]);
  useEffect(() => { void reload(); }, [reload]);
  // THE DECK FOLLOWS THE TASKS WHILE THIS SCREEN STAYS OPEN (issue 108). 15 Min no longer closes it, so Done on the running card,
  // which Today writes and this screen does not, now happens underneath it: without this the card would go on showing the task he
  // just finished, with a fresh Start Now. A write to any task, from anywhere, reloads the deck (the way the Money screens repaint
  // when the ledger moves). Reading only: a reload writes nothing, so it can never raise an event of its own.
  useEffect(() => bus.subscribe((e) => { if (e.entityType === ENTITY_TASK) void reload(); }), [reload]);

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

  // 15 MIN DOES NOT CLOSE THIS SCREEN (issue 108, Dave 2026-10-13): the block begins under it and the countdown below the
  // title starts to run. The tap needs an answer of its own, then. The capsule holds still until the block has begun (or the
  // write has failed and it is tappable again), because a second tap in that gap would book a second block.
  const beginFifteen = (t: TaskItem) => {
    if (!onFifteen || starting) return;
    setStarting(true);
    void Promise.resolve(onFifteen(t)).finally(() => setStarting(false));
  };

  const winsOver = mode === "wins" && (secondsLeft === 0 || winsAt >= winsDeck.length);
  const winsTotal = Math.min(QUICK_WINS_COUNT, winsDeck.length);

  // How many more are behind this card, so the screen can say so.
  const deck = mode === "next"
    ? rankOpen(tasks, today).filter((t) => !skipped.includes(t.id))
    : winsDeck.slice(winsAt);

  const face = current ? {
    areaName: catName(current.data.category),
    areaSlot: catColor(current.data.category),
    reasons: reasonFacts(current, today, inPeak),
    // Title Case whatever he typed (Dave 2026-10-05); the record keeps his spelling.
    text: titleCase(current.data.text),
  } : null;

  // THE COUNTDOWN (issue 108, Dave 2026-10-13: "the task title, a countdown, then the existing controls"). The one real timer
  // here is the fifteen-minute block (today/liveFifteen.ts), so the number is that block's, from the same helper Today's
  // headliner reads. Before a block starts it is the window the 15 Min capsule will run: "15:00", the size of the promise and
  // not a clock that moves. While a block runs on THIS card it is the block's own time left, which TodayFlow's one-second tick
  // already re-renders, so this screen adds no timer of its own; once it is up it reads 0:00 and says so. A card the block is
  // not running on, Quick Wins (its own 10:00 stays the run line above) and the end of a deck have nothing to count, so they
  // draw nothing.
  const clock = ((): FocusClock | null => {
    if (mode !== "next" || !current) return null;
    if (!fifteen) return onFifteen ? { text: countdown(FIFTEEN * 60_000), caption: "Fifteen Minutes", live: false } : null;
    if (fifteen.taskId !== current.id) return null;
    return { text: fifteen.clock, caption: fifteen.over ? fifteen.line : "Left", live: true, warn: fifteen.over };
  })();

  const finale = winsOver ? {
    title: winsDone > 0 ? `${winsDone} Down` : "The Deck's Still Here",
    sub: winsDone >= winsTotal && winsDeck.length > 0
      ? "A Clean Sweep"
      : winsDone > 0
        ? "Ride the momentum or rest"
        : "No pressure",
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
        {...(onFifteen && !fifteen && current ? { onFifteen: () => beginFifteen(current) } : {})}
        fifteenBusy={starting}
        onDone={complete}
        doneBusy={completing.current}
        onSkip={skip}
        clock={clock}
        running={fifteen ? { text: fifteen.text, line: fifteen.line, over: fifteen.over } : null}
        {...(onFifteenDone ? { onRunDone: onFifteenDone } : {})}
        {...(onFifteenAgain ? { onRunAgain: onFifteenAgain } : {})}
        {...(onFifteenStop ? { onRunStop: onFifteenStop } : {})}
        wins={mode === "wins" && !winsOver ? { done: winsDone, total: winsTotal, clock: fmtClock(secondsLeft) } : null}
        finale={finale}
        onBackToNext={backToNext}
        music={<MusicChip context="focus" />}
        guard={<HyperfocusLine guard={guard} />}
      />
      <Burst show={bursting} />
    </>
  );
}
