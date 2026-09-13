import { useOptionalStrands } from "../data/NotesProvider";
import { todayISO } from "../ai/useAIContext";
import { useStarLink } from "../brain/strands/stars";
import { showToast } from "../shared/toast";
import { haptics } from "../shared/haptics";

// THE REMEMBER STAR ON AN ENTITY ROW (C-50 elsewhere, Astra, 2026-09-12).
// Mail, task, event, people and decision rows, and an AI answer in Chat:
// a 16px outline star at the leading edge, filled yellow while a strand
// linked to the row's entity exists. Tap writes a told-rank strand of type
// fact whose text is the row's title, with the entity linked; a second tap
// removes it. Receipt with Undo either way. It is not the row's control
// (astra law 3), so it stops the row's own tap and takes none of its slot.
//
// Renders nothing outside a strand store: a row that cannot be remembered
// does not show a star that would only refuse.
export default function EntityStar({ entityType, entityId, title }: { entityType: string; entityId: string; title: string }) {
  const svc = useOptionalStrands();
  const { on, toggle } = useStarLink(svc, entityType, entityId, todayISO());
  if (!svc) return null;
  const tap = async () => {
    haptics.selection();
    const r = await toggle(title.trim().slice(0, 140));
    if (r === "starred") showToast({ message: "JARVIS will remember that", actionLabel: "Undo", onAction: () => void toggle(title) });
    else if (r === "unstarred") showToast({ message: "Forgotten", actionLabel: "Undo", onAction: () => void toggle(title) });
    else if (r === "full") showToast({ message: "The Brain is full · Prune it in What JARVIS Knows" });
    else showToast({ message: "Couldn't save · Try again" });
  };
  return (
    <button
      type="button"
      className={"row-star" + (on ? " on" : "")}
      aria-pressed={on}
      aria-label={on ? "Forget this" : "Remember this"}
      onClick={(ev) => { ev.stopPropagation(); void tap(); }}
      onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") ev.stopPropagation(); }}
    >
      <svg className="ic" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round">
        <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" />
      </svg>
    </button>
  );
}
