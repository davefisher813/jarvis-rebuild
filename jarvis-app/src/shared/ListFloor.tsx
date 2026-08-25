// L2: EVERY LIST HAS A FLOOR (Dave 2026-08-25, the Anti-Inbox catalog,
// adopted as law).
//
// "The pile is infinite. Open loops sit in working memory and hum. An inbox
// with no floor is a room where every undone thing is visible at once."
//
// An edge you can reach is the difference between a task and an ocean. Every
// list in email ends with a line that says so, out loud, so scrolling has a
// bottom you can SEE rather than one you have to discover by exhaustion.
//
// The words matter as much as the line. "That's everything." is a statement
// about the world, not about the software: it does not say "end of list" or
// "no more items", which describe a data structure rather than answering the
// question the person is actually asking, which is "am I done?"
export default function ListFloor({ children, count }: {
  /** Override the words. Used when the list is a slice of something larger. */
  children?: React.ReactNode;
  /** When some of the list is deliberately not shown, say how many and why. */
  count?: number;
}) {
  return (
    <div className="list-floor">
      {children ?? (count && count > 0
        // Never a bare number: a residual count with no explanation is the
        // pile wearing a smaller hat.
        ? count + (count === 1 ? " more is waiting for next time" : " more are waiting for next time")
        : "That's everything.")}
    </div>
  );
}
