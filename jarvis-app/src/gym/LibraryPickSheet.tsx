import { useState } from "react";
import { createPortal } from "react-dom";
import { searchLibrary, searchLibraryByKind, newExerciseKey, type LibraryEntry } from "./library";
import { MEASURE_LABEL, type MeasureKind } from "./types";

/**
 * THE EXERCISE LIBRARY, as a picker (catalog §3.5, §3.9). Search-as-you-type
 * over every exercise name ever used. Used by Swap (kindFilter set to the
 * exercise it is replacing, so a substitute always logs the same way) and by
 * Add Mid-Session (no kindFilter -- anything in the library is fair game).
 * Free text still works: nothing in the list matching is not an error state,
 * it is the normal way a brand-new exercise gets its first entry.
 */
export default function LibraryPickSheet({
  title, library, kindFilter, onPick, onFreeText, onCancel,
}: {
  title: string;
  library: LibraryEntry[];
  kindFilter?: MeasureKind;
  onPick: (entry: LibraryEntry) => void;
  /** Called with the typed text when nothing in the library matches and the
   *  athlete wants to use it anyway. Absent hides that path entirely. */
  onFreeText?: (query: string) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const results = kindFilter ? searchLibraryByKind(library, q, kindFilter) : searchLibrary(library, q);

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card train-skin" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{title}</div></div>
        <div className="pad-x sheet-form">
          <input
            className="input" autoFocus placeholder="Search Exercises"
            value={q} onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div><div className="list-flat">
          {results.map((entry) => (
            <div className="row" role="button" tabIndex={0} key={entry.key} onClick={() => onPick(entry)}>
              <div className="row-grow">
                <div className="conn-name truncate">{entry.name}</div>
                <div className="conn-meta">{MEASURE_LABEL[entry.kind]}</div>
              </div>
            </div>
          ))}
          {results.length === 0 && (
            <div className="pad-x"><div className="bp-sub">Nothing found yet · Keep typing or add it new</div></div>
          )}
        </div></div>
        <div className="pad-x sheet-actions">
          {onFreeText && q.trim() && (
            <button className="btn btn-secondary btn-block" onClick={() => onFreeText(q.trim())}>
              Use &ldquo;{q.trim()}&rdquo; Anyway
            </button>
          )}
          <button className="btn btn-tertiary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A fresh exerciseKey for a free-text pick that matched nothing in the
 *  library -- exported so callers (Swap, Add Mid-Session) do not each mint
 *  their own and risk drifting from how the library itself mints one. */
export { newExerciseKey };
