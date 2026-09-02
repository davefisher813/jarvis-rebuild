import type { ReactNode } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";

export default function LegalScreen({ title, updated, children, onBack }: { title: string; updated?: string; children: ReactNode; onBack: () => void }) {
  return (
    <div className="screen ruled">
      <LargeTitleNav title={title} back="About" onBack={onBack} />
      <div className="pad-x"><div className="legal-note">Template copy. Replace with your legal-reviewed text before launch.</div></div>
      {updated && <div className="pad-x"><div className="legal-updated">Last updated {updated}</div></div>}
      <div className="pad-x"><div className="card list-card-ruled legal-card"><div className="legal-body">{children}</div></div></div>
      <div className="screen-foot" />
    </div>
  );
}
