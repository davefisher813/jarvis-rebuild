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
// SHARED-F-18 (2026-09-05): the `count` prop went. It rendered "N more are
// waiting for next time" and no list ever passed it, so the branch was
// unreachable, and both places that reached for it landed somewhere better
// on their own:
//
//   - MessagesFlow.tsx:3646 carried count={restCount} once and dropped it,
//     because those 27 were The Rest, a different list a scroll below. A
//     floor may only count what it is the floor OF.
//   - The mail list, which really is a slice, answers with words and a way
//     forward instead of a number (EMAIL-F-18): "Showing what's loaded so
//     far." over a Load More, which is also the only way to reach thread 31.
//     A residual count with no way to act on it is the pile in a smaller
//     hat, which is exactly what L2 exists to stop.
//
// So a truncated list overrides the words through `children` and offers the
// rest; a complete one says "That's everything." Those are the two cases.
export default function ListFloor({ children }: {
  /** Override the words. Used when the list is a slice of something larger,
   *  in which case the override must also offer the way to the rest. */
  children?: React.ReactNode;
}) {
  return <div className="list-floor">{children ?? "That's everything."}</div>;
}
