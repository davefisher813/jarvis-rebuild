// THE ROW'S MOMENT (Dave 2026-10-05, locked): a row whose moment has come quietly shows its ONE action on the row
// itself: a reminder that is due now shows Snooze, an overdue item shows its action. Future items show nothing. It is the
// SAME action as the row's swipe-left, so there is one verb per row. Text only, in the key colour: not a capsule (no
// pills on rows), and the only text-only action in the app. Exists only while its condition holds (`when`).
// `selected` is for a quick-pick that states the row's CURRENT value as well as offering a move (Edit Event's Today and Tomorrow): the
// one that matches the value says so (aria-pressed, plain ink instead of the tint), so a chip can never read as selected while the
// field beside it says something else. Absent, the action is exactly what it was.
export default function RowCtxAction({ when, label, onAct, ariaLabel, selected }: { when: boolean; label: string; onAct: () => void; ariaLabel?: string; selected?: boolean }) {
  if (!when) return null;
  return (
    <button
      type="button"
      className="row-ctx"
      aria-label={ariaLabel ?? label}
      {...(selected === undefined ? {} : { "aria-pressed": selected })}
      onClick={(e) => { e.stopPropagation(); if (!selected) onAct(); }}
      onKeyDown={(e) => e.stopPropagation()}
    >{label}</button>
  );
}
