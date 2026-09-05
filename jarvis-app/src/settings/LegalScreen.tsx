import type { ReactNode } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";

export default function LegalScreen({ title, updated, children, onBack }: { title: string; updated?: string; children: ReactNode; onBack: () => void }) {
  return (
    <div className="screen ruled">
      <LargeTitleNav title={title} back="About" onBack={onBack} />
      {/* SHELL-F-19 (2026-09-05): the banner that used to sit here read
          "Template copy. Replace with your legal-reviewed text before
          launch." on every legal screen, including the two reachable from
          Sign In before an account exists. The three screens carry the
          reviewed text from public/ now, so there is nothing to warn about. */}
      {updated && <div className="pad-x"><div className="legal-updated">Last updated {updated}</div></div>}
      <div className="pad-x"><div className="card list-card-ruled legal-card"><div className="legal-body">{children}</div></div></div>
      <div className="screen-foot" />
    </div>
  );
}
