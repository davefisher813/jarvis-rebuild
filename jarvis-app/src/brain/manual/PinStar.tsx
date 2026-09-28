import { haptics } from "../../shared/haptics";
import { useBrainMemory } from "../../data/NotesProvider";
import { attemptWrite } from "../../shared/guard";
import type { BrainMemoryRow } from "../../ai/brainMemory";

/** The pin on a memory row: the row's own pinned flag, not the strand
 *  remember-star (that one files a told-rank strand; this one just floats
 *  the row to the top of its list). It leads the row, ahead of the title,
 *  and its tap never leaks to the row's own door. */
export function PinStar({ row, onToggled }: { row: BrainMemoryRow; onToggled: () => void }) {
  const svc = useBrainMemory();
  const on = !!row.data.pinned;
  const tap = async () => {
    haptics.selection();
    const ok = await attemptWrite(() => svc.setPinned(row.id, !on));
    if (ok) onToggled();
  };
  return (
    <button
      type="button"
      className={"row-star" + (on ? " on" : "")}
      aria-pressed={on}
      aria-label={on ? "Unpin" : "Pin to Top"}
      onClick={(ev) => { ev.stopPropagation(); void tap(); }}
      onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") ev.stopPropagation(); }}
    >
      <svg className="ic" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round">
        <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" />
      </svg>
    </button>
  );
}
