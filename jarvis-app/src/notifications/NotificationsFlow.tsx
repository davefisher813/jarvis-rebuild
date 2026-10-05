import { useCallback, useEffect, useState } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import { useTasks, useSchedule, useGoals, useProfile } from "../data/NotesProvider";
import { todayISO } from "../ai/useAIContext";
import { buildFeed, loadNudgeDismissed, dismissNudge, type Nudge, type NudgeKind } from "./feed";
import { RowGlyph, type RowKind } from "../shared/anatomy";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { haptics } from "../shared/haptics";
import { BellGlyph } from "../shared/glyphs";
import RowCtxAction from "../shared/RowCtxAction";
import { SwipeShell } from "../today/MoveHeadliner";
import { titleCase } from "../shared/casing";
import { fmtTime } from "../schedule/calendar";

// An event's when is its start as HH:MM from the feed; the chip says it the
// way the Schedule does ("5:30 PM").
const whenWord = (w: string) => (/^\d\d:\d\d$/.test(w) ? `${fmtTime(w).time} ${fmtTime(w).ap}` : w);

const BELL = <BellGlyph />;

// V2 anatomy: rows lead with the shared TYPE tile, not a per-surface icon
// set. What a nudge IS (task, event, goal) reads before its words do.
const KIND: Record<NudgeKind, RowKind> = {
  sliding: "task",
  overdue: "task",
  due_today: "task",
  event: "event",
  goal_risk: "goal",
};

// THE WHY TAKES THE COLOUR KEY (§AM, 2026-09-26). Every sub line here was the
// same plain grey, so "Overdue" and "Due today" read as neutral as "Today"
// under an event. Late and due are the task row's own urgency chips (Tasks,
// Today and Projects draw the same facts that way); an at-risk goal needs
// him soon, so it is amber.
const SUB: Record<NudgeKind, string> = {
  sliding: "r-goal r-cat",
  overdue: "uchip u-late",
  due_today: "uchip u-today",
  event: "r-goal r-cat",
  goal_risk: "r-goal fact warn",
};

// The sliding task's evidence says what it says, in the key (2026-09-26). It
// was left the one grey because the chip beside it carries the verdict, but
// the chip is the verdict and not the evidence: "23 Days late" is a lateness
// and "Pushed 3 times" is a stall, and grey said neither. Late is red and a
// stall is the amber the Tasks row's own stalled line wears, which is how the
// task sheet tones the same words. The line keeps .r-goal for its size and
// truncation; the tone rides on it.
function subClass(n: Nudge): string {
  if (n.kind !== "sliding") return SUB[n.kind];
  return /\blate$/i.test(n.sub) ? "r-goal fact red" : "r-goal r-cat r-stalled";
}

// A1 (audit 2026-08-21). Every row here was a static div: ten sentences
// telling him things with nothing to do about any of them, which is how a
// notification screen teaches you to stop reading it. The row opens the
// thing it is about, and a task can be finished without leaving.
//
// NO PILL ON THE ROW (Dave 2026-10-05, locked: "Clean rows, no pills anywhere"). The Done capsule that sat on every
// task row is gone, and so is the long-press menu that was the second door to Dismiss. The row is the shell every Today
// row wears (SwipeShell): swipe left is Done for a task and Dismiss for everything else, with Dismiss second behind a
// Done; swipe right clears the row, Done for a task and Dismiss otherwise ("a notification is cleared, not finished",
// laws.test.ts: the gesture means what it already meant); a tap opens the thing the row is about, whose sheet holds the
// rest; and an OVERDUE task, whose moment has come, quietly shows Done as text on the row.
function NudgeRow({ n, onDone, onDismiss, children }: { n: Nudge; onDone: () => void; onDismiss: () => void; children: React.ReactNode }) {
  const isTask = n.entity === "task";
  return (
    <div className="pad-x">
      <SwipeShell
        actions={[...(isTask ? [{ label: "Done", run: onDone }] : []), { label: "Dismiss", run: onDismiss }]}
        onRight={isTask ? onDone : onDismiss}
        rightLabel={isTask ? "Done" : "Dismiss"}
      >
        {children}
      </SwipeShell>
    </div>
  );
}

export default function NotificationsFlow({ onOpen }: { onOpen?: (kind: string, id: string) => void }) {
  const tasksSvc = useTasks(); const sched = useSchedule(); const goalsSvc = useGoals(); const profileSvc = useProfile();
  const [feed, setFeed] = useState<Nudge[]>([]);
  const reload = useCallback(async () => {
    const [tasks, events, goals, profile] = await Promise.all([tasksSvc.listTasks(), sched.listEvents(), goalsSvc.list(), profileSvc.get()]);
    const n = { overdue: true, events: true, goals: true, ...(profile?.notify ?? {}) };
    const today = todayISO();
    // The clock and the dismissed list are what make this a status screen
    // rather than a list of everything that was ever true today (Laws 1, 2).
    const now = new Date();
    const nowHHMM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const all = buildFeed({ tasks, events, goals }, today, nowHHMM, loadNudgeDismissed(today));
    setFeed(all.filter((x) => {
      if (x.kind === "sliding" || x.kind === "overdue" || x.kind === "due_today") return n.overdue;
      if (x.kind === "event") return n.events;
      return n.goals; // goal_risk
    }));
  }, [tasksSvc, sched, goalsSvc, profileSvc]);
  useEffect(() => { void reload(); }, [reload]);

  const onDismissNudge = (n: Nudge) => {
    haptics.selection();
    dismissNudge(n.id, todayISO());
    setFeed((f) => f.filter((x) => x.id !== n.id));
  };

  // 2026-09-11: Undo puts back the pre-tap snapshot (SHARED-F-03), never a second toggleDone; and every row for this
  // task goes, since the sliding one can also be overdue, and Done on the twin un-completed it.
  const finishTask = (n: Nudge) => {
    void (async () => {
      const before = await tasksSvc.task(n.entityId);
      const ok = await attemptWrite(() => tasksSvc.toggleDone(n.entityId));
      if (!ok) return;
      haptics.selection();
      setFeed((f) => f.filter((x) => !(x.entity === "task" && x.entityId === n.entityId)));
      if (before) showToast({
        message: "Done",
        actionLabel: "Undo",
        onAction: async () => { await attemptWrite(() => tasksSvc.restoreCompletion(n.entityId, before)); await reload(); },
      });
    })();
  };

  // NOTIFICATIONS ONTO THE RULINGS (2026-09-02). One quiet head with the
  // count, one card, and each nudge as the task row's shape: the type glyph
  // in the check column, the name, the why under it, the when at the
  // right, and every verb a gesture (Done where finishing IS the answer,
  // Dismiss beside it; Dave 2026-10-05, no pill on a row). The head splits into Needs You (overdue, due today) and
  // Coming Up (events, goals) when both have rows.
  const needs = feed.filter((n) => n.kind === "sliding" || n.kind === "overdue" || n.kind === "due_today");
  const coming = feed.filter((n) => n.kind !== "sliding" && n.kind !== "overdue" && n.kind !== "due_today");
  const bands = [
    { key: "needs", head: needs.length > 0 && coming.length > 0 ? "Needs You" : "Today", rows: needs },
    { key: "coming", head: "Coming Up", rows: coming },
  ].filter((b) => b.rows.length > 0);
  return (
    <div className="screen ruled">
      <PageHeader title="Notifications" />
      {feed.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">{BELL}</div><div className="empty-title">You're All Caught Up</div>
          <div className="empty-sub">Overdue Tasks, Today's Events and Goals at Risk</div></div>
      ) : (
        <div>
          {bands.map((b) => (
            <div key={b.key}>
              <div className="sh2 sh2-quiet"><span className="t">{b.head}</span><span className="n">{b.rows.length}</span></div>
              <div className="heads-up-stream stream-grouped"><div className="card stream-card">
              {b.rows.map((n) => (
                <NudgeRow key={n.id} n={n} onDone={() => finishTask(n)} onDismiss={() => onDismissNudge(n)}>
                <div
                  className="task-row p2 notif-row"
                  role={onOpen ? "button" : undefined}
                  tabIndex={onOpen ? 0 : undefined}
                  onClick={onOpen ? () => onOpen(n.entity, n.entityId) : undefined}
                >
                  <div className="task-check-tap"><RowGlyph kind={KIND[n.kind]} /></div>
                  <div className="task-title">
                    {/* Title Case whatever he typed (Dave 2026-10-05, Alfred R2); the record keeps his spelling. */}
                    <span className="task-name">{titleCase(n.title)}</span>
                    <div className="r-k">
                      {n.when && <span className="uchip u-today">{whenWord(n.when)}</span>}
                      {n.tag && <span className="slide-tag">{n.tag}</span>}
                      {n.sub && <span className={subClass(n)}>{n.sub}</span>}
                    </div>
                  </div>
                  {/* ITS MOMENT HAS COME (spec section 3): an overdue task shows its one verb as text, the same
                      action as the swipe. Everything not yet late stays clean. */}
                  {n.kind === "overdue" && <RowCtxAction when label="Done" onAct={() => finishTask(n)} />}
                </div>
                </NudgeRow>
              ))}
              </div></div>
            </div>
          ))}
          <div className="screen-foot" />
        </div>
      )}
    </div>
  );
}
