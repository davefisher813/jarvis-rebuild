import type { HTMLAttributes, ReactNode } from "react";
import { useSwipe } from "./useSwipe";
import { useRowMenu } from "./useRowMenu";
import type { RowAction } from "./RowActionSheet";
import { Check, Trash2 } from "./icons";

// A RULED ROW THAT SWIPES, FOR LISTS THAT HAD NO GESTURE (Dave 2026-10-13: "Virtually everything should be swipeable. It should
// be the standard."). The task row's own gesture, lifted out so a list of steps or milestones wears it too: swipe right completes
// (the green rail), swipe left reveals Delete, a held row opens the same two as a menu, and a tap opens the row, or closes the
// tray if it is showing. The gesture math is shared/useSwipe's and the held-row menu is shared/useRowMenu's; nothing here reads
// a touch coordinate. The moving element is the row itself (a `.task-row`, which is where `touch-action: pan-y` lives).
export default function RuledSwipe({ label, className, onRight, rightLabel = "Done", onDelete, onOpen, rowProps, children }: {
  /** What the row is, for the buttons' accessible names and the held menu's title. */
  label: string;
  /** The row's classes, e.g. "task-row p2 proj-step". */
  className: string;
  /** Swipe right: the row's complete. Absent, the row cannot move right. */
  onRight?: () => void;
  rightLabel?: string;
  /** Swipe left: Delete. The caller owns the Undo. Absent, there is no tray. */
  onDelete?: () => void;
  onOpen?: () => void;
  /** Anything else the plain row carried (role, tabIndex, onKeyDown, aria-*). */
  rowProps?: Omit<HTMLAttributes<HTMLDivElement>, "className" | "style" | "onClick">;
  children: ReactNode;
}) {
  const swipeable = !!onRight || !!onDelete;
  const actions: RowAction[] = [
    ...(onRight ? [{ label: rightLabel, onPick: onRight }] : []),
    ...(onDelete ? [{ label: "Delete", destructive: true, onPick: onDelete }] : []),
  ];
  const rowMenu = useRowMenu({ title: label, actions, swipeEnabled: swipeable });
  const swipe = useSwipe({
    revealW: onDelete ? 88 : 0,
    rightW: onRight ? 88 : 0,
    ...(onRight ? { onRightCommit: onRight } : {}),
    enabled: swipeable,
    onLongPress: rowMenu.onLongPress,
  });
  const { handlers, sheet } = rowMenu.bind(swipe);
  if (!swipeable) return <div className={className} {...rowProps} onClick={onOpen}>{children}</div>;
  return (
    <div className="task-swipe">
      {onRight && (
        <div className="task-done-rail" aria-hidden="true">
          <Check className="ic" />
          <span className="swipe-label">{rightLabel}</span>
        </div>
      )}
      {onDelete && (
        <button className="task-del" aria-label={"Delete " + label} onClick={() => swipe.closeThen(onDelete)}>
          <Trash2 className="ic" />
          <span className="swipe-label">Delete</span>
        </button>
      )}
      <div
        {...rowProps}
        {...handlers}
        className={"task-row " + className + (swipe.dragging ? " swiping" : "")}
        style={swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : undefined}
        onClick={() => { if (swipe.open || swipe.dx) { swipe.closeThen(); return; } onOpen?.(); }}
      >
        {children}
      </div>
      {sheet}
    </div>
  );
}
