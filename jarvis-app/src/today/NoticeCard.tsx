import type { ReactNode } from "react";
import { useSwipe } from "../shared/useSwipe";

// THE NOTICE LAW (A1, approved by Dave 2026-08-20).
//
// Every card in Heads Up is built exactly one way, so the stream can never
// drift into nine different shapes again:
//
//   colored glyph · the words · EXACTLY ONE control on the visible line
//
// The control is a pill when the notice does something, or a chevron when the
// whole row opens a screen. Dismiss is a swipe, never a corner ×: on a
// one-row card the corner and the row's right edge are the same place, and
// two tap targets stacked on each other is how you hit the wrong one.
//
// An alternate choice (Still Good / Change It) rides the same reveal as
// Dismiss. The primary is always the one you can see and tap without
// deciding, which is the entire point of the button work.

export interface NoticeAction {
  label: string;
  onClick: () => void;
}

export default function NoticeCard({
  icon,
  tone,
  title,
  sub,
  action,
  alt,
  onDismiss,
  onOpen,
  foot,
}: {
  icon: ReactNode;
  // A cat-fg-* class. Color is the notice's category, never decoration.
  tone?: string;
  title: ReactNode;
  sub?: ReactNode;
  // The one visible control. Omit it and the row opens (chevron) instead.
  action?: NoticeAction;
  // The second path, on the swipe reveal beside Dismiss.
  alt?: NoticeAction;
  onDismiss?: () => void;
  onOpen?: () => void;
  // Extra rows below the main line, inside the same card (the email stack).
  foot?: ReactNode;
}) {
  const acts = (alt ? 1 : 0) + (onDismiss ? 1 : 0);
  const swipe = useSwipe({ revealW: acts * 88, enabled: acts > 0 });

  return (
    <div className="pad-x">
      <div className="notice-swipe">
        {alt && (
          <button
            className={"notice-alt" + (onDismiss ? " beside-dismiss" : "")}
            onClick={() => swipe.closeThen(alt.onClick)}
          >
            {alt.label}
          </button>
        )}
        {onDismiss && (
          <button className="notice-dismiss" onClick={() => swipe.closeThen(onDismiss)}>
            Dismiss
          </button>
        )}
        <div
          className={"card notice-card" + (swipe.dragging ? " swiping" : "")}
          style={{ transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined }}
          {...swipe.handlers}
        >
          <div
            className="row"
            role={onOpen ? "button" : undefined}
            tabIndex={onOpen ? 0 : undefined}
            onClick={onOpen}
          >
            <div className={"row-glyph " + (tone ?? "cat-fg-red")}>{icon}</div>
            <div className="row-grow">
              <div className="conn-name">{title}</div>
              {sub && <div className="conn-meta">{sub}</div>}
            </div>
            {action ? (
              <button
                className="pill-act"
                onClick={(e) => { e.stopPropagation(); action.onClick(); }}
              >
                {action.label}
              </button>
            ) : onOpen ? (
              <div className="chev" />
            ) : null}
          </div>
          {foot}
        </div>
      </div>
    </div>
  );
}
