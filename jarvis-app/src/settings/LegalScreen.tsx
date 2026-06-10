import type { ReactNode } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";

// Shared layout for Terms / Privacy / Support. The body text is template copy:
// it gives the right structure but MUST be replaced with legal-reviewed wording
// before App Store submission.
export default function LegalScreen({ title, updated, children, onBack }: { title: string; updated?: string; children: ReactNode; onBack: () => void }) {
  return (
    <div className="screen">
      <LargeTitleNav title={title} back="About" onBack={onBack} />
      <div className="pad-x"><div className="legal-note">Template copy. Replace with your legal-reviewed text before launch.</div></div>
      {updated && <div className="pad-x"><div className="legal-updated">Last updated {updated}</div></div>}
      <div className="pad-x legal-body">{children}</div>
    </div>
  );
}
