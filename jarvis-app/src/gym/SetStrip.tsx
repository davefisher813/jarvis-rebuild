import { useRef, useState } from "react";
import type { MeasureKind, SetEntry } from "./types";
import { entryNoun, fieldsFor, formatSet } from "./measures";
import { plateLine } from "./ramp";
import { readGymSettings, rackFrom } from "./settings";
import { duplicateEntry, blankEntry } from "./strip";
import ReorderList from "../shared/ReorderList";
import { useSwipe } from "../shared/useSwipe";
import Stepper from "../shared/Stepper";
import { Trash2 } from "../shared/icons";

const LONG_PRESS_MS = 550;

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
  kind, unit, timeUnit, entries, onChange, ghost, onLogGhost, disabled, prAt, moveTracking, lastFor, onMatchLast,
}: {
  kind: MeasureKind;
  unit?: string;
  timeUnit?: string;
  entries: SetEntry[];
  onChange: (next: SetEntry[]) => void;
  /** Planned sets not yet logged (live session only): shown as unfilled
   *  chips after the filled ones. Tap to log exactly that plan. */
  ghost?: SetEntry[];
  onLogGhost?: (ghostIdx: number) => void;
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
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const fields = fieldsFor(kind);
  const fx = { kind, unit, timeUnit };
  // PLATE MATH (D8-A): the athlete's own bar and rack, so an open chip can
  // say what to load instead of making them do arithmetic on a gym floor.
  const rack = rackFrom(readGymSettings());

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
        renderRow={(id) => {
          const i = entries.findIndex((x) => x.id === id);
          const e = entries[i];
          if (!e) return null;
          return (
            <div className="row-grow set-chip-col">
              <SetChipRow
                index={i}
                entry={e}
                kind={kind}
                fx={fx}
                open={openId === id}
                disabled={!!disabled}
                pr={!!prAt?.(i)}
                last={lastFor?.(i) ?? null}
                onToggle={() => setOpenId(openId === id ? null : id)}
                onDelete={() => remove(id)}
                onDuplicate={() => duplicate(id)}
              />
              {openId === id && !disabled && (
                <SetChipEditor kind={kind} fields={fields} entry={e} onPatch={(p) => patch(id, p)} moveTracking={moveTracking}
                  plates={kind === "weight_reps" && unit !== "kg" ? plateLine(e.w ?? 0, rack.bar, rack.plates) : null} />
              )}
            </div>
          );
        }}
      />
      {!disabled && (
        <button className="row row-act set-strip-add" onClick={add}>Add {entryNoun(kind, false)}</button>
      )}
      {ghost && ghost.length > 0 && (
        <div className="set-strip-ghosts">
          {ghost.map((g, i) => {
            const pos = entries.length + i;
            const lastText = lastFor?.(pos) ?? null;
            return (
              <div className="row set-chip-ghost" role="button" tabIndex={0} key={g.id}
                onClick={() => onLogGhost?.(i)}>
                <div className="row-grow">
                  <div className="eyebrow">Not Logged Yet</div>
                  <div className="conn-name">{kind === "done" ? "Mark Done" : formatSet(fx, g)}</div>
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
    </div>
  );
}

function SetChipRow({
  index, entry, kind, fx, open, disabled, pr, last, onToggle, onDelete, onDuplicate,
}: {
  index: number;
  entry: SetEntry;
  kind: MeasureKind;
  fx: { kind: MeasureKind; unit?: string; timeUnit?: string };
  open: boolean;
  disabled: boolean;
  pr?: boolean;
  /** D2: "Last: 250 × 3", quiet reference under the chip's own numbers. */
  last?: string | null;
  onToggle: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const swipe = useSwipe({ revealW: 88, enabled: !disabled });
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedLongPress = useRef(false);
  const startXY = useRef<{ x: number; y: number } | null>(null);

  const clearPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };

  const label = entry.skipped ? "Skipped" : kind === "done" ? (entry.done ? "Done" : "Not Marked Yet") : formatSet(fx, entry);
  // A ramp set is real work but not the work: it says so, and it counts
  // toward nothing (D3-A).
  const kicker = entry.warmup ? "Warm-Up" : `Set ${index + 1}`;

  return (
    <div className="task-swipe set-chip-swipe">
      <button className="task-del" aria-label={`Delete set ${index + 1}`} onClick={() => swipe.closeThen(onDelete)}><Trash2 className="ic" /></button>
      <div
        className={"set-chip" + (entry.skipped ? " set-chip-skipped" : "") + (entry.warmup ? " set-chip-warm" : "") + (swipe.dragging ? " swiping" : "")}
        style={{ transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined }}
        {...swipe.handlers}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${kicker}, ${label}, tap to edit, hold to duplicate`}
        onPointerDown={disabled ? undefined : (e) => {
          startXY.current = { x: e.clientX, y: e.clientY };
          firedLongPress.current = false;
          clearPress();
          pressTimer.current = setTimeout(() => { firedLongPress.current = true; onDuplicate(); }, LONG_PRESS_MS);
        }}
        onPointerMove={(e) => {
          const s = startXY.current;
          if (!s) return;
          if (Math.abs(e.clientX - s.x) > 10 || Math.abs(e.clientY - s.y) > 10) clearPress();
        }}
        onPointerUp={clearPress}
        onPointerLeave={clearPress}
        onClick={() => {
          if (firedLongPress.current) { firedLongPress.current = false; return; }
          if (!disabled) onToggle();
        }}
      >
        <div className="row-grow">
          <div className="eyebrow">{kicker}</div>
          <div className="conn-name">{label}</div>
          {last && <div className="conn-meta">{last}</div>}
        </div>
        {pr && <span className="pill pill-good">PR</span>}
      </div>
    </div>
  );
}

const MOVED_OPTIONS: { value: "clean" | "grind" | "missed"; label: string }[] = [
  { value: "clean", label: "All Clean" },
  { value: "grind", label: "Last One Was a Grind" },
  { value: "missed", label: "Missed One" },
];
// A warm-up is supposed to move well, so marking one says nothing about the
// work and the progression engine ignores it (D6). No chips on a ramp set.

function SetChipEditor({ kind, fields, entry, onPatch, moveTracking, plates }: {
  kind: MeasureKind;
  fields: ReturnType<typeof fieldsFor>;
  entry: SetEntry;
  onPatch: (p: Partial<SetEntry>) => void;
  moveTracking?: boolean;
  /** PLATE MATH (D8-A): what goes on each side, or null when this rack
   *  cannot build the number exactly -- silence beats a wrong answer. */
  plates?: string | null;
}) {
  return (
    <div className="set-chip-editor">
      {plates && !entry.skipped && (
        <div className="row"><div className="row-grow">
          <div className="conn-name">{plates}</div>
          <div className="conn-meta">Per side</div>
        </div></div>
      )}
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
      {moveTracking && !entry.skipped && !entry.warmup && (
        <div className="field">
          <div className="input-label">How Did It Move?</div>
          <div className="chip-row chip-wrap-row">
            {MOVED_OPTIONS.map((o) => (
              <div key={o.value} className={"chip" + (entry.moved === o.value ? " active" : "")} role="button" tabIndex={0}
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
    </div>
  );
}
