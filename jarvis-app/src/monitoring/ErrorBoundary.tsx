import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureError } from "./monitor";

// Catches render-time crashes anywhere below it, reports them through the
// monitor seam, and shows a recoverable fallback instead of a white screen.
//
// `onFail` + `fallback` make it a LOCAL boundary for an overlay (Quick Capture,
// Search): those mount outside the tab boundary, so before this a chunk or
// render failure inside one bubbled to the root card ("Unexpected Error,
// Reload Fixes It") on the very first tap (audit 2026-09-29). With onFail the
// caller closes the overlay and says so; the rest of the app stays up.
export default class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode; onFail?: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureError(error, { componentStack: info.componentStack });
    this.props.onFail?.(error);
  }

  render(): ReactNode {
    if (this.state.failed) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return <FailedCard sub="Unexpected Error · Reload Fixes It" actionLabel="Reload" onAction={() => location.reload()} />;
    }
    return this.props.children;
  }
}

// The recoverable card itself, shared so a failure that is not a render
// crash (SHELL-F-13: the launch gate's profile read) wears the same face
// instead of a blank screen. The title is fixed; the caller owns the
// reason and the way out.
export function FailedCard({ sub, actionLabel, onAction }: { sub: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="screen">
      <div className="empty-state">
        <div className="empty-title">Something Went Wrong</div>
        <div className="empty-sub">{sub}</div>
        <button className="btn btn-primary" onClick={onAction}>{actionLabel}</button>
      </div>
    </div>
  );
}
