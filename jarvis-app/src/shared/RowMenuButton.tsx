import { Ellipsis } from "./icons";

/**
 * ONE VISIBLE DOOR TO A ROW'S MENU (GYM-F-26, 2026-09-05).
 *
 * Catalog §3.12 made long-press the whole menu, so nothing on a row hinted
 * that a menu existed and no keyboard or VoiceOver user could reach it at all
 * (shared/useLongPress.ts is pointer, touch and contextmenu only). This is the
 * same trailing control on every row that has one, opening the same
 * ActionSheet. A real button, so Enter and Space are free and the label is
 * announced.
 *
 * It is quiet on purpose: a way IN, not an action, so it never wears the tint
 * .pill-act does. RED IS A VERB.
 *
 * SHARED (2026-09-16, the health polish pass). It lived inside GymFlow, and
 * All Data needed the same door when its Delete came off the row -- the
 * handoff's rule: "Delete moves into entry options... Do not expose accidental
 * destructive pills in browsing lists." Two copies of one control is what
 * section 0 forbids, so it lives here and both screens read it.
 */
export default function RowMenuButton({ onMenu, what }: { onMenu: () => void; what: string }) {
  return (
    <button
      className="row-menu-btn"
      aria-label={`More Actions for ${what}`}
      onClick={(e) => { e.stopPropagation(); onMenu(); }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Ellipsis className="ic" />
    </button>
  );
}
