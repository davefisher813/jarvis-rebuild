import { ChevronLeft } from "../shared/icons";
import { useNavOrigin } from "./navOrigin";

// THE WAY HOME, FOR EVERYTHING ELSE (Dave 2026-09-22: "make sure all modals
// and screens no matter where they are get addressed").
//
// The audit of the modals came back clean on the thing it was looking for:
// all sixty render sites have BOTH a scrim tap and a Cancel, so no sheet in
// the app is a dead end. The gap is what happens after one closes.
//
// A sheet's Cancel means "close this sheet" and leave you on the page behind
// it. That is correct and must not change -- a Cancel that changed tabs would
// be a worse version of the bug we just fixed. But when a cross-tab jump is
// what opened the sheet (a search hit opening a task, a notice opening an
// event), the page behind it is a tab you never chose, and closing the sheet
// leaves you standing in it with no way back.
//
// So: one pill, drawn by the shell, while a jump is live. It covers every
// modal and every screen at once, including the ones written tomorrow, which
// is the only way "no matter where they are" can be true. A page whose own
// back already offers the way home CLAIMS the origin (navOrigin's useLeaveVia)
// and this stands down, so there are never two backs on one screen.
//
// It sits above the tab bar rather than in a nav bar, because there is no nav
// bar it could sit in that every one of these surfaces has.
// IT TAKES ITS OWN ROOM (Dave 2026-10-05, "everything should look PERFECT"; decision D6: floating chrome never covers
// content). It used to be position: fixed over the foot of the scroll box, with the shell measuring the dock to sit above
// it (--return-clear) and padding the scroll box so the LAST row could scroll clear (--return-pad). That kept the pill off
// the last row and nowhere else: at rest, with the page at its top, it sat on whatever row happened to be there, so
// "Clean Out" read "ean Out", the foot of the Health goal card was hidden, and "SUN 11" lost its left edge. A pill that
// floats over a scroller covers something on every screen that has a row at that height, which is all of them.
//
// It is a row of the shell's own column now, between the scroll box and the capture bar (the toast, when there is one,
// sits above it, so the pill is out of the toast's way by order). The scroll box is exactly as much shorter as the pill
// is tall while a jump is live, and not one pixel otherwise. Nothing measures, nothing publishes, and nothing is under it.
export default function ReturnPill() {
  const nav = useNavOrigin();
  if (!nav.origin || nav.claimed) return null;
  return (
    <button type="button" className="return-pill" onClick={() => nav.back()}>
      <ChevronLeft className="ic" />
      {nav.origin.label}
    </button>
  );
}
