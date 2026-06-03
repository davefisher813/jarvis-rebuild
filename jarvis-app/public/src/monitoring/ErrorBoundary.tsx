import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureError } from "./monitor";

// Catches render-time crashes anywhere below it, reports them through the
// monitor seam, and shows a recoverable fallback instead of a white screen.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureError(error, { componentStack: info.componentStack });
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="screen">
          <div className="empty-state">
            <div className="empty-title">Something went wrong</div>
            <div className="empty-sub">The app hit an unexpected error. Reloading usually fixes it.</div>
            <button className="btn btn-primary" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
