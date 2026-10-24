import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { MeasureKind, SetEntry } from "./types";
import { entryNoun, fieldsFor, formatSet } from "./measures";
import { plateFacts, type PlateFacts } from "./ramp";
import { plateMath, repLabel, type LoadStyle } from "./equipment";
import { fieldsOf, type SetDraft } from "./nextSet";
import { lineCase } from "../shared/casing";
import { useRowMenu } from "../shared/useRowMenu";
import { setState, setKicker, workNumbers, type SetState } from "./stateWord";
import { readGymSettings, rackFrom } from "./settings";
import { duplicateEntry, blankEntry } from "./strip";
import ReorderList from "../shared/ReorderList";
import { useSwipe } from "../shared/useSwipe";
import Stepper from "../shared/Stepper";
import { Trash2, Check, Forward } from "../shared/icons";

// A SLOW TAP IS NOT A SECOND SET (2026-09-16, Dave: "when you log something,
// it automatically adds a set. That's not correct."). A 550ms press on a chip
// used to duplicate it -- which is a thumb resting on a phone between sets,
// and it inserted a set silently, with no toast and no undo. GYM-F-26 settled
// this argument once already on the gym's other rows: a long press that is
// the only door to an action is a door nothing announces, no keyboard or
// VoiceOver user can open, and every slow tap opens by accident. Duplicate is
// a row in the editor the chip's own tap already opens.

/**
 * THE SET STRIP (catalog §3.1). One chip per set, independently editable:
 * tap to edit its own numbers, long-press to duplicate it, swipe to delete
 * it, drag to reorder (via the shared ReorderList primitive -- there is
 * exactly one drag implementation in the app, per the editing-primitives
 * law). [+] adds a set, defaulting to the last set's numbers, the way a
 * coach builds a program by copying rather than retyping.
 *
 * The SAME component edits the plan (ExerciseSheet, where `entries` is the
 * program's target strip) and the live log (SessionScreen, where `entries`
 * is what has actually been logged this session, plus `ghost` for the
 * remaining planned sets not yet filled in). Unfilled chips are the plan;
 * filled chips are the record.
 */
export default function SetStrip({
  kind, unit, timeUnit, style, rack: rackIn, entries, onChange, ghost, nowDraft, onNowDraft, nowWarm = false, onNowMode, nowNo, nowExtra, nowMatchesLast = false, onNowLog, nowFocus, onOpenSet, onOpenGhost, editableGhosts = false, disabled, prAt, moveTracking, lastFor, onMatchLast, handles = false, canAdd = true,
}: {
  kind: MeasureKind;
  unit?: string;
  timeUnit?: string;
  /** WHAT THIS THING LOADS WITH (2026-09-16, Dave: "if I'm using dumbbells,
   *  it doesn't adjust for dumbbells"). equipment.ts has known a stack steps
   *  in 10s, a dip belt in 2.5s and an assisted machine records help rather
   *  than load since it was written, and ExerciseSheet's own steppers have
   *  read it since -- but the STRIP, which is the thing an athlete actually
   *  types into mid-set, called fieldsFor(kind) with no context at all. So
   *  every chip in the app stepped by 5 and said "Weight", whatever it was
   *  attached to. Absent keeps that universal behaviour for callers with no
   *  exercise in hand. */
  style?: LoadStyle;
  /** THE ATHLETE'S PLATES, in the strip's unit (2026-10-17, defect G), so a
   *  plate-loaded lift's weight field steps by the smallest plate he owns.
   *  Absent, the equipment's own step stands. */
  rack?: { plates: number[] };
  entries: SetEntry[];
  onChange: (next: SetEntry[]) => void;
  /** Planned sets not yet logged (live session only): shown as unfilled
   *  chips after the filled ones. ONE FLOW (2026-09-26, the workout logging
   *  pass-off: "Different styles show up for logging depending on what's
   *  clicked. Needs one single clean logging flow"). The working set the
   *  athlete is on is the Now row below, and the sets after it are the plan,
   *  read and not tapped. A row body that logged the plan while the fields
   *  on it said something else was two doors with two answers.
   *
   *  NO WARM-UP GHOSTS (2026-09-29). The ramp used to arrive here as dashed
   *  "Warm-Up" rows of its own that logged on tap. It is a suggestion the Now
   *  row carries now (`nowWarm`), so nothing in `ghost` is a warm-up. */
  ghost?: SetEntry[];
  /** THE FIELDS' OWN STRINGS, OWNED BY THE SESSION (2026-09-26). Given, the
   *  Now row shows exactly these and reports every keystroke back through
   *  onNowDraft, so the button's label, the fields and the write can never
   *  say three things. Absent (a planning strip, a test), the row keeps its
   *  own copy seeded from the ghost. ONLY THE RED BUTTON LOGS (Dave,
   *  2026-09-26): the Now row has no tick of its own any more. */
  nowDraft?: SetDraft;
  onNowDraft?: (draft: SetDraft) => void;
  /** WORK | WARM-UP, ON THE NOW ROW (2026-09-29). `nowWarm` says which side
   *  the row is on; `onNowMode` is the pill that flips it in one tap and is
   *  what makes the pill exist. On the warm-up side the row is named for it
   *  and drops the last-time line, which is about the work. */
  nowWarm?: boolean;
  onNowMode?: (warm: boolean) => void;
  /** THE NOW CARD'S OWN SET NUMBER (2026-10-17, defect E), the one count the
   *  head and the meter read (stateWord.setCount.nowNo), so its fields are
   *  named for the set he is on. Absent, the strip's own numbering stands. */
  nowNo?: number;
  /** One line the session folds into the Now row under the fields: the
   *  progression's suggestion, in the estimate's ink (Dave, 2026-09-26:
   *  nothing above the Now row may change height when a set lands). */
  nowExtra?: ReactNode;
  /** Match hides when the fields already say what last time did. */
  nowMatchesLast?: boolean;
  /** THE SET SHEET (2026-09-26). In the live session a Done row opens the
   *  session's own sheet (SetSheet.tsx) instead of the inline stepper panel,
   *  so the numbers are typed the one way everywhere on the screen. The
   *  planning and history editors, which do not pass this, keep the panel. */
  onOpenSet?: (id: string) => void;
  /** A PLANNED ROW IS A DOOR (2026-10-17, defect C). The dashed Set 2 and Set
   *  3 rows under the Now card took a tap and did nothing. Given, each opens
   *  the caller's editor on the planned set at that strip position, to change
   *  this session's plan; the Now row keeps its fields and is not a door. */
  onOpenGhost?: (pos: number) => void;
  /** RETURN ACCEPTS AND LOGS (the Logging Standard, rule 4, 2026-10-17: Enter
   *  saves; changing a weight is tap, type, Return, the 2-action budget).
   *  Pressing Return in one of the Now row's fields does what the Log button
   *  does. Given by the live session only; the planning strip has nothing to
   *  log and its fields keep the plain keyboard. */
  onNowLog?: () => void;
  /** THE CURSOR IS ALREADY THERE (Dave, 2026-10-17: "Bring the cursor to it
   *  though to edit quickly if they want to change it"; the Now card's focus
   *  was his delegation, ruled the same way). Given, the Now row's first
   *  field takes focus each time `key` changes: a new set, a new lift, the
   *  other side of Work | Warm-Up. `select` puts the whole number under the
   *  cursor so the first keystroke replaces it; off for numbers he was
   *  already typing, so a restored draft is never wiped by one key. */
  nowFocus?: { key: string; select: boolean };
  /** VALUES READY TO EDIT (2026-09-14, the reference's set grid): with this
   *  on, the Now row carries the two fields. */
  editableGhosts?: boolean;
  disabled?: boolean;
  /** True at an index that earned the in-session PR pill (live session only). */
  prAt?: (index: number) => boolean;
  /** HOW IT MOVED (catalog §4.5): offer the three observable-event chips in
   *  the set editor. Only meaningful once a set has actually happened, so
   *  ExerciseSheet (planning) never passes this -- only the live session and
   *  a finished workout's editor do. */
  moveTracking?: boolean;
  /** LAST TIME, D2 (Training Catalog V2, 2026-08-31): "Last: 250 × 3" for
   *  the chip at strip position `index` (logged chips first, then ghosts).
   *  Null where last session had no set at that position. Quiet reference
   *  on filled chips; on a ghost it pairs with onMatchLast. */
  lastFor?: (index: number) => string | null;
  /** D2 tap-to-match (live session only): log exactly what last session's
   *  set at this position did. Offered on ghost chips beside the plan tap. */
  onMatchLast?: (index: number) => void;
  /** REORDER IS A MODE (Health Preview, approved 2026-08-31): grips appear
   *  only while the caller's Reorder pill has them on. Default off -- a
   *  resting chip is a kicker, its numbers and one door. */
  handles?: boolean;
  /** The live session turns the strip's own Add off (2026-09-26): its extra
   *  set opens the Now row instead, so there is one way to log a set. */
  canAdd?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const fields = fieldsFor(kind, style ? { ...style, unit, ...(rackIn ? { rack: rackIn } : {}) } : undefined);
  // The bar is the equipment's, not the rack's. A Smith carriage and a
  // plate-loaded machine both take real plates and neither has a 45 to
  // subtract first; the open chip was subtracting a barbell's bar from both,
  // which put every machine's plate count out by a bar. plateMath has
  // answered this since equipment.ts shipped.
  const math = plateMath(style ?? {});
  const fx = { kind, unit, timeUnit, sided: style?.sided };
  // PLATE MATH (D8-A): the athlete's own bar and rack, so an open chip can
  // say what to load instead of making them do arithmetic on a gym floor.
  const rack = rackFrom(readGymSettings());
  // With no style at all the old universal reading stands: a barbell's bar.
  const bar = !style ? rack.bar : math.hasBar ? rack.bar : 0;
  // H-17 / R9 (Health Push B, 2026-09-12): the working set the athlete is on
  // is the first planned working set not yet logged, -1 once they are all
  // logged. Every row derives its state from its place against it.
  // A PLAN IS NOT A LOG. The vocabulary belongs to a strip that records
  // (the live session, which has ghosts, and a finished workout's editor,
  // which tracks how sets moved); the program's own target strip just says
  // Set N, because nothing in a plan has happened yet.
  const isLog = ghost !== undefined || !!moveTracking;
  const firstWorkGhost = (ghost ?? []).findIndex((g) => !g.warmup);
  const nowPos = firstWorkGhost < 0 ? -1 : entries.length + firstWorkGhost;
  // ONE NUMBERING (pass-off item 9): the strip's set numbers come from the
  // same count the head and the meter read (stateWord.workNumbers). The Now
  // card on its Warm-Up side is a warm-up, so the plan's Set 1 keeps its name.
  const numbers = workNumbers([...entries, ...(ghost ?? [])], nowWarm && nowPos >= 0 ? nowPos : -1);
  const workNoAt = (pos: number) => numbers[pos] ?? 1;
  // THE NOW ROW IS NEVER LEFT UNDER THE LOG BUTTON (Dave 2026-10-09, pass-off
  // item 8: "The Log button overlaps the NOW card"). The foot under the list
  // is the bar's own measured height plus the home indicator (.se-foot), so
  // the page can always scroll clear; this is the other half: whenever a new
  // set becomes the Now row (the workout opens, a set lands, the exercise
  // changes) the row is brought just into view above the bar, by the least
  // scroll that does it. Its scroll-margin is the bar (ruled.css), so
  // "nearest" stops above the button, and a row already in view does not move.
  const nowRef = useRef<HTMLDivElement | null>(null);
  const live = !!ghost && editableGhosts;
  useEffect(() => {
    if (!live) return;
    nowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [live, nowPos, entries.length, kind]);

  const patch = (id: string, p: Partial<SetEntry>) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const remove = (id: string) => {
    onChange(entries.filter((e) => e.id !== id));
    if (openId === id) setOpenId(null);
  };
  const duplicate = (id: string) => {
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0) return;
    const copy = duplicateEntry(entries[i]!);
    onChange([...entries.slice(0, i + 1), copy, ...entries.slice(i + 1)]);
  };
  const add = () => {
    const last = entries[entries.length - 1];
    const fresh = last ? { ...duplicateEntry(last), skipped: false } : blankEntry();
    onChange([...entries, fresh]);
  };
  const reorder = (nextIds: string[]) => {
    const byId = new Map(entries.map((e) => [e.id, e]));
    onChange(nextIds.map((id) => byId.get(id)!).filter(Boolean));
  };

  return (
    <div className="set-strip">
      {/* THE ADD IS THE LIST'S LABEL ROW'S (Dave 2026-10-05, locked): Add a Set was a row at the foot of the strip. The
          group's own label row carries it at the right, the one capsule a sheet group's actions wear. */}
      {!disabled && canAdd && (
        <div className="grp"><div className="eyebrow">{entryNoun(kind)}</div>
          <button type="button" className="see-all pill-action" onClick={add}>{`Add ${entryNoun(kind, false)}`}</button>
        </div>
      )}
      <ReorderList
        ids={entries.map((e) => e.id)}
        onReorder={reorder}
        handles={handles}
        renderRow={(id) => {
          const i = entries.findIndex((x) => x.id === id);
          const e = entries[i];
          if (!e) return null;
          return (
            <div className="row-grow set-chip-col">
              <SetChipRow
                index={i}
                entry={e}
                state={isLog ? setState(e, i, nowPos) : null}
                workNo={workNoAt(i)}
                kind={kind}
                fx={fx}
                open={openId === id}
                disabled={!!disabled}
                pr={!!prAt?.(i)}
                last={lastFor?.(i) ?? null}
                onToggle={() => (onOpenSet ? onOpenSet(id) : setOpenId(openId === id ? null : id))}
                onDelete={() => remove(id)}
                onSkip={() => patch(id, { skipped: !e.skipped, done: false })}
                onDuplicate={() => duplicate(id)}
              />
              {openId === id && !disabled && !onOpenSet && (
                <SetChipEditor kind={kind} fields={fields} entry={e} onPatch={(p) => patch(id, p)} moveTracking={moveTracking}
                  // WHICH SET THIS IS (2026-09-16, Dave: "I don't even know
                  // what I'm logging"). The editor drops open UNDER the chip
                  // it belongs to, and once the steppers and the How Did It
                  // Move chips are on screen the chip itself is above the
                  // fold. It says its own name now.
                  // The chip's NAME, not its state word: the row above already
                  // says Done, and "Editing Set 1 · Done" reads as a state the
                  // editing is in (2026-09-16, caught in a render). A warm-up
                  // and a drop still say what they are, because that is their
                  // name and not a state.
                  title={chipKicker(e, null, workNoAt(i))}
                  onDuplicate={() => duplicate(id)}
                  // GYM-F-19 (2026-09-05): the kg guard was from before the
                  // rack had a unit, and it meant a lifter who HAD set a 20 kg
                  // bar and kg plates (S5-Q32) still never saw plate math.
                  // plateLine converts between the chip's unit and the rack's.
                  // OFFERED WHERE THERE ARE PLATES, not on every loaded lift
                  // (2026-09-16): a dumbbell press and a cable row are both
                  // weight_reps, and both were being told which plates to
                  // hang on a barbell. With no style at all (a planning strip
                  // that was never given one) the old reading stands.
                  plates={kind === "weight_reps" && (!style || math.offer)
                    ? plateFacts(e.w ?? 0, rack, unit, bar)
                    : null} />
              )}
            </div>
          );
        }}
      />
      {ghost && ghost.length > 0 && (
        <div className="set-strip-ghosts">
          {ghost.map((g, i) => {
            const pos = entries.length + i;
            const st = setState(g, pos, nowPos);
            const isNow = st === "now";
            // EVERY KIND GETS ITS FIELDS (2026-10-17, defects A and B). The
            // grid was weight_reps only; a reps lift's Now card was static
            // text and a Plank's said Empty with nothing to type into. A done
            // mark is the one kind with no number.
            const grid = isNow && editableGhosts && kind !== "done";
            const warmNow = isNow && nowWarm;
            const lastText = warmNow ? null : (lastFor?.(pos) ?? null)?.replace(/^Last:?\s*/, "") ?? null;
            const door = st === "next" && !!onOpenGhost && !disabled;
            return (
              // row-tap: the Now row is the fields; a tap on its padding must
              // not log a second answer beside them (2026-09-26). A planned
              // row after it is the door to its own editor (onOpenGhost).
              <div className={"row set-chip-ghost" + (isNow ? " setrow-now" : "") + (st === "next" ? " se-next" : "") + (door ? " se-door" : "")} key={g.id} ref={isNow ? nowRef : undefined}
                role={door ? "button" : undefined} tabIndex={door ? 0 : undefined}
                aria-label={door ? `${setKicker(st, workNoAt(pos))}, ${formatSet(fx, g)}, tap to edit` : undefined}
                onClick={door ? () => onOpenGhost!(pos) : undefined}
                onKeyDown={door ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenGhost!(pos); } } : undefined}>
                <div className="row-grow">
                  {/* H-17 / R9 (2026-09-12): the row says its state. The working
                      set the athlete is on says Now and wears the cyan rule;
                      the rest say only their name, Set 2, Set 3, in quiet ink
                      at full strength (pass-off item 9). */}
                  <div className={"se-kick " + st}>{warmNow ? "Now · Warm-Up" : setKicker(st, workNoAt(pos))}</div>
                  {/* WORK | WARM-UP (2026-09-29). One two-way pill, on the row
                      that is about to be logged, so calling a set a warm-up is
                      one tap before it is written and the label on the red
                      button follows. */}
                  {isNow && onNowMode && !disabled && (
                    <div className="segmented se-mode" role="group" aria-label="Set type">
                      <button type="button" className={"seg" + (!nowWarm ? " active" : "")} aria-pressed={!nowWarm} onClick={() => onNowMode(false)}>Work</button>
                      <button type="button" className={"seg" + (nowWarm ? " active" : "")} aria-pressed={!!nowWarm} onClick={() => onNowMode(true)}>Warm-Up</button>
                    </div>
                  )}
                  {grid
                    ? <GhostGrid entry={g} fields={fields} unit={unit} timeUnit={timeUnit} repWord={style ? repLabel(style) : "Reps"}
                        side={warmNow ? "Warm-Up" : `Set ${nowNo ?? workNoAt(pos)}`}
                        value={nowDraft} onDraft={onNowDraft} onEnter={onNowLog} focus={disabled ? undefined : nowFocus} />
                    : kind === "done"
                      ? <div className="conn-name">Mark Done</div>
                      // A PLANNED ROW READS "Target 275 Lb × 5 · Last 275 Lb × 1"
                      // (Dave's board, 2026-10-17): the plan as the row's one
                      // grey, last time in teal beside it, and nothing else.
                      : <div className="facts">
                          <span className="fact">{`Target ${lineCase(formatSet(fx, g))}`}</span>
                          {lastText && <span className="fact cyan">{`Last ${lineCase(lastText)}`}</span>}
                        </div>}
                  {/* THE NOW CARD'S ONE SMALL LINE (Dave's board, 2026-10-17):
                      last time in teal, then the suggestion, then Use. D2
                      tap-to-match: the last-time fact is the door to putting
                      those exact numbers in the fields; the red button then
                      writes them, like every other set. The verb hides once
                      the fields already say it (Dave, 2026-09-26), and says
                      what it does, Use Last (defect L). */}
                  {isNow && (lastText || nowExtra) && (
                    <div className="facts se-nowline">
                      {lastText && (onMatchLast && !nowMatchesLast
                        ? <button type="button" className="set-last-act fact cyan" aria-label={`Use ${lastText}, same as last time`}
                            onClick={(e) => { e.stopPropagation(); onMatchLast(pos); }}>
                            {`Last ${lineCase(lastText)}`}<span className="act">Use Last</span>
                          </button>
                        : <span className="fact cyan">{`Last ${lineCase(lastText)}`}</span>)}
                      {nowExtra}
                    </div>
                  )}
                </div>
                {/* The planned row is a door (preview anatomy): say so. */}
                {door && <div className="chev" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** WHAT A CHIP CALLS ITSELF: Set 2, Warm-Up, Drop, or the state word the
 *  live strip uses. A ramp set is real work but not the work, so it says so
 *  and counts toward nothing (D3-A). Pulled out of SetChipRow 2026-09-16 so
 *  the editor that opens under a chip can wear the same name -- one name, one
 *  place, and the two can never drift apart. */
function chipKicker(entry: SetEntry, state: SetState | null, workNo: number): string {
  if (state) return setKicker(state, workNo, true);
  if (entry.warmup) return "Warm-Up";
  if (entry.drop) return "Drop";
  // A skipped set holds no number (pass-off item 9): the next set takes it.
  if (entry.skipped) return "Skipped Set";
  return `Set ${workNo}`;
}

function SetChipRow({
  index, entry, kind, fx, open, disabled, pr, last, onToggle, onDelete, onSkip, onDuplicate, state, workNo,
}: {
  index: number;
  entry: SetEntry;
  /** H-17 / R9: the row's state word (null on a plan strip) and its
   *  working-set number. */
  state: SetState | null;
  workNo: number;
  kind: MeasureKind;
  fx: { kind: MeasureKind; unit?: string; timeUnit?: string };
  open: boolean;
  disabled: boolean;
  pr?: boolean;
  /** D2: "Last: 250 × 3", quiet reference under the chip's own numbers. */
  last?: string | null;
  onToggle: () => void;
  onDelete: () => void;
  /** Swipe left's quickest verb (Dave 2026-10-05, locked): skip this set, or bring it back. Delete follows it in. */
  onSkip: () => void;
  /** The editor's other move, kept for the held row's menu. */
  onDuplicate: () => void;
}) {
  // THE HOLD IS THE CONTEXT MENU (Dave 2026-10-05): the set's own moves, Delete last (the editor under the chip holds the
  // same Skip and Duplicate).
  const rowMenu = useRowMenu({ title: chipKicker(entry, null, workNo), actions: [
    { label: entry.skipped ? "Unskip" : "Skip", onPick: onSkip },
    { label: "Duplicate", onPick: onDuplicate },
    { label: "Delete", destructive: true, onPick: onDelete },
  ], enabled: !disabled });
  const swipe = useSwipe({ revealW: 176, enabled: !disabled, onLongPress: rowMenu.onLongPress });
  const { handlers, sheet } = rowMenu.bind(swipe);

  // A SKIPPED ROW READS ONCE (2026-10-17, defect L): the kicker already says
  // Skipped, so the line under it is the planned numbers it would have been,
  // or nothing at all when it never had any (a row with nothing to say shows
  // nothing).
  const planned = kind === "done" ? "" : formatSet(fx, entry, { bodyweight: !entry.skipped });
  const label = entry.skipped ? (planned === "Empty" ? "" : planned) : kind === "done" ? (entry.done ? "Done" : "Not Marked Yet") : planned;
  // The chip prints the whole rule's casing ("185 Lb × 5"); the aria-label
  // keeps the raw reading, since casing is inaudible (laws.test.ts).
  const shown = lineCase(label);
  const kicker = chipKicker(entry, state, workNo);

  return (
    <div className={"task-swipe set-chip-swipe" + (swipe.dx ? " swipe-open" : "")}>
      <button className="task-verb" aria-label={`${entry.skipped ? "Unskip" : "Skip"} set ${index + 1}`} onClick={() => swipe.closeThen(onSkip)}>
        <Forward className="ic" /><span className="swipe-label">{entry.skipped ? "Unskip" : "Skip"}</span>
      </button>
      <button className="task-del" aria-label={`Delete set ${index + 1}`} onClick={() => swipe.closeThen(onDelete)}><Trash2 className="ic" /></button>
      <div
        className={"set-chip" + (entry.skipped ? " set-chip-skipped" : "") + (entry.warmup ? " set-chip-warm" : "") + (entry.drop ? " set-chip-drop" : "") + (swipe.dragging ? " swiping" : "")}
        style={{ transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined }}
        {...handlers}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={label ? `${kicker}, ${label}, tap to edit` : `${kicker}, tap to edit`}
        onClick={() => { if (!disabled) onToggle(); }}
      >
        <div className="row-grow">
          {/* KILL THE GREY SUBTEXT (Dave 2026-09-10). SET 1 / 220 lb x 3 /
              Last: 270 lb x 4 were three greys stacked, and the one that
              mattered mid-lift -- what you did last time -- was the faintest
              of the three. The kicker takes the ramp, and last time becomes a
              chip: a fact with an edge, not a footnote. */}
          {/* TWO LINES (Dave 2026-09-14): the kicker carries Last at its
              right end, so a set is its name-and-reference, then its numbers. */}
          <div className={"se-kick" + (state ? " " + state : "")}>{(state === "done" || state === "warm") && <Check className="ic se-kick-ic" />}{kicker}
            {last && <span className="se-chip se-chip-last"><em>Last</em>{lineCase(last.replace(/^Last:?\s*/, ""))}</span>}</div>
          {shown && <div className="conn-name">{shown}</div>}
        </div>
        {pr && <span className="se-pr">PR</span>}
        {/* The chip is a door (preview anatomy): say so. */}
        {!disabled && <div className="chev" />}
      </div>
      {sheet}
    </div>
  );
}

// COLOUR-CODED, BECAUSE THEY ARE A SCALE (Dave 2026-09-10: "They use pills.
// They use chips. They use color coding. They use dots"). Three chips in one
// identical grey asked the reader to parse three sentences to find the good
// one. Clean is lime, a grind is amber, a miss is pink -- the same three
// meanings the ramp already carries everywhere else on these screens.
const MOVED_OPTIONS: { value: "clean" | "grind" | "missed"; label: string; hue: string }[] = [
  { value: "clean", label: "All Clean", hue: "mv-clean" },
  { value: "grind", label: "Last One Was a Grind", hue: "mv-grind" },
  { value: "missed", label: "Missed One", hue: "mv-missed" },
];
// A warm-up is supposed to move well, so marking one says nothing about the
// work and the progression engine ignores it (D6). No chips on a ramp set.

function SetChipEditor({ kind, fields, entry, onPatch, moveTracking, plates, title, onDuplicate }: {
  kind: MeasureKind;
  fields: ReturnType<typeof fieldsFor>;
  entry: SetEntry;
  onPatch: (p: Partial<SetEntry>) => void;
  moveTracking?: boolean;
  /** The chip's own name, so the panel says which set it is editing. */
  title: string;
  onDuplicate: () => void;
  /** PLATE MATH (D8-A): what goes on each side, or null when this rack
   *  cannot build the number exactly -- silence beats a wrong answer. */
  plates?: PlateFacts | null;
}) {
  return (
    <div className="set-chip-editor">
      {/* THE SET'S OWN TWO MOVES ARE ITS LABEL ROW'S (Dave 2026-10-05, locked: no capsule row inside the card). Duplicate and
          Skip were two capsules under the steppers; the editor's own label carries them at its right, and the set's swipe
          holds Skip as its quick verb. */}
      <div className="grp"><div className="eyebrow">Editing {title}</div>
        <span className="grp-acts">
          <button type="button" className="see-all pill-action" onClick={onDuplicate}>Duplicate</button>
          <button type="button" className="see-all pill-action" onClick={() => onPatch({ skipped: !entry.skipped, done: false })}>{entry.skipped ? "Unskip" : "Skip"}</button>
        </span>
      </div>
      {/* PLATE MATH READS AS PLATES (Dave 2026-09-10). "45 · 35 · 5 · 2.5"
          over a grey "Per side" is a sentence about plates; a lifter loading a
          bar wants to SEE them. Each number is its own chip, in the ramp's
          amber, and the label is the quiet half. */}
      {plates && !entry.skipped && (plates.kind === "plates" ? (
        <div className="row"><div className="row-grow">
          <div className="se-plates">
            {plates.per.map((p, i) => (
              <span className="se-plate" key={p + ":" + i}>{p}</span>
            ))}
          </div>
          <div className="se-plate-k">Per Side</div>
        </div></div>
      ) : (
        // H-29 (Health Push B, 2026-09-12): a number the rack cannot build
        // says so and names the nearest it can, instead of falling silent.
        <div className="row"><div className="row-grow">
          <div className="facts">
            <span className="fact amber">{`Not Buildable at ${plates.at}`}</span>
            {plates.nearest != null && <span className="fact">{`Nearest ${plates.nearest}`}</span>}
          </div>
        </div></div>
      ))}
      {kind === "done" ? (
        <div className="row" role="button" tabIndex={0} onClick={() => onPatch({ done: !entry.done, skipped: false })}>
          <div className="row-grow"><div className="conn-name">{entry.done ? "Done" : "Mark Done"}</div></div>
        </div>
      ) : (
        !entry.skipped && fields.map((f) => (
          <div className="row" key={f.key}>
            <div className="row-grow"><div className="conn-name">{f.label}</div></div>
            <Stepper value={entry[f.key] ?? 0} step={f.step} label={f.label}
              onChange={(n) => onPatch({ [f.key]: n })} />
          </div>
        ))
      )}
      {/* HOW IT MOVED (catalog §4.5): observable events, never an
          interoception/feelings scale. Optional -- tapping the already-active
          chip clears it rather than forcing a choice. */}
      {moveTracking && !entry.skipped && !entry.warmup && !entry.drop && (
        <div className="field">
          <div className="input-label">How Did It Move?</div>
          <div className="chip-row chip-wrap-row">
            {MOVED_OPTIONS.map((o) => (
              <div key={o.value} className={"chip mv " + o.hue + (entry.moved === o.value ? " active" : "")} role="button" tabIndex={0}
                aria-pressed={entry.moved === o.value}
                onClick={() => onPatch({ moved: entry.moved === o.value ? undefined : o.value })}>
                {o.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// THE GRID ROW (2026-09-14): the plan's weight and reps as two fields, the
// tick logs them. Typing never touches the plan; only the tick writes, and it
// writes exactly what the fields say.
//
// AND IT SAYS SO OUT LOUD (2026-09-16, Dave: "it just defaults to like
// whatever it originally was"). These numbers used to live only in here, so
// the session's own big red Log Set button could not see them: it logged the
// PLAN while the fields on screen said something else, and the athlete watched
// the wrong set land. `onDraft` lifts what is typed to the session, which is
// what the button now logs and what its label now reads. The fields stay
// uncontrolled -- the local state is still the source of truth for the input,
// so nothing re-renders under the thumb mid-keystroke.
function GhostGrid({ entry, fields, unit, timeUnit, repWord, side, value, onDraft, onEnter, focus }: {
  entry: SetEntry;
  /** The kind's fields (measures.fieldsFor), with the equipment's own
   *  increment on the weight, so the arrows move by what the rack can do. */
  fields: ReturnType<typeof fieldsFor>;
  unit?: string;
  timeUnit?: string;
  /** "Reps", or "Reps Per Side" for a sided lift (2026-09-26): the field
   *  says which reading its number is, so the header needs no chip for it. */
  repWord: string;
  /** WHAT THE FIELDS ARE NAMED FOR (2026-10-17, defect E): "Set 2" or
   *  "Warm-Up". They read "Set 1" on every set before this. */
  side: string;
  /** The session's own strings for these fields, when it owns them. */
  value?: SetDraft;
  onDraft?: (draft: SetDraft) => void;
  /** Return in any field: the same write as the Log button (rule 4). The
   *  keyboard's return key says Go when it is wired, and nothing when the
   *  strip has no log to make, so the hint never promises a write that will
   *  not happen. */
  onEnter?: () => void;
  /** Focus the first field when `key` changes (SetStrip's nowFocus). */
  focus?: { key: string; select: boolean };
}) {
  // A ZERO IS NOT A NUMBER SOMEBODY TYPED (Dave 2026-09-17: "a new exercise
  // renders a buggy and weird looking log box. The typing is all off too").
  //
  // An exercise created mid-session plans no weight, so `entry.w` is 0 or
  // absent, and these fields opened reading "0". Tap one and iOS puts the
  // caret AFTER the zero: typing 135 gives you 135 in the record and "0135"
  // on the screen the whole way there. On a new lift, where every ghost row
  // starts at zero, that is every field on the card.
  //
  // So an unplanned number shows as empty with the unit as its placeholder,
  // which is also honest -- the app does not know what you are about to
  // lift, and printing 0 says it does.
  //
  // ONE COPY OF THE NUMBERS (2026-09-26). The fields used to seed themselves
  // once, on mount, and never look again, so a corrected earlier set moved
  // the button's label and left these behind. They follow `value` now
  // (fieldsOf the seed, or what was typed), and every keystroke reports up.
  //
  // ONE GRID FOR EVERY KIND (2026-10-17, defects A and B). Weight then reps
  // on a loaded lift, as before; reps alone on a reps lift; the time,
  // distance or height value in its unit; distance and time on a paired
  // attempt. Each field is the same box, named once beside itself.
  const seed = value ?? fieldsOf(entry);
  const shown = [...fields].sort((a, b) => (a.key === "w" ? -1 : b.key === "w" ? 1 : 0));
  const pick = (d: SetDraft): Record<string, string> => Object.fromEntries(shown.map((f) => [f.key, d[f.key] ?? ""]));
  const [vals, setVals] = useState<Record<string, string>>(() => pick(seed));
  const seedKey = shown.map((f) => seed[f.key] ?? "").join("\u0000");
  useEffect(() => { setVals(pick(seed)); }, [seedKey]);
  const report = (next: Record<string, string>) => onDraft?.({
    w: next.w ?? "", r: next.r ?? "",
    ...(shown.some((f) => f.key === "v") ? { v: next.v ?? "" } : {}),
    ...(shown.some((f) => f.key === "t") ? { t: next.t ?? "" } : {}),
  });
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  // AND A PLANNED ONE IS REPLACED, NOT APPENDED TO. The other half of the
  // same complaint: a field already reading 135 put the caret at the end, so
  // typing 145 gave 135145. Focus selects, so the first keystroke overwrites
  // -- which is what tapping a number on a form has always meant.
  const quiet = useRef(false);
  const selectAll = (e: { currentTarget: HTMLInputElement }) => {
    if (quiet.current) { quiet.current = false; return; }
    e.currentTarget.select();
  };
  // THE CURSOR ARRIVES ON ITS OWN (Dave, 2026-10-17). Never over another
  // field he is in, and never under an open sheet: the sheet's own field
  // keeps the keyboard.
  const first = useRef<HTMLInputElement | null>(null);
  const focusKey = focus?.key;
  useEffect(() => {
    const el = first.current;
    if (!focusKey || !el) return;
    const active = document.activeElement;
    if (active && active !== el && active !== document.body && active.matches("input, textarea, select, [contenteditable='true']")) return;
    if (document.querySelector("[role='dialog']")) return;
    quiet.current = !focus?.select;
    el.focus({ preventScroll: true });
    quiet.current = false;
  }, [focusKey]);
  /** The word beside each box: the unit on a weight, the rep word, the
   *  exercise's own unit on a time, distance or height, the time unit on the
   *  paired half. The field's label when the lift named no unit. */
  const wordFor = (f: ReturnType<typeof fieldsFor>[number]): string =>
    f.key === "r" ? repWord : f.key === "t" ? lineCase(timeUnit ?? "min") : unit ? lineCase(unit) : f.label;
  const nameFor = (f: ReturnType<typeof fieldsFor>[number]): string => (f.key === "r" ? repWord : f.key === "w" ? "Weight" : f.label);
  return (
    <div className="se-grid" onClick={stop} onPointerDown={stop}>
      {/* NO PLACEHOLDER: THE LABEL BESIDE IT ALREADY SAYS THE WORD (2026-09-21).
          The weight field's placeholder was the UNIT, printed immediately
          again by the span next to it, so an unset weight on a fresh lift
          rendered "lb  lb  8  reps" -- caught by looking at a real session,
          never by a test. Reps had the same duplication and only hid it by
          usually having a number in it.
          A field with the word already written beside it needs no ghost of
          the same word inside it; empty reads as "not set yet", which is what
          it is, and aria-label still names each field for a screen reader. */}
      {/* EACH FIELD IS A BOX (Dave's board 2026-10-16, screen 1): the number over its unit word in one bounded field,
          the two fields side by side. .se-field is the box; the input and the word inside it are what they were. */}
      {shown.map((f) => (
        <Fragment key={f.key}>
          <span className="se-field">
          <input ref={f.key === shown[0]?.key ? first : undefined} className="set-field" type="number" inputMode={f.key === "r" ? "numeric" : "decimal"} min={0} step={f.step} value={vals[f.key] ?? ""}
            onFocus={selectAll} aria-label={`${side} ${nameFor(f)}`}
            {...(onEnter ? { enterKeyHint: "go" as const, onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); onEnter(); } } } : {})}
            onChange={(e) => { const next = { ...vals, [f.key]: e.target.value }; setVals(next); report(next); }} />
          <span className="se-grid-u">{wordFor(f)}</span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}
