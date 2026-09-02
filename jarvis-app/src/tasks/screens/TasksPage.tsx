import React, { useEffect, useRef, useState } from "react";
import PageHeader, { BarAction, BarText } from "../../shared/PageHeader";
import { useSelection } from "../../shared/useSelection";
import SelectBar from "../../shared/SelectBar";
import { Plus, Trash2, Clock, ListChecks, Check } from "../../shared/icons";
import SkeletonRows from "../../shared/SkeletonRows";
import { Burst } from "../../shared/Burst";
import type { TaskItem } from "../TasksService";
import { urgencyFor, distanceFor, type UrgencyKind } from "../grouping";
import { FILTERS, FILTER_LABEL, type TaskFilter } from "../filters";
import { categoriesOf } from "../categories";
import { catColor, catName } from "../../shared/categories";
import type { SheetCategory } from "./TaskSheet";
import { useSwipe } from "../../shared/useSwipe";
import Provenance from "../../shared/Provenance";
import { capAfterNumber } from "../../shared/casing";
import { cueLine } from "../ifThen";
import { OVERWHELM_ENTER, OVERWHELM_EXIT } from "../overwhelmed";
import InlineEdit from "../../shared/InlineEdit";
import HeadMenu from "../../shared/HeadMenu";
import { useLongPress } from "../../shared/useLongPress";
import { haptics } from "../../shared/haptics";
import { ParentLineGlyph } from "../../shared/glyphs";
import type { ParentLine } from "../../life/parent";

// Tasks page. Two-line rows with a large (44pt) completion target on the left
// and swipe-left-to-delete, so completing or removing a task is one easy action.

const URGENCY_CLASS: Record<UrgencyKind, string> = {
  overdue: "urgency-red",
  today: "urgency-warn",
  soon: "urgency-muted",
};

// GROUP BY. "none" is one flat list; the other three cut it under heads.
// Session memory, not storage: the segment forgets on launch and so does this.
type GroupBy = "none" | "category" | "goal" | "due";
let lastGroupBy: GroupBy = "none";
const GROUP_LABEL: Record<GroupBy, string> = { none: "None", category: "Area", goal: "Goal", due: "Due" };

interface Group { key: string; head: string | null; color?: string; items: TaskItem[]; }

// Category heads follow the user's category order as the items arrive;
// goal heads put No Goal last; due heads run late to far.
function groupItems(items: TaskItem[], by: GroupBy, goalOf: ((t: TaskItem) => string | null) | undefined, today: string): Group[] {
  if (by === "none") return [{ key: "all", head: null, items }];
  const order: string[] = [];
  const buckets = new Map<string, Group>();
  const put = (key: string, head: string, item: TaskItem, color?: string) => {
    let g = buckets.get(key);
    if (!g) { g = { key, head, color, items: [] }; buckets.set(key, g); order.push(key); }
    g.items.push(item);
  };
  for (const it of items) {
    const t = it.data;
    if (by === "category") {
      const id = categoriesOf(t)[0] ?? "";
      put(id || "none", catName(id) || "No category", it, id ? catColor(id) : undefined);
    } else if (by === "goal") {
      const g = goalOf?.(it) ?? null;
      put(g ? "g:" + g : "none", g ?? "No goal", it);
    } else {
      const d = t.done ? null : distanceFor(t, today);
      const key = d ? d.kind : t.due ? "later" : "undated";
      put(key, { today: "Today", late: "Overdue", later: "Later", undated: "No date" }[key] ?? key, it);
    }
  }
  const rank = (k: string) => by === "due" ? ["late", "today", "later", "undated"].indexOf(k) : k === "none" ? 1 : 0;
  return order.map((k) => buckets.get(k)!).sort((a, b) => rank(a.key) - rank(b.key));
}

// Empty-state copy, written per filter. The old version built the line from
// the filter label ("No " + label + " tasks"), which produced "No today
// tasks", "No done tasks" and "No all tasks". A template that reads wrong in
// half its cases is not worth the line of code it saves.
const EMPTY_TITLE: Record<TaskFilter, string> = {
  all: "No tasks yet",
  daily: "No dailies yet",
  today: "Nothing due today",
  overdue: "Nothing overdue",
  upcoming: "Nothing coming up",
  done: "Nothing completed yet",
};

// The second line exists ONLY when it carries information the user cannot
// already see. "Add one above and I will keep track of it", "Finished tasks
// collect here", "Tasks with a future date land here" are all directions, and
// the app does not ship permanent helper text. The single case that earns a
// line is an empty Today sitting on top of overdue work, because the screen
// otherwise reads as "you are done" when the opposite is true.
function emptySub(filter: TaskFilter, counts: Record<TaskFilter, number>): string | null {
  if (filter === "today" && counts.overdue > 0) {
    return capAfterNumber(`${counts.overdue} overdue waiting`);
  }
  return null;
}

// THE CHIP ROWS ARE GONE (Fewer Buttons, Dave 2026-09-02). The 08-29 audit's
// scrolling row (measured overflow, the geometric "more" mark) went with
// them; the menus on the list head carry every filter and every count the
// chips did, and a menu never overflows sideways. The laws keep the record.

// THE TASK ROW, everywhere a task is a row (exported 2026-09-02 for the
// Health page's Up Next, Dave: "Add task on the same page as well should
// render as a task there like it does everywhere else after. It should have
// the same clearing ability as well"). One row, one set of gestures: the
// check completes, the swipe reveals Tomorrow and Delete, the title opens,
// the hold renames.
export function TaskRow({
  item,
  today,
  onToggle,
  onOpen,
  onDelete,
  onSnooze,
  onRename,
  onStart,
  selecting = false,
  picked = false,
  onPick,
  muteToday = false,
  parent = null,
  kicker = null,
}: {
  item: TaskItem;
  today: string;
  // Select mode: the row picks instead of opening, and the swipe is off
  // because a half-swiped row under a selection is two gestures fighting.
  selecting?: boolean;
  // TODAY SAYS NOTHING ON THE TODAY FILTER (Dave 2026-08-29: "it blends in
  // too much"). Half the fix is the chip treatment below; the other half is
  // that a tag repeated on every row of a filter NAMED for it carries zero
  // information there. OVERDUE still shows everywhere: that one is a fact
  // the filter name does not already state.
  muteToday?: boolean;
  picked?: boolean;
  onPick?: (id: string) => void;
  onToggle?: (id: string) => void;
  onOpen?: (id: string) => void;
  onDelete?: (id: string) => void;
  onSnooze?: (id: string) => void;
  // B6 (2026-08-23): rename where it stands, without the sheet.
  onRename?: (id: string, text: string) => void;
  // A2 (audit 2026-08-21): the Tasks tab could not START anything. Every
  // task in the app lived here, and the one thing an ADHD app exists to help
  // with -- getting going -- was only reachable from a card on Today that
  // showed one task. Same pill, same behaviour, same place in the row.
  onStart?: (id: string) => void;
  // THE RULED ROW (2026-09-01, 2026-09-02): the second line says where this task
  // moves. Null when it moves none; the row then says the category, so
  // every row keeps two lines and a fact. Derived by the flow from one
  // goal index, the same one Today reads, so the two pages cannot disagree.
  parent?: ParentLine | null;
  // A caller's own second line (a reminder's time on the Health page),
  // in place of the parent or category words.
  kicker?: string | null;
}) {
  const t = item.data;
  const u = urgencyFor(t, today);
  // The distance chip: TODAY, 2 DAYS LATE, 3 WEEKS LATE, OVER A MONTH.
  // Same ladder as Today's dealt row (distanceFor). Muted on the Today
  // filter, where every row would say the same word.
  const dist = distanceFor(t, today);
  const chip = dist && !t.done && !(muteToday && dist.kind === "today") ? dist : null;
  const prevDone = useRef(t.done);
  const [burst, setBurst] = useState(false);
  // Optimistic completion: flip + burst immediately, hold the real toggle
  // 600ms so the row does not unmount (regroup to Done) mid-animation.
  const [localDone, setLocalDone] = useState(false);
  const pendingDone = useRef(false);
  const shownDone = t.done || localDone;
  // Open tasks also reveal a "tomorrow" action; BILLS DO NOT (Money v1):
  // pushing rent to tomorrow in one gesture is exactly the ADHD-tax move the
  // money track exists to stop. Delete stays; deferral needs the sheet.
  // And only where the caller can move it: a reminder on the Health page
  // has no Tomorrow, so its reveal is Delete alone.
  const snoozable = !t.done && !t.bill && !!onSnooze;
  const { dx, dragging, handlers } = useSwipe({ revealW: snoozable ? 176 : 88 });

  useEffect(() => {
    if (t.done && !prevDone.current) {
      setBurst(true);
      const id = setTimeout(() => setBurst(false), 650);
      prevDone.current = t.done;
      return () => clearTimeout(id);
    }
    prevDone.current = t.done;
  }, [t.done]);

  // Rename is a mode the row enters deliberately, not something a tap can
  // fall into. .renaming lifts the row while it is open so the gesture is
  // visible rather than silent.
  const [renaming, setRenaming] = useState(false);
  const hold = useLongPress({
    onLongPress: () => { haptics.selection(); setRenaming(true); },
    enabled: !!onRename && !t.done && !selecting,
  });

  const tapCheck = () => {
    if (pendingDone.current) return;
    if (t.done) { onToggle?.(item.id); return; } // un-completing: no ceremony
    pendingDone.current = true;
    setLocalDone(true);
    setBurst(true);
    setTimeout(() => setBurst(false), 650);
    setTimeout(() => { pendingDone.current = false; setLocalDone(false); onToggle?.(item.id); }, 600);
  };

  return (
    <div className="task-swipe">
      {snoozable && (
        <button className="task-snooze" onClick={() => onSnooze?.(item.id)} aria-label="Move to tomorrow">
          <Clock className="ic" />
          <span className="swipe-label">Tomorrow</span>
        </button>
      )}
      {/* B13 (2026-08-23): a clock and a trash can, side by side, in two
          coloured slots, with nothing saying which is which. Both say their
          names now. Reveal width is unchanged: the labels fit 88px. */}
      <button className="task-del" onClick={() => onDelete?.(item.id)} aria-label="Delete task">
        <Trash2 className="ic" />
        <span className="swipe-label">Delete</span>
      </button>
      <div
        className={"task-row" + (renaming ? " renaming" : "") + (t.done ? " completed" : "") + (burst ? " just-done" : "") + (dragging ? " swiping" : "")}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        {...handlers}
      >
        {/* SELECT MODE TAKES THE CHECK COLUMN (2026-08-24). The row already
            has a circle in front of it that means "tick this off", and a
            second circle beside it meaning "pick this one" would be two
            round controls saying different things in the same place. While
            selecting, the done-check steps aside and the selection box has
            the column to itself. Completing a task is not something anyone
            needs mid-selection. */}
        {selecting ? (
          <button
            type="button"
            className={"sel-box" + (picked ? " on" : "")}
            role="checkbox"
            aria-checked={picked}
            aria-label={picked ? "Deselect " + t.text : "Select " + t.text}
            onClick={(e) => { e.stopPropagation(); onPick?.(item.id); }}
          >
            {picked && <Check className="ic" />}
          </button>
        ) : (
          <div
            className="task-check-tap"
            onClick={(e) => { e.stopPropagation(); tapCheck(); }}
            role="checkbox"
            aria-checked={shownDone}
            aria-label={shownDone ? "Mark not done" : "Mark done"}
          >
            {/* Always neutral, green when done (ruled 2026-09-01). The bar on the
                second line carries the category now; a coloured ring said
                the same thing twice and made the done state a colour change
                instead of a state change. */}
            <div className={"task-check" + (shownDone ? " done" : "")} />
            <Burst show={burst} />
          </div>
        )}
        <div className="task-title" role="button" tabIndex={0} onClick={() => (selecting ? onPick?.(item.id) : onOpen?.(item.id))}>
          {/* THE TAP OPENS. RENAME IS THE LONG PRESS (Dave 2026-08-24: "when
              I tap to edit a task it now edits the text instead... it's WAY
              more important that I can easily click and edit the tasks").
              The title IS the row to anyone using it, so its tap opens;
              rename lives on the press-and-hold and edits where it stands.
              Held rows say so with .renaming. */}
          {renaming && onRename && !t.done ? (
            <div onClick={(ev) => ev.stopPropagation()}>
              <InlineEdit
                className="task-name"
                value={t.text}
                focused
                onSave={(v) => {
                  setRenaming(false);
                  const next = v.trim();
                  if (next && next !== t.text) onRename(item.id, next);
                }}
              />
            </div>
          ) : (
            <span className="task-name" {...(onRename && !t.done && !selecting ? hold : {})}>{t.text}</span>
          )}
          {/* THE RULED ROW'S SECOND LINE (Dave 2026-09-01, "Together" catalog;
              The Row and Health, 2026-09-02). Chip first, so it sits at one
              x whenever it appears. Then where the task lives: the parent's
              own glyph in its category colour (the project's pie, the goal's
              target, the category dot) and the parent's full name in one
              quiet grey. The vertical bar is gone; the glyph is the colour.
              The old caps eyebrow, the urgency chip that sat beside it, and
              the row-tags line they shared are gone; this line is all three. */}
          <div className="r-k">
            {chip && <span className={"uchip " + (chip.kind === "late" ? "u-late" : "u-today")}>{chip.label}</span>}
            {kicker
              ? <span className="r-goal r-cat">{kicker}</span>
              : parent
              ? <ParentLineGlyph p={parent} />
              : <span className="r-goal r-cat">
                  {categoriesOf(t).map((id) => catName(id)).filter(Boolean).join(" \u00b7 ") || "No category"}
                </span>}
            {t.recurrence && <span className="r-goal r-cat r-rec">{"\u00b7 " + t.recurrence}</span>}
          </div>
          {/* A1: the cue, where he will see it while scanning. The whole
              sentence is on the sheet; the row carries the trigger, which is
              the half that has to be recognisable in the moment. */}
          {t.plan && <div className="task-cue">{cueLine(t.plan)}</div>}
          {/* Provenance Line (addendum item 8): auto-created rows say where
              they came from; hand-made rows render nothing here. */}
          <Provenance source={t.source} />
        </div>
        {/* The urgency label steps aside for Start, exactly as it does on
            Today: knowing a thing is due is worth less than a way to begin
            it, and two pills on one row is the clutter that made the audit
            flag this list in the first place. */}
        {/* The urgency fallback below only fires for a caller that mounts
            Row with no onStart. It is guarded against u.kind !== "soon" so
            it can never double up with the tag row-tags now renders above:
            the two were written to divide the same information, not repeat
            it. */}
        {selecting ? null : onStart && !shownDone
          ? <button className="pill-act" onClick={(e) => { e.stopPropagation(); onStart(item.id); }}>Start</button>
          : u && u.kind === "soon" && <span className={"urgency " + URGENCY_CLASS[u.kind]}>{u.label}</span>}
      </div>
    </div>
  );
}

export default function TasksPage({
  filter,
  counts,
  items,
  loading,
  today,
  onFilter,
  onToggle,
  onOpenTask,
  onDeleteTask,
  onSnoozeTask,
  onStartTask,
  onNew,
  onRenameTask,
  onClearDone,
  categories,
  catFilter,
  onCatFilter,
  notice,
  momentum,
  onPickOne,
  onCalm,
  overwhelmed = false,
  onMoveAllToToday,
  onDeleteMany,
  onDoneMany,
  goalOf,
  parentOf,
  title = "Tasks",
  segments,
}: {
  filter: TaskFilter;
  counts: Record<TaskFilter, number>;
  items: TaskItem[];
  loading?: boolean;
  today: string;
  onFilter?: (f: TaskFilter) => void;
  onToggle?: (id: string) => void;
  onOpenTask?: (id: string) => void;
  onDeleteTask?: (id: string) => void;
  onSnoozeTask?: (id: string) => void;
  onStartTask?: (id: string) => void;
  onNew?: () => void;
  onRenameTask?: (id: string, text: string) => void;
  onClearDone?: () => void;
  categories?: SheetCategory[];
  catFilter?: string;
  onCatFilter?: (id: string) => void;
  // THE NOTICE ROW (Fewer Buttons, 2026-09-02): the one offer the flow has
  // for this list (the task that keeps sliding), rendered as the first row
  // of the first card, never as a card floating above the list.
  notice?: React.ReactNode;
  // Momentum Chain: a suggestion element pinned under the row it follows.
  momentum?: { afterId: string; el: React.ReactNode } | null;
  // The goal a task moves, from the flow's goal index (see Row.goal).
  // Group-by Goal reads the goal a task moves, by title, so the heads read
  // as goals. The row itself reads parentOf (2026-09-02).
  goalOf?: (t: TaskItem) => string | null;
  parentOf?: (t: TaskItem) => ParentLine | null;
  // LIFE (2026-09-01): the head's word and the segment control under it,
  // when this page is the Tasks lens of the Life tab.
  title?: string;
  segments?: React.ReactNode;
  // THE DECISION KILLERS (Dave 2026-08-19, ADHD round). Pick One opens the
  // single best task for right now so the list never has to be read; Move
  // All resets an overdue pile in one tap instead of one tap per shame.
  onPickOne?: () => void;
  // F1: hide everything but the one smallest thing. A view, never a write.
  // The door in is on the What Now sheet (Fewer Buttons, 2026-09-02); the
  // page carries only the door out.
  onCalm?: () => void;
  overwhelmed?: boolean;
  onMoveAllToToday?: () => void;
  // BULK (Dave 2026-08-24: "It should be very easy to clear and delete
  // stuff. Also in bulk"). One call for the whole selection rather than a
  // loop of single deletes at the call site, so the flow can write one undo
  // that brings all of them back together.
  onDeleteMany?: (ids: string[]) => void;
  onDoneMany?: (ids: string[]) => void;
}) {
  // Select mode owns the ids currently ON SCREEN, so a filter change or a
  // reload can never leave a selection pointing at rows that are gone.
  const sel = useSelection(items.map((i) => i.id));
  // GROUP BY (ruled 2026-09-01: "a group-by dropdown"). Remembered within
  // the session, reset on launch, like the segment.
  const [groupBy, setGroupBy] = useState<GroupBy>(lastGroupBy);
  const setGroup = (g: GroupBy) => { lastGroupBy = g; setGroupBy(g); };
  const groups = groupItems(items, groupBy, goalOf, today);
  return (
    <div className="screen ruled">
      {/* Select is a HEADER BUTTON, not a hidden long press. Dave asked for
          this to be easy, and a bulk action nobody can find is not easy: the
          long press is a shortcut for people who already know it exists, and
          the button is how they find out. Done replaces it while selecting,
          because the way out is the one control that must never move. */}
      <PageHeader
        title={title}
        actions={
          sel.active ? (
            <BarText label="Done" strong onClick={sel.exit} />
          ) : (
            <>
              {onDeleteMany && items.length > 0 && (
                <BarText label="Select" onClick={() => sel.enter()} />
              )}
              <BarAction label="New Task" onClick={onNew}><Plus className="ic" /></BarAction>
            </>
          )
        }
      />
      {segments}

      {/* ONE DECISION KILLER (Fewer Buttons, Dave 2026-09-02, picked "Pick
          One alone; Just This One lives inside it"). The row above the
          head carries one red button. Just This One is an action on the
          What Now sheet that button opens (the shell's RightNowSheet), so
          the same ranking has one door. While the mode is on, the page IS
          the one thing and this row is the way back out. */}
      {overwhelmed ? (
        <div className="pad-x pick-one">
          <button className="btn btn-block" onClick={onCalm}>{OVERWHELM_EXIT}</button>
        </div>
      ) : onPickOne && counts.all > 0 && (
        <div className="pad-x pick-one">
          {/* "Pick One", matching Today's identical action (see the note on
              the goal nudge in TodayFlow, which named itself after this
              button). Was "Just Pick One For Me": "Just" reads as begging
              and "For Me" casts the user as a dependent asking a
              caretaker, when the app is simply doing its job. */}
          <button className="btn btn-primary btn-lg btn-block" onClick={onPickOne}>Pick One</button>
        </div>
      )}

      {/* THE HEAD IS THE CONTROLS (Fewer Buttons, Dave 2026-09-02: "I don't
          like all those floating buttons. There's way too many."; picked
          "One line of dropdowns on the list head"). Counted from his
          screenshot: two big buttons, a row of six filter chips, a row of
          area chips, a floating card, then the head with its Group by
          pill; six things before the first task. This line is the head
          now, and it is the controls: the view on the left, the head's
          own word with the list's count, opening every filter with its
          count; the area and the grouping on the right. Every count the
          chips carried is still one tap away, inside its menu. In the Just
          This One mode the head states the mode and carries no menu, since
          the list is one thing whatever the view says. */}
      <div className="dd-line">
        {overwhelmed ? (
          <span className="dd dd-lead dd-static">{OVERWHELM_ENTER}</span>
        ) : (
          <>
            <HeadMenu
              lead
              ariaLabel="Show"
              value={filter}
              label={FILTER_LABEL[filter]}
              count={items.length}
              options={FILTERS.map((f) => ({ value: f, label: FILTER_LABEL[f], count: counts[f] }))}
              onPick={(v) => onFilter?.(v as TaskFilter)}
            />
            <span className="dd-sp" />
            {categories && categories.length > 0 && (
              <HeadMenu
                ariaLabel="Area"
                value={!catFilter || catFilter === "all" ? "all" : catFilter}
                // The capsule names the control, like Group beside it (Dave
                // 2026-09-02: "All areas should read Area to match Group");
                // the menu's first option still says All Areas.
                label={!catFilter || catFilter === "all" ? "Area" : undefined}
                options={[{ value: "all", label: "All Areas" }, ...categories.map((c) => ({ value: c.id, label: c.name, dot: c.color }))]}
                onPick={(v) => onCatFilter?.(v)}
              />
            )}
            {/* GROUP BY (ruled 2026-09-01: "a group-by dropdown"). Off by
                default: the view already cuts the list, and heads on top
                of a cut are a second cut nobody asked for. */}
            <HeadMenu
              ariaLabel="Group by"
              value={groupBy}
              label={groupBy === "none" ? "Group" : "By " + GROUP_LABEL[groupBy]}
              options={(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => ({ value: g, label: GROUP_LABEL[g] }))}
              onPick={(g) => setGroup(g as GroupBy)}
            />
          </>
        )}
      </div>

      {/* THE DUPLICATE ADD BOX IS GONE (2026-08-21, Dave: "Add task type box
          makes no sense"). It was a plain text field that parsed dates and
          nothing else, sitting one screen above the JARVIS capture bar, which
          does the same job and also reads categories, people and projects.
          Two boxes, one job, and the worse one was on top. */}

      {/* The two bulk verbs a view can carry, both the neutral pill, both
          in the same seat under the head: an overdue pile resets in one
          tap instead of one tap per shame; a done list clears. */}
      {filter === "overdue" && items.length > 0 && onMoveAllToToday && (
        <div className="pad-x clear-done">
          <button className="btn btn-secondary" onClick={onMoveAllToToday}>Move All to Today</button>
        </div>
      )}

      {filter === "done" && counts.done > 0 && onClearDone && (
        <div className="pad-x clear-done">
          <button className="btn btn-secondary" onClick={onClearDone}>Clear {counts.done} Completed</button>
        </div>
      )}

      {loading ? (
        <SkeletonRows />
      ) : items.length === 0 ? (
        <>
        {notice && <div className="card list-card-ruled">{notice}</div>}
        <div className="empty-state">
          <div className="empty-icon"><ListChecks className="ic" /></div>
          <div className="empty-title">{EMPTY_TITLE[filter]}</div>
          {emptySub(filter, counts) && <div className="empty-sub">{emptySub(filter, counts)}</div>}
          {/* No button here WHEN THERE IS ANOTHER RED. The "+" in the nav bar
              is the way to make a task, and a second red fill on a screen
              allowed only one is what the removed quick-add box was spending.

              B14 (2026-08-23): that reasoning has a hole, and it opens in
              exactly the case this branch renders. The red it defers to is
              Pick One, which is gated on `counts.all > 0`. With
              no tasks at all, that button does not render, this screen has
              ZERO red fills, and the argument for withholding one is spending
              a budget nothing is using. A first-run user got a page that
              named its own emptiness and offered nothing.

              So: still nothing when there is a task somewhere to pick, and
              the obvious next tap when the whole list is empty. */}
          {onNew && counts.all === 0 && (
            <button className="btn btn-primary" onClick={onNew}>New Task</button>
          )}
        </div>
        </>
      ) : (
        <div>
          {/* ONE CARD (Dave 2026-09-01: "Go with pic 1. Apply that
              everywhere"). The 08-18 library form put bare rows on the
              page ground; every other list on Today wears a card, and this
              was the one that did not. Rows ride inside one grouped card
              now, hairlines inset past the check, the same material as
              Your Move. With grouping on, each group is its own card under
              its own head. */}
          {groups.map((g, gi) => (
            <React.Fragment key={g.key}>
              {g.head && (
                <div className="grp-head">
                  {g.color && <span className={"cat-dot cat-bg-" + g.color} />}
                  {g.head}
                  <span className="n">{g.items.length}</span>
                </div>
              )}
              <div className="card list-card-ruled">
                {gi === 0 && notice}
                {g.items.map((it) => (
                  <React.Fragment key={it.id}>
                    <TaskRow
                      item={it} today={today} onToggle={onToggle} onOpen={onOpenTask}
                      onDelete={onDeleteTask} onSnooze={onSnoozeTask} onStart={onStartTask} onRename={onRenameTask}
                      selecting={sel.active} picked={sel.isSelected(it.id)}
                      onPick={sel.toggle} muteToday={filter === "today"}
                      parent={parentOf?.(it) ?? null}
                    />
                    {/* Momentum Chain (addendum item 7): the suggestion slides
                        into the just-finished slot, right below its row. */}
                    {momentum?.afterId === it.id && momentum.el}
                  </React.Fragment>
                ))}
              </div>
            </React.Fragment>
          ))}
          {/* B8 (2026-08-23): EVERY LIST ENDS WITH THE WAY TO GROW IT.
              The "+" in the nav bar is the only way to add a task from this
              screen, which means the answer to "I just thought of one more"
              is at the far top of a list you have scrolled to the bottom of.
              One row costs less than that hunt.

              NEUTRAL, never a fill: .row-act is what components.css calls
              "the ONE sanctioned bare-text action", and it is exactly why
              this can coexist with the one-red law that the old comment above
              cited as the reason not to have it at all.

              Not shown on the done list, where "add a completed task" is not
              a thing anyone wants, and not shown while the overwhelmed view
              is deliberately collapsing the page to one thing. */}
          {onNew && filter !== "done" && !overwhelmed && items.length > 0 && (
            // .row-act centres itself with `margin: auto`, which works in the
            // flex-column CARD its other 26 call sites live in and does
            // nothing in a plain block parent like this full-bleed list. The
            // walk caught it hanging off the left edge. One flex wrapper
            // rather than touching a class 26 places depend on.
            <div className="list-foot"><button className="row-act" onClick={onNew}>Add a Task</button></div>
          )}
        </div>
      )}
      {/* This page had no foot spacer at all, so its last row sat under the
          capture bar with nothing below it to scroll (2026-08-24 walk, which
          found Add a Task permanently covered). Every other scrolling screen
          in the app already ends with one. */}
      <div className="screen-foot" />
      {onDeleteMany && (
        <SelectBar
          sel={sel}
          noun="Task"
          onDelete={() => { onDeleteMany(sel.selected); sel.exit(); }}
          {...(onDoneMany ? { extraLabel: "Mark Done", onExtra: () => { onDoneMany(sel.selected); sel.exit(); } } : {})}
        />
      )}
    </div>
  );
}
