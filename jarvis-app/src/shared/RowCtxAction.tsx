// THE ROW'S MOMENT (Dave 2026-10-05, locked): a row whose moment has come quietly shows its ONE action on the row
// itself: a reminder that is due now shows Snooze, an overdue item shows its action. Future items show nothing. It is the
// SAME action as the row's swipe-left, so there is one verb per row. Text only, in the key colour: not a capsule (no
// pills on rows), and the only text-only action in the app. Exists only while its condition holds (`when`).
export default function RowCtxAction({ when, label, onAct, ariaLabel }: { when: boolean; label: string; onAct: () => void; ariaLabel?: string }) {
  if (!when) return null;
  return (
    <button
      type="button"
      className="row-ctx"
      aria-label={ariaLabel ?? label}
      onClick={(e) => { e.stopPropagation(); onAct(); }}
      onKeyDown={(e) => e.stopPropagation()}
    >{label}</button>
  );
}
