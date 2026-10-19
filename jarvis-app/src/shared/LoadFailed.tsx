// THE FIRST LOAD FAILED: ONE CRAFTED STATE, NOT A BLANK (the research standard, section 5 rule 18, 2026-10-19: "crafted empty, loading and error states").
// A screen whose first read failed with nothing to show used to draw its zeros, or nothing, as if the account were empty: a person with a thousand
// transactions saw $0.00. This is the one answer, the app's own empty state with its action (law L7: no dead ends): what could not be read, the reason in
// two plain words, and Retry as the screen's one filled primary. A refresh that fails with data on screen keeps the data and is not this.
export default function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return (
    <div className="empty-state" role="alert">
      <div className="empty-title">{`Couldn't Load ${what}`}</div>
      <div className="empty-sub">{offline ? "You're Offline" : "Check Your Connection"}</div>
      <button className="btn btn-primary" onClick={onRetry}>Retry</button>
    </div>
  );
}
