// AN EMPTY STATE WITH ITS ACTION (law L7: no dead ends). The Email tab has
// several, never two at once: no mailbox, nothing in the inbox, nothing
// under an area, nothing waiting, no match, a search that failed. One shape
// for all of them, and one filled primary on the screen, which is its action.

export default function EmptyState({ copy, onAction }: {
  copy: { title: string; sub: string; action: string };
  onAction: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-title">{copy.title}</div>
      <div className="empty-sub">{copy.sub}</div>
      <button className="btn btn-primary" onClick={onAction}>{copy.action}</button>
    </div>
  );
}
