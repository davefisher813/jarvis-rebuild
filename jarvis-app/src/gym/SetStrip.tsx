import { useState } from "react";
import type { MeasureKind, SetEntry } from "./types";
import { entryNoun, fieldsFor, formatSet } from "./measures";
import { plateFacts, type PlateFacts } from "./ramp";
import { plateMath, type LoadStyle } from "./equipment";
import { setState, setKicker, type SetState } from "./stateWord";
import { readGymSettings, rackFrom } from "./settings";
import { duplicateEntry, blankEntry } from "./strip";
import ReorderList from "../shared/ReorderList";
import { useSwipe } from "../shared/useSwipe";
import Stepper from "../shared/Stepper";
import { Trash2, Check } from "../shared/icons";

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
  kind, unit, timeUnit, style, entries, onChange, ghost, onLogGhost, onLogGhostAs, onGhostDraft, editableGhosts = false, disabled, prAt, moveTracking, lastFor, onMatchLast, handles = false,
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
  entries: SetEntry[];
  onChange: (next: SetEntry[]) => void;
  /** Planned sets not yet logged (live session only): shown as unfilled
   *  chips after the filled ones. Tap to log exactly that plan. */
  ghost?: SetEntry[];
  onLogGhost?: (ghostIdx: number) => void;
  /** VALUES READY TO EDIT (2026-09-14, the reference's set grid). With
   *  editableGhosts on, a weight-and-reps ghost carries its own two fields
   *  and a tick: change a number, tick, and that is the set logged. The row
   *  body still logs the plan as it stands. */
  onLogGhostAs?: (ghostIdx: number, patch: Partial<SetEntry>) => void;
  /** What the CURRENT set's fields say, reported as they are typed, so the
   *  session's own Log button can log the same numbers the athlete is looking
   *  at rather than the plan they replaced. */
  onGhostDraft?: (patch: { w: number; r: number }) => void;
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
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const fields = fieldsFor(kind, style ? { ...style, unit } : undefined);
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
  const workNoAt = (pos: number) => [...entries, ...(ghost ?? [])].slice(0, pos + 1).filter((s) => !s.warmup && !s.drop).length;

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
                onToggle={() => setOpenId(openId === id ? null : id)}
                onDelete={() => remove(id)}
              />
              {openId === id && !disabled && (
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
            const lastText = lastFor?.(pos) ?? null;
            const st = setState(g, pos, nowPos);
            return (
              <div className={"row set-chip-ghost" + (st === "now" ? " setrow-now" : "")} role="button" tabIndex={0} key={g.id}
                onClick={() => onLogGhost?.(i)}>
                <div className="row-grow">
                  {/* H-17 / R9 (2026-09-12): the row says its state. The working
                      set the athlete is on says Now and wears the cyan rule;
                      the rest say Up Next in quiet ink at full strength. */}
                  <div className={"se-kick " + st}>{setKicker(st, workNoAt(pos))}</div>
                  {editableGhosts && kind === "weight_reps" && onLogGhostAs
                    ? <GhostGrid entry={g} unit={unit} step={fields.find((f) => f.key === "w")?.step ?? 0.5} setNo={workNoAt(pos)} onLog={(patch) => onLogGhostAs(i, patch)}
                        // Only the set he is ON reports upward: the session's
                        // Log Set button logs that one, so a later ghost's
                        // fields must not steer it.
                        onDraft={st === "now" ? onGhostDraft : undefined} />
                    : <div className="conn-name">{kind === "done" ? "Mark Done" : formatSet(fx, g)}</div>}
                  {/* D2 tap-to-match: the faint last-time line is itself the
                      door to logging those exact numbers -- the row still
                      logs the plan, the line logs what last time did. */}
                  {lastText && (onMatchLast
                    ? <button className="set-last-act" aria-label={`Log ${lastText.replace(/^Last: /, "")}, same as last time`}
                        onClick={(e) => { e.stopPropagation(); onMatchLast(pos); }}>
                        {lastText}<span className="act">Match</span>
                      </button>
                    : <div className="conn-meta">{lastText}</div>)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* The add lands after the plan (live session: after the ghosts), so
          "Add a Set" reads as extra work past it, never a step before it. */}
      {!disabled && (
        <button className="row-create set-strip-add" onClick={add}>Add {entryNoun(kind, false)}</button>
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
  return `Set ${workNo}`;
}

function SetChipRow({
  index, entry, kind, fx, open, disabled, pr, last, onToggle, onDelete, state, workNo,
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
}) {
  const swipe = useSwipe({ revealW: 88, enabled: !disabled });

  const label = entry.skipped ? "Skipped" : kind === "done" ? (entry.done ? "Done" : "Not Marked Yet") : formatSet(fx, entry);
  const kicker = chipKicker(entry, state, workNo);

  return (
    <div className={"task-swipe set-chip-swipe" + (swipe.dx ? " swipe-open" : "")}>
      <button className="task-del" aria-label={`Delete set ${index + 1}`} onClick={() => swipe.closeThen(onDelete)}><Trash2 className="ic" /></button>
      <div
        className={"set-chip" + (entry.skipped ? " set-chip-skipped" : "") + (entry.warmup ? " set-chip-warm" : "") + (entry.drop ? " set-chip-drop" : "") + (swipe.dragging ? " swiping" : "")}
        style={{ transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined }}
        {...swipe.handlers}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${kicker}, ${label}, tap to edit`}
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
            {last && <span className="se-chip se-chip-last"><em>Last</em>{last.replace(/^Last:\s*/, "")}</span>}</div>
          <div className="conn-name">{label}</div>
        </div>
        {pr && <span className="se-pr">PR</span>}
        {/* The chip is a door (preview anatomy): say so. */}
        {!disabled && <div className="chev" />}
      </div>
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
      <div className="grp"><div className="eyebrow">Editing {title}</div></div>
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
          <div className="se-plate-k">Per side</div>
        </div></div>
      ) : (
        // H-29 (Health Push B, 2026-09-12): a number the rack cannot build
        // says so and names the nearest it can, instead of falling silent.
        <div className="row"><div className="row-grow">
          <div className="facts">
            <span className="fact amber">{`Not buildable at ${plates.at}`}</span>
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
      <div className="row" role="button" tabIndex={0} onClick={() => onPatch({ skipped: !entry.skipped, done: false })}>
        <div className="row-grow"><div className="conn-name">{entry.skipped ? "Unskip This Set" : "Skip This Set"}</div></div>
      </div>
      {/* The door the long press used to be (see the note at the top of this
          file). A real row, so Enter and Space reach it. */}
      <div className="row" role="button" tabIndex={0} onClick={onDuplicate}>
        <div className="row-grow"><div className="conn-name">Duplicate This Set</div></div>
      </div>
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
function GhostGrid({ entry, unit, step, setNo, onLog, onDraft }: {
  entry: SetEntry;
  unit?: string;
  /** The equipment's own increment, so the field's up/down arrows move by
   *  what the rack can actually do. */
  step: number;
  setNo: number;
  onLog: (patch: Partial<SetEntry>) => void;
  onDraft?: (patch: { w: number; r: number }) => void;
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
  const [w, setW] = useState(entry.w ? String(entry.w) : "");
  const [r, setR] = useState(entry.r ? String(entry.r) : "");
  const report = (nw: string, nr: string) => onDraft?.({ w: Number(nw) || 0, r: Number(nr) || 0 });
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  // AND A PLANNED ONE IS REPLACED, NOT APPENDED TO. The other half of the
  // same complaint: a field already reading 135 put the caret at the end, so
  // typing 145 gave 135145. Focus selects, so the first keystroke overwrites
  // -- which is what tapping a number on a form has always meant.
  const selectAll = (e: { currentTarget: HTMLInputElement }) => e.currentTarget.select();
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
      <input className="set-field" type="number" inputMode="decimal" min={0} step={step} value={w} onFocus={selectAll} aria-label={`Set ${setNo} weight`} onChange={(e) => { setW(e.target.value); report(e.target.value, r); }} />
      <span className="se-grid-u">{unit ?? ""}</span>
      <input className="set-field" type="number" inputMode="numeric" min={0} step={1} value={r} onFocus={selectAll} aria-label={`Set ${setNo} reps`} onChange={(e) => { setR(e.target.value); report(w, e.target.value); }} />
      <span className="se-grid-u">reps</span>
      <button type="button" className="se-tick" aria-label={`Log set ${setNo}`} onClick={() => onLog({ w: Number(w) || 0, r: Number(r) || 0 })}><Check className="ic" /></button>
    </div>
  );
}
