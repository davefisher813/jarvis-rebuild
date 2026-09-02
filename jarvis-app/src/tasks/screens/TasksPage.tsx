import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
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
const GROUP_LABEL: Record<GroupBy, string> = { none: "None", category: "Category", goal: "Goal", due: "Due" };

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

// The group-by control: a pill in the list head; tapped, its options open
// in place and the tap on one is the save (the ChipPicker mechanic, with
// the head's own type). Closed again on pick or on a second tap.
function GroupPicker({ value, onPick }: { value: GroupBy; onPick: (g: GroupBy) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="see-all pill-action gb" onClick={() => { haptics.selection(); setOpen(true); }} aria-label="Group by">
        Group by {"\u00b7"} {GROUP_LABEL[value]}<span className="gb-cv" />
      </button>
    );
  }
  return (
    <div className="gb-open" role="radiogroup" aria-label="Group by">
      {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => (
        <button key={g} className={"chip" + (g === value ? " active" : "")} role="radio" aria-checked={g === value}
          onClick={() => { haptics.selection(); setOpen(false); if (g !== value) onPick(g); }}>
          {GROUP_LABEL[g]}
        </button>
      ))}
    </div>
  );
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

// TASKS AUDIT 2026-08-29, FINDING #4. .chip-row already carried a
// right-edge mask (2026-08-02, "the right-edge fade reads as keep going"),
// clipping the row's own content to transparent over its last 32px. What
// that reveals is whatever sits BEHIND the row -- in dark theme, --bg,
// #000000 -- and a chip's own fill is rgba(255,255,255,0.06): six percent
// white on black. Fading a six-percent-white chip toward black is fading
// toward something it was already almost indistinguishable from, so the
// clip is real and invisible at once. Confirmed with an actual Chromium
// render before writing this, not assumed from the CSS; painting a colour
// overlay instead of clipping alpha was tried first and produces the
// identical result for the same reason.
//
// A colour fade cannot signal "more" against a token pair this close in
// luminance. Geometry can: .chev is drawn in --tx-4, a real stroke colour
// with genuine contrast in both themes, already the app's standing "this
// goes somewhere" mark. It renders only when the row can actually still
// scroll right, measured the same way NoticeCard measures a shredded sub
// (ResizeObserver, not assumed at mount), so it never claims more content
// exists when there isn't any, and disappears once you've reached the end.
function ChipRow({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    check();
    el.addEventListener("scroll", check, { passive: true });
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(check); ro.observe(el); }
    return () => { el.removeEventListener("scroll", check); ro?.disconnect(); };
  });
  return (
    <div className="chip-row-fade">
      <div className="chip-row" ref={ref}>{children}</div>
      {more && <div className="chip-row-more" aria-hidden="true"><div className="chev" /></div>}
    </div>
  );
}

function Row({
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
  const snoozable = !t.done && !t.bill;
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
            {parent
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
  banner,
  momentum,
  onPickOne,
  onOverwhelmed,
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
  banner?: React.ReactNode;
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
  onOverwhelmed?: () => void;
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
  // GROUP BY (ruled 2026-09-01: "a group-by dropdown; chips stay filters").
  // Off by default: the chips already cut the list, and heads on top of a
  // cut are a second cut nobody asked for. Remembered within the session,
  // reset on launch, like the segment.
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

      {/* F1 · JUST THIS ONE. When it is on, the page IS the one thing:
          everything else is hidden, nothing is moved, and one tap brings it
          all back. The research is specific that the cut has to be to one,
          because three is still a decision.
          Both labels live in overwhelmed.ts, next to each other, because
          the door in and the door out are one vocabulary and drifting them
          apart is how a screen ends up telling you two different stories
          about the same mode. The note on OVERWHELM_ENTER carries why the
          old "I'm Overwhelmed" had to go. */}
      {overwhelmed ? (
        <div className="pad-x pick-one">
          <button className="btn btn-block" onClick={onCalm}>{OVERWHELM_EXIT}</button>
        </div>
      ) : (
        <>
          {/* TASKS AUDIT 2026-08-29, FINDINGS A AND B: TWO CTAS, ONE
              QUESTION. These were two full-width buttons STACKED, so the
              first thing on a screen called Tasks was 106px of decision
              about how to look at your tasks, before a single task was
              visible. Side by side they cost one row instead of two, and
              more importantly they read as what they actually are: one
              question ("just give me one thing") with two answers, rather
              than two separate demands.

              They are closer than even that. Pick One now opens What Now,
              which ranks with theOneThing(); Just This One collapses the
              list using theOneThing() as well, both with the same constant
              estimator. Same function, same input, same top task: one shows
              it in a sheet, the other shows it in the list. Presenting them
              as a pair is honest about that. Whether the app should ship
              both at all is a bigger call than this audit, and it is
              flagged rather than taken.

              Pick One keeps the fill and leads, because starting beats
              filtering. When counts.all <= 2 it is alone in the row and
              flex:1 gives it the full width it had before. */}
          {((onPickOne && counts.all > 0) || (onOverwhelmed && counts.all > 2)) && (
            <div className="pad-x pick-one cta-pair">
              {/* "Pick One", matching Today's identical action (see the note
                  on the goal nudge in TodayFlow, which named itself after
                  this button). Was "Just Pick One For Me": "Just" reads as
                  begging and "For Me" casts the user as a dependent asking
                  a caretaker, when the app is simply doing its job. */}
              {onPickOne && counts.all > 0 && (
                <button className="btn btn-primary btn-lg" onClick={onPickOne}>Pick One</button>
              )}
              {/* btn-secondary, not bare btn. Bare .btn is press-3 with
                  `color: var(--tint)`, i.e. RED TEXT, which was survivable
                  while this sat on its own row and is not survivable beside
                  a red fill: the rendered pair was two reds of equal weight
                  arguing about which one you meant. btn-secondary is the
                  identical pill with --tx-1 text, so the loud one stays
                  loud and this reads as the quiet alternative it is. Caught
                  by screenshotting the pair, not by reading the JSX; the
                  colour lives two files away from the class name. */}
              {onOverwhelmed && counts.all > 2 && (
                <button className="btn btn-secondary btn-lg" onClick={onOverwhelmed}>{OVERWHELM_ENTER}</button>
              )}
            </div>
          )}
        </>
      )}

      <ChipRow>
        {FILTERS.map((f) => (
          <button
            key={f}
            className={"chip" + (f === filter ? " active" : "")}
            onClick={() => onFilter?.(f)}
          >
            {FILTER_LABEL[f]} &middot; {counts[f]}
          </button>
        ))}
      </ChipRow>

      {categories && categories.length > 0 && (
        <ChipRow>
          <button className={"chip" + (!catFilter || catFilter === "all" ? " active" : "")} onClick={() => onCatFilter?.("all")}>All</button>
          {categories.map((c) => (
            <button key={c.id} className={"chip" + (catFilter === c.id ? " active" : "")} onClick={() => onCatFilter?.(c.id)}>
              <span className={"cat-dot cat-bg-" + c.color} />{c.name}
            </button>
          ))}
        </ChipRow>
      )}

      {/* THE DUPLICATE ADD BOX IS GONE (2026-08-21, Dave: "Add task type box
          makes no sense"). It was a plain text field that parsed dates and
          nothing else, sitting one screen above the JARVIS capture bar, which
          does the same job and also reads categories, people and projects.
          Two boxes, one job, and the worse one was on top. */}

      {banner}

      {filter === "overdue" && items.length > 0 && onMoveAllToToday && (
        <div className="sh2 sh2-quiet">
          <span className="t">Overdue</span>
          <span className="n">{items.length}</span>
          <button className="see-all" onClick={onMoveAllToToday}>Move All to Today</button>
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
      ) : (
        <div>
          {/* ONE CARD (Dave 2026-09-01: "Go with pic 1. Apply that
              everywhere"). The 08-18 library form put bare rows on the
              page ground; every other list on Today wears a card, and this
              was the one that did not. Rows ride inside one grouped card
              now, hairlines inset past the check, the same material as
              Your Move. With grouping on, each group is its own card under
              its own head. */}
          <div className="sh2 sh2-quiet list-head">
            {/* The head names the cut and carries the group-by control.
                One tap opens the options in place (the app's one picker
                mechanic, ChipPicker's); the pick is the save. */}
            <span className="t">{FILTER_LABEL[filter]}</span>
            <span className="n">{items.length}</span>
            <GroupPicker value={groupBy} onPick={setGroup} />
          </div>
          {groups.map((g) => (
            <React.Fragment key={g.key}>
              {g.head && (
                <div className="grp-head">
                  {g.color && <span className={"cat-dot cat-bg-" + g.color} />}
                  {g.head}
                  <span className="n">{g.items.length}</span>
                </div>
              )}
              <div className="card list-card-ruled">
                {g.items.map((it) => (
                  <React.Fragment key={it.id}>
                    <Row
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
