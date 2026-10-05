import React, { useEffect, useRef, useState } from "react";
import EntityStar, { useRemember } from "../../shared/EntityStar";
import PageHeader, { BarAction, BarText } from "../../shared/PageHeader";
import LifeHeader, { OptionsButton, type HeaderView } from "../../shared/LifeHeader";
import OptionsSheet, { type OptionRow } from "../../shared/OptionsSheet";
import { useSelection } from "../../shared/useSelection";
import SelectBar from "../../shared/SelectBar";
import { Trash2, Clock, ListChecks, Check, Zap, Forward } from "../../shared/icons";
import SkeletonRows from "../../shared/SkeletonRows";
import { Burst } from "../../shared/Burst";
import type { BurstSize } from "../../shared/completion";
import type { TaskItem } from "../TasksService";
import { urgencyFor, distanceFor, todayISO, type UrgencyKind } from "../grouping";
import { FILTERS, FILTER_LABEL, type TaskFilter } from "../filters";
import { categoriesOf } from "../categories";
import { catColor, catName } from "../../shared/categories";
import type { SheetCategory, SheetProject } from "./TaskSheet";
import { useSwipe } from "../../shared/useSwipe";
import type { RowAction } from "../../shared/RowActionSheet";
import RowCtxAction from "../../shared/RowCtxAction";
import { taskVerb, isStartVerb, type TaskVerb } from "../rowVerb";
import Provenance from "../../shared/ProvenanceLine";
import { rowSource, type Source, type SourceType } from "../../shared/provenance";
import { lineCase, titleCase } from "../../shared/casing";
import { cueLine } from "../ifThen";
import { durLabel } from "../../schedule/durations";
import { OVERWHELM_ENTER, OVERWHELM_EXIT } from "../overwhelmed";
import InlineEdit from "../../shared/InlineEdit";
import HeadMenu from "../../shared/HeadMenu";
import { useRowMenu } from "../../shared/useRowMenu";
import { ParentLineGlyph, EnvelopeGlyph } from "../../shared/glyphs";
import StepCount, { stepsOf, hasUnfinishedSteps } from "../../shared/StepCount";
import { Nums } from "../../bigger/GoalRowRuled";
import { parentForTask, type ParentLine, type ParentIndex } from "../../life/parent";
import { originLabel } from "../origin";

// Tasks page. Two-line rows with a large (44pt) completion target on the left
// and swipe-left-to-delete, so completing or removing a task is one easy action.

const URGENCY_CLASS: Record<UrgencyKind, string> = {
  overdue: "urgency-red",
  today: "urgency-warn",
  soon: "urgency-muted",
};

// The word the origin mark draws (originLabel) for each source type that
// can draw one. A row's provenance repeats the mark only when its type maps
// to the SAME word here; any other type is a different fact.
const ORIGIN_OF: Partial<Record<SourceType, string>> = {
  email: "Email",
  note: "Note",
  paste: "Smart Paste",
  recorder: "Recording",
  chat: "Chat",
  file: "File",
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
      put(id || "none", catName(id) || "No Category", it, id ? catColor(id) : undefined);
    } else if (by === "goal") {
      const g = goalOf?.(it) ?? null;
      put(g ? "g:" + g : "none", g ? titleCase(g) : "No Goal", it);
    } else {
      const d = t.done ? null : distanceFor(t, today);
      const key = d ? d.kind : t.due ? "later" : "undated";
      put(key, { today: "Today", late: "Overdue", later: "Later", undated: "No Date" }[key] ?? key, it);
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
  all: "No Tasks Yet",
  daily: "No Dailies Yet",
  today: "Nothing Due Today",
  overdue: "Nothing Overdue",
  upcoming: "Nothing Coming Up",
  email: "Nothing from Email",
  done: "Nothing Completed Yet",
};

// The second line exists ONLY when it carries information the user cannot
// already see. "Add one above and I will keep track of it", "Finished tasks
// collect here", "Tasks with a future date land here" are all directions, and
// the app does not ship permanent helper text. The single case that earns a
// line is an empty Today sitting on top of overdue work, because the screen
// otherwise reads as "you are done" when the opposite is true.
function emptySub(filter: TaskFilter, counts: Record<TaskFilter, number>): string | null {
  if (filter === "today" && counts.overdue > 0) {
    return lineCase(`${counts.overdue} overdue waiting`);
  }
  return null;
}

// THE CHIP ROWS ARE GONE (Fewer Buttons, Dave 2026-09-02). The 08-29 audit's
// scrolling row (measured overflow, the geometric "more" mark) went with
// them; the menus on the list head carry every filter and every count the
// chips did, and a menu never overflows sideways. The laws keep the record.

// A task's area as a parent line, for a row whose caller passed none. No
// projects and no events in the index, so parentForTask answers with the
// area alone. The first NAMED area leads, so a primary deleted out from
// under a task does not blank the line while a second area still has a name.
const NO_PARENTS: ParentIndex = { projects: new Map(), events: new Map() };
function areaLine(item: TaskItem, except?: string): ParentLine | null {
  const first = categoriesOf(item.data).find((id) => id !== except && catName(id));
  return first ? parentForTask(NO_PARENTS, { ...item, data: { ...item.data, category: first } }) : null;
}

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
  startLabel,
  selecting = false,
  picked = false,
  onPick,
  muteToday = false,
  parent: callerParent = null,
  inArea,
  kicker = null,
  kickerTone = null,
  tag = null,
  action = null,
  lowPriority = false,
  onFirstStep,
  burstSize = "small",
  openSourceFor,
  person = null,
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
  startLabel?: (id: string) => "Start" | "Resume" | "Unblock";
  // THE RULED ROW (2026-09-01, 2026-09-02): the second line says where this task
  // moves. Null when it moves none; the row then says the category, so
  // every row keeps two lines and a fact. Derived by the flow from one
  // goal index, the same one Today reads, so the two pages cannot disagree.
  parent?: ParentLine | null;
  // THE PAGE'S OWN AREA SAYS NOTHING (2026-10-05, the round-2 review: "Book PG 17U Travel" over "Family" on the Family
  // page, a line that repeats its screen's name). A row listed on an area's page leaves that area off its second line when it
  // has no project or event of its own; another area it also carries is new information and still shows.
  inArea?: string;
  // A caller's own second line (a reminder's time on the Health page),
  // in place of the parent or category words. Unless it is stalled it is
  // drawn as a neutral time, in small caps.
  kicker?: string | null;
  // The kicker in the warning ink: the line is a fact about the task
  // stalling, not where it lives (the First Step offer, 2026-09-02).
  kickerTone?: "stalled" | null;
  /** THE VERDICT AS A CHIP (Dave 2026-09-11). "Keeps Sliding" is something
   *  the app CONCLUDED; the kicker under it is the count it concluded from.
   *  Two kinds of fact, so two weights: the chip leads, the count follows. */
  tag?: string | null;
  // A caller's own verb in place of the state-derived one (Drop on the Health
  // page's Up Next). It is the swipe-left, the tray's first button and, once the
  // row is overdue, the one quiet word on the row: never a pill (Dave
  // 2026-10-05, "Clean rows, no pills anywhere").
  action?: { label: string; onClick: () => void } | null;
  /** LOW PRIORITY OR PARKED (the task that keeps sliding): its quickest verb is
   *  Move, and the First Step it used to wear as a pill is in its sheet and its
   *  menu. */
  lowPriority?: boolean;
  /** First Step, for the row's menu. The sheet holds it too. Absent when the flow
   *  has no AI to draft one. */
  onFirstStep?: (id: string) => void;
  // SHARED-F-16 (2026-09-05): how loud this row's tick should be. Ticking the
  // last task of a six-month project used to burst exactly like ticking "buy
  // milk", because the flow only learned what the tick moved AFTER the row
  // had already burst. The flow can see it beforehand from data it already
  // holds, so the answer arrives with the row.
  burstSize?: BurstSize;
  // SHARED-F-17 (2026-09-05): a handler for this row's source, or undefined
  // when the flow has no route to it. Undefined leaves the line a fact.
  openSourceFor?: (source: Source) => (() => void) | undefined;
  // UP-CORE-17 (2026-09-05): who this task is about, when it names someone.
  // Tapping opens the Call Prep card, the app's one person card by law.
  person?: { name: string; onOpen?: () => void } | null;
}) {
  const t = item.data;
  // WHERE IT LIVES, EVEN WHEN THE CALLER DID NOT SAY (§AM, 2026-09-26). A
  // caller with no parent index (Money's Also Tagged list) left the row to
  // join every area name with a baked middle dot in one grey run, with no
  // dot to mark it as an area. The row now draws the area the way every
  // other row does, its dot ahead of its name, through the same parentForTask
  // the flows use.
  const parent = callerParent ?? areaLine(item, inArea);
  const u = urgencyFor(t, today);
  const prov = rowSource(t.source, t.moved);
  // ONE WHERE-IT-CAME-FROM PER ROW (§AK, 2026-09-26). When nothing ahead of
  // it claims the second line's slot, the origin mark draws the envelope and
  // "Email" there, and the compact provenance at the end of the line then said
  // the same thing again as "From an email". The mark keeps it, but only when
  // the two really are one fact: provenance must name the SAME origin the mark
  // drew (a Smart Paste task titled "Get back to Sam" draws "Email", and "From
  // Smart Paste" is a different fact), and it must not be a door. The mark is
  // a plain span; an openable provenance is the row's one tap onto the thread,
  // so it stays. A move made today is never in ORIGIN_OF, so it stays too.
  const originDrawn = !(kicker || tag) && !parent
    && categoriesOf(t).map((id) => catName(id)).filter(Boolean).length === 0
    && !!originLabel(t);
  // Openable exactly as Provenance decides it: a handler AND a ref.
  const provOpenable = !!(prov?.ref && openSourceFor && openSourceFor(prov));
  const provRepeatsOrigin = originDrawn && !!prov
    && ORIGIN_OF[prov.type] === originLabel(t) && !provOpenable;
  // The distance chip: TODAY, 2 DAYS LATE, 3 WEEKS LATE, OVER A MONTH.
  // Same ladder as Today's dealt row (distanceFor). Muted on the Today
  // filter, where every row would say the same word.
  const dist = distanceFor(t, today);
  const chip = dist && !t.done && !(muteToday && dist.kind === "today") ? dist : null;
  // TRACE-02b (2026-09-07): the checklist rollup, display only, counted by
  // the one shared piece Today's rows already use.
  const steps = stepsOf(t);
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
  const tapCheck = () => {
    if (pendingDone.current) return;
    if (t.done) { onToggle?.(item.id); return; } // un-completing: no ceremony
    pendingDone.current = true;
    setLocalDone(true);
    setBurst(true);
    setTimeout(() => setBurst(false), 650);
    setTimeout(() => { pendingDone.current = false; setLocalDone(false); onToggle?.(item.id); }, 600);
  };

  // UP-CORE-15 (2026-09-05): SWIPE RIGHT COMPLETES. A whole-row gesture beats
  // a 24-point checkbox for a thumb on a moving bus, and the clamp in
  // useSwipe meant no right swipe existed on any list in the app. It fires
  // the row's own tick, so the burst, the optimistic flip and the Undo are
  // the ones the checkbox already had. An open row is closing, not
  // completing; a done row has nothing to complete.
  const completable = !t.done && !!onToggle && !selecting;

  // THE ROW'S ONE VERB (Dave 2026-10-05, locked; rowVerb.ts). No pill: the
  // verb is the swipe-left, the tray's first button, the long-press menu's
  // first line and, once the row is overdue, the one quiet word on the row.
  // A caller's own `action` replaces the one the state would pick.
  const startState = startLabel?.(item.id);
  const derived: TaskVerb | null = selecting ? null : taskVerb(t, { canStart: !!onStart, canMove: snoozable, canDone: completable, startLabel: startState, lowPriority });
  const verb: string | null = selecting || t.done ? null : action ? action.label : derived;
  const runVerb = () => {
    if (action) { action.onClick(); return; }
    if (derived === "Start" || derived === "Unblock") onStart?.(item.id);
    else if (derived === "Move") onSnooze?.(item.id);
    else tapCheck();
  };
  // The tray, from the edge: the verb, then Tomorrow (unless the verb IS the move), then Delete.
  const showTomorrow = snoozable && derived !== "Move";
  const slots = (verb ? 1 : 0) + (showTomorrow ? 1 : 0) + 1;
  // Rename is a mode the row enters deliberately: it is a line in the long-press
  // menu now, not a gesture of its own. .renaming lifts the row while it is open
  // so the mode is visible rather than silent.
  const [renaming, setRenaming] = useState(false);
  // THE LONG PRESS IS THE CONTEXT MENU (Dave 2026-10-05): every action again, for
  // the person who knows to hold, and never the only way to anything essential.
  // shared/useRowMenu owns the sheet; useSwipe's hold opens it instead of the tray.
  const title = titleCase(t.text);
  // REMEMBER IS A LINE IN THE MENU, AND A STAR ONLY WHILE IT IS TRUE (2026-10-05, the perfect bar): an empty outline star on every
  // row spent a column of the row's width (about 100px with the ring) and 44px of tap area it did not have, so titles wrapped to an
  // orphan word. The filled star still marks a remembered task, in the gutter; the long press offers Remember and Forget.
  const remember = useRemember("task", item.id, title);
  const menuActions: RowAction[] = [
    ...(verb ? [{ label: verb, onPick: runVerb }] : []),
    ...(onStart && !t.done && !t.bill && !(derived && isStartVerb(derived)) && !action ? [{ label: startState === "Unblock" ? "Unblock" : "Start", onPick: () => onStart(item.id) }] : []),
    ...(onFirstStep && !t.done && !t.bill ? [{ label: "First Step", onPick: () => onFirstStep(item.id) }] : []),
    ...(completable && verb !== "Done" && verb !== "Wrap Up" && verb !== "Mark Paid" ? [{ label: t.bill ? "Mark Paid" : "Done", onPick: tapCheck }] : []),
    ...(t.done && onToggle && !selecting ? [{ label: "Mark Not Done", onPick: () => onToggle(item.id) }] : []),
    ...(showTomorrow ? [{ label: "Move to Tomorrow", onPick: () => onSnooze?.(item.id) }] : []),
    ...(onRename && !t.done ? [{ label: "Rename", onPick: () => setRenaming(true) }] : []),
    ...(remember && !selecting ? [{ label: remember.on ? "Forget" : "Remember", onPick: () => void remember.run() }] : []),
    ...(onDelete ? [{ label: "Delete", destructive: true, onPick: () => onDelete(item.id) }] : []),
  ];
  const rowMenu = useRowMenu({ title, actions: menuActions, enabled: !selecting && !renaming });
  const swipe = useSwipe({
    revealW: slots * 88,
    rightW: completable ? 88 : 0,
    ...(completable ? { onRightCommit: tapCheck } : {}),
    onLongPress: rowMenu.onLongPress,
  });
  const { dx, dragging, open: swipeOpen, closeThen } = swipe;
  const { handlers: rowHandlers, sheet: menuSheet } = rowMenu.bind(swipe);

  useEffect(() => {
    if (t.done && !prevDone.current) {
      setBurst(true);
      const id = setTimeout(() => setBurst(false), 650);
      prevDone.current = t.done;
      return () => clearTimeout(id);
    }
    prevDone.current = t.done;
  }, [t.done]);

  const verbIcon = derived === "Start" || derived === "Unblock" ? <Zap className="ic" /> : derived === "Move" ? <Forward className="ic" /> : <Check className="ic" />;

  return (
    <div className="task-swipe">
      {/* UP-CORE-15: the leading rail, seen only while the finger is moving. */}
      {completable && (
        <div className="task-done-rail" aria-hidden="true">
          <Check className="ic" />
          <span className="swipe-label">Done</span>
        </div>
      )}
      {/* THE TRAY, FROM THE EDGE (Dave 2026-10-05): the row's one verb, then
          Tomorrow, then Delete. B13 (2026-08-23): every button says its name; the
          reveal is 88px a button. Each one names the record, as the Delete always
          has (VoiceOver sweep, 2026-09-21). */}
      {verb && (
        <button className="task-verb" onClick={() => closeThen(runVerb)} aria-label={verb + " " + title}>
          {verbIcon}
          <span className="swipe-label">{verb}</span>
        </button>
      )}
      {showTomorrow && (
        <button className="task-snooze" style={verb ? undefined : { right: 0 }} onClick={() => onSnooze?.(item.id)} aria-label="Move to tomorrow">
          <Clock className="ic" />
          <span className="swipe-label">Tomorrow</span>
        </button>
      )}
      <button className="task-del" style={slots > 1 ? { right: (slots - 1) * 88 } : undefined} onClick={() => onDelete?.(item.id)} aria-label={"Delete " + title}>
        <Trash2 className="ic" />
        <span className="swipe-label">Delete</span>
      </button>
      <div
        className={"task-row" + (renaming ? " renaming" : "") + (t.done ? " completed" : "") + (burst ? " just-done" : "") + (dragging ? " swiping" : "")}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        {...rowHandlers}
        // THE WHOLE ROW IS THE DOOR (Dave 2026-09-15: "I want all rows
        // clickable"; 2026-10-05: it opens the task's sheet, which holds every
        // action). The ring, the star and the person each stop their own tap.
        // A tap on a row whose tray is showing closes it instead of opening
        // the task.
        role="button"
        tabIndex={0}
        onClick={() => {
          if (swipeOpen || dx) { closeThen(); return; }
          if (selecting) onPick?.(item.id); else onOpen?.(item.id);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          if (selecting) onPick?.(item.id); else onOpen?.(item.id);
        }}
      >
        {/* C-50 (Astra, 2026-09-12): the Remember star leads the row. */}
        {!selecting && <EntityStar entityType="task" entityId={item.id} title={title} quiet />}
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
            aria-label={picked ? "Deselect " + title : "Select " + title}
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
            <Burst show={burst} size={burstSize} />
          </div>
        )}
        <div className="task-title">
          {/* THE TAP OPENS THE SHEET. RENAME IS A LINE IN THE LONG-PRESS MENU
              (Dave 2026-08-24: "it's WAY more important that I can easily click
              and edit the tasks"; 2026-10-05: the long press is the menu). The
              title is SHOWN in Title Case, whatever was typed. */}
          {renaming && onRename && !t.done ? (
            <div onClick={(ev) => ev.stopPropagation()}>
              <InlineEdit
                className="task-name"
                value={t.text}
                display={titleCase}
                focused
                onSave={(v) => {
                  setRenaming(false);
                  const next = v.trim();
                  if (next && next !== t.text && next !== title) onRename(item.id, titleCase(next));
                }}
              />
            </div>
          ) : (
            <span className="task-name">{title}</span>
          )}
          {/* THE RULED ROW'S SECOND LINE (Dave 2026-09-01, "Together" catalog;
              The Row and Health, 2026-09-02). Chip first, so it sits at one
              x whenever it appears. Then where the task lives: the parent's
              own glyph in its category colour (the project's pie, the goal's
              target, the category dot) and the parent's full name in one
              quiet grey. The vertical bar is gone; the glyph is the colour.
              The old caps eyebrow, the urgency chip that sat beside it, and
              the row-tags line they shared are gone; this line is all three. */}
          {/* DEFECT 6 (Dave 2026-09-06, on his phone: "tasks have too much
              grey when you add info like time and people. Think of another way
              to render that info so it all doesn't blend in").

              UP-CORE-17's person and UP-CORE-02's estimate landed on this line
              on 2026-09-05 as two more `.r-goal.r-cat` spans glued on with
              middle dots. Measured the next morning: four word spans, every
              one of them rgba(235,235,245,0.6) at weight 400.

              The dots are gone and each fact wears the treatment its KIND
              earns (ruled.css carries the reasoning): where it lives keeps the
              most ink, a person is a name and a door, an estimate is a number
              and takes the ruled inline number emphasis through Nums, and a
              recurrence is a rule rather than an instance of one, so it is the
              quietest. They are also in the order they hand the line back when
              there is not room for all of them, which is DEFECT 1 below.

              DEFECT 1 (Dave, the same morning: "There's wrapping in the tasks
              pills"). BROWSER-F-06 had given this line flex-wrap on 2026-09-05
              and the person and the estimate then made it fire on every row
              that carried them: the second line measured 88.75px over FOUR
              visual lines and the row 129.55px, where the contract rules two
              lines and a density of 44, 56 or 64. `.r-k-one` holds it to one
              line box (ruled.css), so a fact that no longer fits leaves the
              line whole instead of taking a row of its own. */}
          <div className="r-k r-k-one">
            {/* THE DISTANCE IS TEXT ON EVERY TASK ROW (Dave 2026-10-05, D10: no filled chip or capsule inside a list row).
                Today is the key's amber and a late one the key's red, in the row's own type with no fill, so the same word
                reads the same on the Tasks list, an area page and Money's Also Tagged. */}
            {chip && <span className={"r-goal fact " + (chip.kind === "late" ? "red" : "warn")}>{lineCase(chip.label.toLowerCase())}</span>}
            {/* E-31 (2026-09-12): a day he named in his own reply that the
                catcher could not resolve. A proposal in the chip's slot, in
                quiet ink, never a deadline; a real due date replaces it. */}
            {!chip && !t.done && t.proposedDate && <span className="uchip u-proposed">{lineCase(`${t.proposedDate} (proposed)`)}</span>}
            {(kicker || tag)
              ? <>
                  {tag && <span className="slide-tag">{tag}</span>}
                  {/* A stalled kicker is a count in the warning ink. Any other
                      kicker is a reminder's clock time (the Health page), a
                      neutral time, so it is small caps like every neutral
                      time on a row (§AM F5), not the line's grey words. */}
                  {kicker && <span className={kickerTone === "stalled" ? "r-goal r-cat r-stalled" : "fact date"}>{kicker}</span>}
                </>
              : parent
              ? <ParentLineGlyph p={parent} />
              : originLabel(t)
              /* WHERE IT CAME FROM WEARS A MARK (§AK, 2026-09-21, Dave's
                 Anytime screenshot: "Email" in bare grey under one task and
                 a dotted category under the next). An origin is a parent of
                 sorts -- the email, the note, the paste it was lifted
                 from -- so it takes the parent line's shape: a wordless
                 mark ahead of plain words, the same as a category's dot. */
              ? <span className="r-goal r-parent r-parent-plain">
                  <span className="r-pg"><EnvelopeGlyph className="r-gm" /></span>
                  <span className="r-goal-t">{originLabel(t)}</span>
                </span>
              : null}
            {/* A1: the cue, where he will see it while scanning. The whole
                sentence is on the sheet; the row carries the trigger, which
                is the half that has to be recognisable in the moment.

                DEFECT 1, THE HALF THAT WAS MISSED (Dave 2026-09-09, on his
                phone, photographing "Submit job apps" over "Personal" over
                "3:30 PM": "It shouldn't be 3 lines"). DEFECT 1 clamped .r-k
                to one line box on 2026-09-06 and stopped there, but the cue
                was never ON .r-k -- it was a block-level div rendered AFTER
                it, so every task carrying a plan was a third line no clamp
                could see. Contract 4.1 rules it in as many words: "Two
                lines, always: no third line."
                It goes second on the line, ahead of the person and the
                estimate, because the cue is the one fact on this row that
                says WHEN the thing happens, and a trigger he cannot see
                while scanning is a plan he does not keep. Category first
                still: where a task lives is what he sorts by. Everything
                after it yields in the order it already did, and an item that
                no longer fits leaves the line whole rather than clipped --
                the mechanism DEFECT 1 built. */}
            {t.plan && <span className="r-goal r-cue">{cueLine(t.plan)}</span>}
            {/* UP-CORE-17 (2026-09-05): the person this is about, and the
                door to their card. */}
            {person && (person.onOpen
              ? <span className="r-goal r-person" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); person.onOpen!(); }}>{person.name}</span>
              : <span className="r-goal r-person">{person.name}</span>)}
            {/* UP-CORE-02 (2026-09-05): how long he said this one takes,
                where he is deciding what to pick up. A fact, only when set. */}
            {t.estimateMin ? <span className="r-goal r-est"><Nums text={durLabel(t.estimateMin)} /></span> : null}
            {t.recurrence && <span className="r-goal r-rec">{lineCase(t.recurrence)}</span>}
            {/* Provenance Line (addendum item 8): auto-created rows say where
                they came from; hand-made rows render nothing here. */}
            {/* SHARED-F-17 (2026-09-05): "From an email · Aug 12" was a plain
                line everywhere, although the entity carries source.ref and the
                app has a route for the types it names. openSourceFor hands
                back a handler only for a source this flow can actually reach,
                so a line that cannot be opened stays a plain fact instead of
                becoming a button that does nothing. */}
            {/* UP-CORE-05 (2026-09-05): a task Auto-Sweep pulled to today says
                so, for the day, above where it came from. A date that changed
                overnight with nothing explaining it is the "did I do that?"
                moment this line exists to end (rowSource picks which fact). */}
            {/* AND IT WAS THE OTHER THIRD LINE (2026-09-09). The cue moved onto
                this line the same day; this was the second block-level div
                sitting under .r-k, so an auto-created task with a category was
                three lines for exactly the same reason, and contract 4.1 does
                not have an exception for provenance.
                It goes LAST, which is the honest ranking of it: where a row
                came from matters less than where it lives, when it happens,
                who it is about, how long it takes and whether it repeats. Last
                also means it is the first thing to leave when the line runs
                out, whole rather than clipped -- and the full line, with its
                own tap and its own 44px target, is on the sheet one tap away,
                where it has always been. */}
            {!provRepeatsOrigin && <Provenance compact source={prov} {...(prov && openSourceFor ? { onOpen: openSourceFor(prov) } : {})} />}
          </div>
        </div>
        {/* NO PILL ON A ROW (Dave 2026-10-05). The slot holds, in order of
            claim: the row's verb as one quiet word once its moment has come (it
            is overdue; the same verb as the swipe), then the count of a task
            already underway ("2 of 5": information, not an action; a fully
            ticked list is not underway, hasUnfinishedSteps carries the
            reasoning), then, for a caller with no Start, the urgency label
            (never beside a verb: it is the same fact the chip above says). Done
            is the check on the left, so it is never surfaced as words. */}
        {selecting ? null : (
          <>
            <RowCtxAction when={!!verb && verb !== "Done" && !shownDone && dist?.kind === "late"} label={verb ?? ""} ariaLabel={verb + " " + title} onAct={runVerb} />
            {!shownDone && hasUnfinishedSteps(steps)
              ? <StepCount {...steps} />
              : !onStart && u && u.kind === "soon" && <span className={"urgency " + URGENCY_CLASS[u.kind]}>{u.label}</span>}
          </>
        )}
      </div>
      {menuSheet}
    </div>
  );
}

// MOMENTUM CHAIN, THE ROW ITSELF (Dave 2026-09-16, on a screenshot of
// "Brainstorm for Jos..." with Start and Not Now floating loose at narrow
// widths: "It offers no value and is an eye sore/inconvenience... I can't
// even clear it when it's like this or swipe").
//
// The old row was bespoke markup carrying two always-visible pills wedged
// into one trailing slot, a shape no other row here uses. The suggestion
// names a REAL task, the same one Not Now already acted on, so it gets that
// task's own row: the check, the swipe, the open. Dave 2026-10-05 ("Clean
// rows, no pills anywhere"): the last pill is gone too. Start and Not Now
// are the swipe-left tray, the whole row's tap starts it, and swipe right
// completes it.
export function MomentumRow({
  task, reason, today = todayISO(), onOpen, onToggle, onStart, onNotNow,
}: {
  task: TaskItem;
  /** chainReason's line ("Same category"), or null when the suggestion is
   *  not from the finished task's area. The due half is not in it: the row
   *  reads that off the task as the distance chip. */
  reason: string | null;
  /** The day the due chip is measured against; the flow's own today when
   *  it passes one. */
  today?: string;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onStart: (id: string) => void;
  /** Quiets the chain for the day (momentum.ts's dismissChain) and drops
   *  the offer. Reused as-is; a suggestion is deferred, never deleted. */
  onNotNow: () => void;
}) {
  // THE SUGGESTION IS A READY TASK (Dave 2026-10-05): swipe left is Start, the
  // quickest verb, with Not Now beside it; swipe right completes. The Start pill
  // that sat on this row is gone, and so is the second reading of it: the tap
  // starts it too.
  const title = titleCase(task.data.text);
  // THE LONG PRESS IS THE CONTEXT MENU (Dave 2026-10-05): the same three lines the tray and the right swipe hold.
  const rowMenu = useRowMenu({ title, actions: [
    { label: "Start", onPick: () => onStart(task.id) },
    { label: "Done", onPick: () => onToggle(task.id) },
    { label: "Not Now", onPick: onNotNow },
  ] });
  const swipe = useSwipe({
    revealW: 176,
    rightW: 88,
    onRightCommit: () => onToggle(task.id),
    onLongPress: rowMenu.onLongPress,
  });
  const { dx, dragging, open: swipeOpen, closeThen } = swipe;
  const { handlers, sheet: menuSheet } = rowMenu.bind(swipe);
  const due = distanceFor(task.data, today);
  const sameArea = !!reason && /^same (category|area)/i.test(reason);
  return (
    <div className="task-swipe">
      {/* THE LEADING RAIL, seen only while the finger is moving right. */}
      <div className="task-done-rail" aria-hidden="true">
        <Check className="ic" />
        <span className="swipe-label">Done</span>
      </div>
      <button className="task-verb" onClick={() => closeThen(() => onStart(task.id))} aria-label={"Start " + title}>
        <Zap className="ic" />
        <span className="swipe-label">Start</span>
      </button>
      {/* 2026-10-04: the OUTER slot, as the nudge row's Dismiss. With Start
          beside it the reveal is two buttons wide, so the stylesheet steps this
          one in to the second slot (.task-verb ~ .task-snooze-solo): it is
          never under the row. */}
      <button className="task-snooze task-snooze-solo" onClick={() => closeThen(onNotNow)} aria-label="Not now">
        <Clock className="ic" />
        <span className="swipe-label">Not Now</span>
      </button>
      <div
        className={"task-row momentum-row" + (dragging ? " swiping" : "")}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        {...handlers}
        role="button"
        tabIndex={0}
        // THE WHOLE ROW STARTS IT (Dave's pass-off, 2026-09-26: "make it
        // real"). A suggestion is an offer to keep going, so the row does
        // what its swipe-left does: it starts the task. The task's own row
        // is not on the list below while this one shows (TasksPage hides
        // it), so the suggestion is the one place it lives.
        aria-label={"Start " + title}
        onClick={() => { if (swipeOpen || dx) { closeThen(); return; } onStart(task.id); }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          onStart(task.id);
        }}
      >
        {/* The Remember star marks this row only while it is remembered, in the gutter, as it does on every TaskRow (C-50;
            2026-10-05), so the check and the title sit in the list's columns either way. */}
        <EntityStar entityType="task" entityId={task.id} title={task.data.text} quiet />
        <div
          className="task-check-tap"
          onClick={(e) => { e.stopPropagation(); onToggle(task.id); }}
          role="checkbox"
          aria-checked={false}
          aria-label="Mark done"
        >
          <div className="task-check" />
        </div>
        <div className="task-title">
          <span className="task-name">{title}</span>
          <div className="r-k r-k-one">
            {/* DUE AND LATE WEAR THE KEY (§AM, 2026-09-26). The reason
                said "due today" or "overdue" in the line's plain grey, a
                meaning with no colour. The due half is now the distance chip
                every task row wears (TODAY amber, N DAYS LATE red), read off
                the task itself, and the reason keeps only the fact with no
                meaning of its own, the shared area, as the line's one grey. */}
            {due && <span className={"r-goal fact " + (due.kind === "late" ? "red" : "warn")}>{lineCase(due.label.toLowerCase())}</span>}
            {/* THE VERDICT AS A CHIP, the same vocabulary the stalled row's
                "Keeps Sliding" already uses: the app concluded this, the
                reason line under it is the count it concluded from. */}
            <span className="slide-tag">Keep Going</span>
            {sameArea && <span className="r-goal r-cat">Same Area</span>}
          </div>
        </div>
      </div>
      {menuSheet}
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
  onFirstStepTask,
  startLabel,
  startCard,
  onNew,
  onUpload,
  onRenameTask,
  onClearDone,
  categories,
  catFilter,
  onCatFilter,
  notice,
  stalled = null,
  momentum,
  onPickOne,
  onJustThisOne,
  onCalm,
  overwhelmed = false,
  onMoveAllToToday,
  onDeleteMany,
  onDoneMany,
  projects,
  onMoveMany,
  goalOf,
  parentOf,
  burstSizeOf,
  openSourceFor,
  personFor,
  title = "Tasks",
  segments,
  query = "",
  onQuery,
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
  /** First Step, for a row's long-press menu (the sheet holds it too). Absent without AI. */
  onFirstStepTask?: (id: string) => void;
  startLabel?: (id: string) => "Start" | "Resume" | "Unblock";
  /** A Place to Begin, built by the flow that has the services. */
  startCard?: React.ReactNode;
  onNew?: () => void;
  // UP-CORE-12 (2026-09-05): read a syllabus (or any dated handout) into
  // tasks and events. Absent when the flow has no AI, so the door never
  // promises a read it cannot do.
  onUpload?: () => void;
  onRenameTask?: (id: string, text: string) => void;
  onClearDone?: () => void;
  categories?: SheetCategory[];
  catFilter?: string;
  onCatFilter?: (id: string) => void;
  // THE NOTICE ROW (Fewer Buttons, 2026-09-02): the one offer the flow has
  // for this list (the task that keeps sliding), rendered as the first row
  // of the first card, never as a card floating above the list.
  notice?: React.ReactNode;
  // THE TASK THAT KEEPS SLIDING IS ONE ROW (Dave 2026-09-02: "'email
  // Danielle' shows up twice, kill the bug"). The First Step offer used to
  // be a notice row above the list while the task itself sat in it, so
  // the stalled task appeared twice. Now the offer is the task's OWN row,
  // pulled to the top of the first card: the sliding line in the warning
  // ink where the parent would be, First Step in place of Start, and the
  // check, swipe and open it always had. Nothing to dismiss; the row costs
  // no space the task was not already taking.
  stalled?: { id: string; tag: string; line: string | null } | null;
  // Momentum Chain: a suggestion element pinned under the row it follows.
  // `taskId` is the task the suggestion names; while the suggestion shows,
  // that task's own row is left out of the list (Dave's pass-off,
  // 2026-09-26: "nothing appears twice").
  momentum?: { afterId: string; taskId?: string; el: React.ReactNode } | null;
  // The goal a task moves, from the flow's goal index (see Row.goal).
  // Group-by Goal reads the goal a task moves, by title, so the heads read
  // as goals. The row itself reads parentOf (2026-09-02).
  goalOf?: (t: TaskItem) => string | null;
  parentOf?: (t: TaskItem) => ParentLine | null;
  // SHARED-F-16 (2026-09-05): whether ticking this row would clear the last
  // task of its project, answered before the tick so the burst can escalate
  // with the moment. Derived by the flow through shared/completion's
  // burstSize, which is the one place that judgement lives.
  burstSizeOf?: (t: TaskItem) => BurstSize;
  // SHARED-F-17 (2026-09-05): given a row's source, the way to open it, or
  // undefined for a source this flow cannot route. The page never decides
  // what a source type means; it only asks.
  openSourceFor?: (source: Source) => (() => void) | undefined;
  // UP-CORE-17 (2026-09-05): the contact a task names, and the way to open
  // their card. Resolved by the flow, which holds the people list.
  personFor?: (t: TaskItem) => { name: string; onOpen?: () => void } | null;
  // LIFE (2026-09-01): the head's word and the segment control under it,
  // when this page is the Tasks lens of the Life tab.
  title?: string;
  segments?: React.ReactNode;
  /** THE SHARED HEADER'S SEARCH (Dave 2026-09-17, Unified Headers). Tasks had
   *  no search at all: the only way to find a task by name was to read the
   *  list. The query is the caller's state so it survives opening a task and
   *  coming back (handoff rule 4), and the page filters what it was given
   *  rather than asking the service for a second list. */
  query?: string;
  onQuery?: (q: string) => void;
  // THE DECISION KILLERS (Dave 2026-08-19, ADHD round). Pick One opens the
  // single best task for right now so the list never has to be read; Move
  // All resets an overdue pile in one tap instead of one tap per shame.
  onPickOne?: () => void;
  /** Collapses the list to the one task, from this list's own options. */
  onJustThisOne?: () => void;
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
  // S6-Q39 (2026-09-05): bulk-file a selection into a project, the way an
  // existing backlog actually gets organised -- in one sitting rather than
  // one task at a time. Absent (and the control hidden) when there are no
  // projects to file into, same rule TaskSheet's own Project row already
  // follows.
  projects?: SheetProject[];
  onMoveMany?: (ids: string[], projectId: string) => void;
}) {
  // Select mode owns the ids currently ON SCREEN, so a filter change or a
  // reload can never leave a selection pointing at rows that are gone.
  // WHAT THE HEADER'S SEARCH LEAVES (handoff rule 4: "Search supported
  // title/body fields. If attachment content is not indexed, do not imply it
  // was searched"). A task's text is what a task has, so that is what this
  // searches, and the scope line below says so rather than implying more.
  const q = query.trim().toLowerCase();
  // ONCE, NOT TWICE (Dave's pass-off, 2026-09-26). The Keep Going row IS
  // the suggested task's row, so the same task is not also drawn below it.
  const suggested = momentum?.taskId ?? null;
  const listed = suggested ? items.filter((it) => it.id !== suggested) : items;
  const shown = q ? listed.filter((it) => it.data.text.toLowerCase().includes(q)) : listed;
  const sel = useSelection(shown.map((i) => i.id));
  /** EVERY VIEW, IN ONE MENU, WITH ITS COUNT (Dave 2026-09-18: "If you drop
   *  down, make the chips drop down so everything is on one row directly
   *  across").
   *
   *  The handoff's four led a chip row; Overdue, Daily and From Email lived
   *  in the options sheet because the row could not hold seven, and Done
   *  came off it too when the Area control needed the line. A menu has no
   *  such budget: it shows one answer and hands the list to a panel. So all
   *  seven are back, in the handoff's order, each saying how many it holds --
   *  which the chips never did.
   *
   *  Rule 2 of the same handoff: "Preserve the existing definitions and do
   *  not reclassify data for visual consistency". Nothing here is redefined;
   *  they are the FILTERS this page has always had. */
  const views: HeaderView[] = FILTERS.map((f) => ({ key: f, label: FILTER_LABEL[f], count: counts[f] || undefined }));
  const [optsOpen, setOptsOpen] = useState(false);
  // GROUP BY (ruled 2026-09-01: "a group-by dropdown"). Remembered within
  // the session, reset on launch, like the segment.
  const [groupBy, setGroupBy] = useState<GroupBy>(lastGroupBy);
  const setGroup = (g: GroupBy) => { lastGroupBy = g; setGroupBy(g); };
  // The stalled task's own row leads the first card; in select mode it
  // stays where it sorts, a plain row like the rest.
  const stalledItem = stalled && !sel.active ? shown.find((it) => it.id === stalled.id) ?? null : null;
  const groups = groupItems(stalledItem ? shown.filter((it) => it.id !== stalledItem.id) : shown, groupBy, goalOf, today);
  // LIFE-F-09 (2026-09-05): the Keep Going slot was keyed to the row that was
  // just completed, and completing a task is exactly what takes that row out
  // of the list being looked at (filters.ts:37: a done task lives only in
  // parts.done). Off the Done filter the suggestion therefore never reached
  // the screen at all. When its row is gone it takes the first seat in the
  // first card, the one the stalled row already uses, so it cannot miss.
  const momentumHome = momentum && !shown.some((it) => it.id === momentum.afterId) ? momentum.el : null;
  const stalledRow = stalled && stalledItem ? (
    <TaskRow
      item={stalledItem} today={today} onToggle={onToggle} onOpen={onOpenTask}
      onDelete={onDeleteTask} onSnooze={onSnoozeTask} onRename={onRenameTask}
      onFirstStep={onFirstStepTask}
      muteToday={filter === "today"}
      tag={stalled.tag} kicker={stalled.line} kickerTone="stalled" lowPriority
    />
  ) : null;
  return (
    <div className="screen ruled">
      {/* Select is a HEADER BUTTON, not a hidden long press. Dave asked for
          this to be easy, and a bulk action nobody can find is not easy: the
          long press is a shortcut for people who already know it exists, and
          the button is how they find out. Done replaces it while selecting,
          because the way out is the one control that must never move. */}
      <PageHeader
        title={title}
        actions={sel.active ? <BarText label="Done" strong onClick={sel.exit} /> : undefined}
        // THE SECONDARY TOOLS, IN ONE PLACE (handoff rule 7). Select, Upload
        // a Syllabus, Area and Group were two glyphs in the bar and three
        // capsules on a line; they are one control now, beside the title,
        // the same control on all five pages.
        // FOCUS LIVES IN THE HEAD, NOT AMONG THE CUTS (Dave 2026-10-05: no red slab among the chips). A quiet capsule in the key
        // colour beside the options control: the head holds two controls, Add and Focus, and Focus is an action, not a filter.
        headActions={sel.active ? undefined : (
          <>
            {onPickOne && counts.all > 0 && !overwhelmed && (
              <button type="button" className="tasks-focus" onClick={onPickOne}>
                <Zap className="ic" />Focus
              </button>
            )}
            <OptionsButton onClick={() => setOptsOpen(true)} label="Tasks Options" />
          </>
        )}
      >
        {/* ONE HEADER, FIVE PAGES (Dave 2026-09-17). The tabs, then search
            and a compact Add on one row, then one scrolling row of views.
            What was here: the tabs, and a line of three dropdown capsules
            whose first one hid every view behind a menu. */}
        <LifeHeader
          query={query}
          onQuery={(v) => onQuery?.(v)}
          placeholder="Search Tasks"
          addLabel="New Task"
          onAdd={() => onNew?.()}
          views={views}
          view={filter}
          onView={(k) => onFilter?.(k as TaskFilter)}
          scope={q ? {
            count: shown.length,
            where: `${FILTER_LABEL[filter]} Tasks`,
            ...(filter !== "all" ? { onAll: () => onFilter?.("all"), allLabel: "Search All Tasks" } : {}),
          } : undefined}
          // WHY THE ROWS YOU EXPECTED ARE NOT THERE (handoff rule 7). With no
          // control on the chip line, this line is what keeps an Area cut and
          // an off-row view from being invisible: it names them and clears
          // them in one tap. Nothing shows when nothing is filtering.
          // AREA AND GROUP, ON THE SAME LINE AS THE VIEW (Dave 2026-09-18:
          // "everything is on one row directly across"). The same two
          // HeadMenus the page has always had; each names its axis while
          // nothing is picked and states the answer once something is, so
          // the line itself says what is narrowing the list and no second
          // line has to.
          drops={(
            <>
              {categories && categories.length > 0 && (
                <HeadMenu
                  ariaLabel="Area"
                  value={!catFilter || catFilter === "all" ? "all" : catFilter}
                  label={!catFilter || catFilter === "all" ? "Area" : undefined}
                  options={[{ value: "all", label: "All Areas" }, ...categories.map((c) => ({ value: c.id, label: c.name, dot: c.color }))]}
                  onPick={(v) => onCatFilter?.(v)}
                />
              )}
              <HeadMenu
                ariaLabel="Group by"
                value={groupBy}
                label={groupBy === "none" ? "Group" : "By " + GROUP_LABEL[groupBy]}
                options={(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => ({ value: g, label: GROUP_LABEL[g] }))}
                onPick={(g) => setGroup(g as GroupBy)}
              />
            </>
          )}
        >
          {segments}
        </LifeHeader>
      </PageHeader>

      {/* THE WAY BACK OUT, and nothing else (2026-09-18). This row used to
          carry Pick One, a full-width red fill that named nothing and opened
          a sheet Focus has now absorbed. While Just This One is on, the page
          IS the one thing, and this row is how you leave. */}
      {overwhelmed ? (
        <div className="pad-x pick-one">
          <button className="btn btn-block" onClick={onCalm}>{OVERWHELM_EXIT}</button>
        </div>
      ) : startCard && !q && filter !== "done" ? (
        // HIDDEN WHILE SEARCHING, AND IN DONE (handoff rule 6: "Hide the
        // suggestion card during local search and in Done so it does not
        // distract from browsing"). A card proposing what to start next, on
        // top of the three results you went looking for, is the reason you
        // cannot see them.
        // START NOW (2026-09-16, Dave: "No unexplained huge Pick One
        // button"). The red button that named nothing is a card that names
        // the task, says what is ready on it, and can be asked why. Pick
        // One survives as the fallback below for a caller that mounts this
        // page without a start card (tests, and any future embed), so the
        // decision killer is never a dead button, only the weaker of the
        // two shapes.
        startCard
      ) : null}

      {/* THE MODE STILL STATES ITSELF. Just This One replaces the list with
          one task, so it says so where the controls were. Everything else
          that lived on this line -- the view, the Area, the Group -- is in
          the chip row above or in the options sheet below. */}
      {overwhelmed && (
        <div className="dd-line"><span className="dd dd-lead dd-static">{OVERWHELM_ENTER}</span></div>
      )}

      {/* THE DUPLICATE ADD BOX IS GONE (2026-08-21, Dave: "Add task type box
          makes no sense"). It was a plain text field that parsed dates and
          nothing else, sitting one screen above the JARVIS capture bar, which
          does the same job and also reads categories, people and projects.
          Two boxes, one job, and the worse one was on top. */}

      {/* The two bulk verbs a view can carry, both the neutral pill, both
          in the same seat under the head: an overdue pile resets in one
          tap instead of one tap per shame; a done list clears. */}
      {filter === "overdue" && shown.length > 0 && onMoveAllToToday && (
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
      ) : shown.length === 0 && momentumHome && listed.length !== items.length ? (
        // ONLY THE SUGGESTION IS LEFT (Dave's pass-off, 2026-09-26). The one
        // task in this view is the Keep Going row, so the list is not empty:
        // the card holds the suggestion and no empty-state copy says
        // "Nothing Due Today" under a live task.
        <div className="card list-card-ruled">{momentumHome}{notice}</div>
      ) : shown.length === 0 ? (
        <>
        {(momentumHome || notice) && <div className="card list-card-ruled">{momentumHome}{notice}</div>}
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
        // THE LIST IS A BLOCK, WITH THE PAGE'S OWN GAP ABOVE IT (Dave
        // 2026-09-17: "there's containers on the task page vertically don't
        // follow spacing/border rules (way too close together)"). Measured at
        // phone width: zero. The ruled list card carries its own page margin
        // rather than a .pad-x wrapper, so it fell outside the rule that
        // spaces two card blocks, and sat flush against the card above it.
        <div className="task-list-block">
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
                {gi === 0 && momentumHome}
                {gi === 0 && stalledRow}
                {gi === 0 && notice}
                {g.items.map((it) => (
                  <React.Fragment key={it.id}>
                    <TaskRow
                      item={it} today={today} onToggle={onToggle} onOpen={onOpenTask}
                      onDelete={onDeleteTask} onSnooze={onSnoozeTask} onStart={onStartTask} startLabel={startLabel} onRename={onRenameTask}
                      onFirstStep={onFirstStepTask}
                      selecting={sel.active} picked={sel.isSelected(it.id)}
                      onPick={sel.toggle} muteToday={filter === "today"}
                      parent={parentOf?.(it) ?? null}
                      burstSize={burstSizeOf?.(it) ?? "small"}
                      openSourceFor={openSourceFor}
                      person={personFor?.(it) ?? null}
                    />
                    {/* Momentum Chain (addendum item 7): the suggestion slides
                        into the just-finished slot, right below its row. */}
                    {momentum?.afterId === it.id && momentum.el}
                  </React.Fragment>
                ))}
              </div>
            </React.Fragment>
          ))}
          {/* THE ADD IS ON THE HEAD, NOT AT THE FOOT (Dave 2026-10-05, locked: a
              section-level action lives in the section head, never at the foot
              of a list). The header's compact New Task is the one door; B8's
              "every list ends with the way to grow it" row, and the lone
              capsule it left under the last card, are gone. */}
        </div>
      )}
      {/* This page had no foot spacer at all, so its last row sat under the
          capture bar with nothing below it to scroll (2026-08-24 walk, which
          found Add a Task permanently covered). Every other scrolling screen
          in the app already ends with one. */}
      <div className="screen-foot" />
      {/* EVERY SECONDARY TOOL, ONE PLACE (handoff rule 7). Nothing here is
          new: Area and Group are the SAME HeadMenu components that stood on
          the line under the head, handed the same props in a row; Select and
          Upload a Syllabus are the bar controls they replaced. Moving a
          control is not rebuilding it. */}
      {optsOpen && (
        <OptionsSheet title="Tasks Options" rows={([
          // JUST THIS ONE LIVES HERE NOW (2026-09-18). It was an action on
          // the What Now sheet, which Focus replaced; it is a mode of THIS
          // list, not of that screen, so it belongs to this list's options.
          ...(onJustThisOne && !overwhelmed && counts.all > 1 ? [{
            key: "one", label: OVERWHELM_ENTER,
            onClick: () => { setOptsOpen(false); onJustThisOne(); },
          }] : []),
          ...(onDeleteMany && shown.length > 0 ? [{
            key: "select", label: "Select Tasks",
            onClick: () => { setOptsOpen(false); sel.enter(); },
          }] : []),
          ...(onUpload ? [{
            key: "upload", label: "Upload a Syllabus",
            onClick: () => { setOptsOpen(false); onUpload(); },
          }] : []),
        ] as OptionRow[])} onClose={() => setOptsOpen(false)} />
      )}
      {onDeleteMany && (
        <SelectBar
          sel={sel}
          noun="Task"
          onDelete={() => { onDeleteMany(sel.selected); sel.exit(); }}
          {...(onDoneMany ? { extraLabel: "Mark Done", onExtra: () => { onDoneMany(sel.selected); sel.exit(); } } : {})}
          {...(onMoveMany && projects && projects.length > 0
            ? { projects, onMoveToProject: (ids: string[], projectId: string) => { onMoveMany(ids, projectId); sel.exit(); } }
            : {})}
        />
      )}
    </div>
  );
}
