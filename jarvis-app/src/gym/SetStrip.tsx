import { useRef, useState } from "react";
import type { MeasureKind, SetEntry } from "./types";
import { entryNoun, fieldsFor, formatSet } from "./measures";
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
  kind, unit, timeUnit, entries, onChange, ghost, onLogGhost, disabled, prAt,
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
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const fields = fieldsFor(kind);
  const fx = { kind, unit, timeUnit };

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
                onToggle={() => setOpenId(openId === id ? null : id)}
                onDelete={() => remove(id)}
                onDuplicate={() => duplicate(id)}
              />
              {openId === id && !disabled && (
                <SetChipEditor kind={kind} fields={fields} entry={e} onPatch={(p) => patch(id, p)} />
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
          {ghost.map((g, i) => (
            <div className="row set-chip-ghost" role="button" tabIndex={0} key={g.id}
              onClick={() => onLogGhost?.(i)}>
              <div className="row-grow">
                <div className="eyebrow">Not Logged Yet</div>
                <div className="conn-name">{kind === "done" ? "Mark Done" : formatSet(fx, g)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SetChipRow({
  index, entry, kind, fx, open, disabled, pr, onToggle, onDelete, onDuplicate,
}: {
  index: number;
  entry: SetEntry;
  kind: MeasureKind;
  fx: { kind: MeasureKind; unit?: string; timeUnit?: string };
  open: boolean;
  disabled: boolean;
  pr?: boolean;
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

  return (
    <div className="task-swipe set-chip-swipe">
      <button className="task-del" aria-label={`Delete set ${index + 1}`} onClick={() => swipe.closeThen(onDelete)}><Trash2 className="ic" /></button>
      <div
        className={"set-chip" + (entry.skipped ? " set-chip-skipped" : "") + (swipe.dragging ? " swiping" : "")}
        style={{ transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined }}
        {...swipe.handlers}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`Set ${index + 1}, ${label}, tap to edit, hold to duplicate`}
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
          <div className="eyebrow">Set {index + 1}</div>
          <div className="conn-name">{label}</div>
        </div>
        {pr && <span className="pill pill-good">PR</span>}
      </div>
    </div>
  );
}

function SetChipEditor({ kind, fields, entry, onPatch }: {
  kind: MeasureKind;
  fields: ReturnType<typeof fieldsFor>;
  entry: SetEntry;
  onPatch: (p: Partial<SetEntry>) => void;
}) {
  return (
    <div className="set-chip-editor">
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
      <div className="row" role="button" tabIndex={0} onClick={() => onPatch({ skipped: !entry.skipped, done: false })}>
        <div className="row-grow"><div className="conn-name">{entry.skipped ? "Unskip This Set" : "Skip This Set"}</div></div>
      </div>
    </div>
  );
}
