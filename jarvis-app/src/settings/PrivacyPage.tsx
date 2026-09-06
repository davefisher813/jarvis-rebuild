import LegalScreen from "./LegalScreen";
import LegalBody from "../legal/Body";
import { PRIVACY } from "../legal/content";

// UP-LAUNCH-05 (2026-09-05): the words moved to src/legal/content.ts, which
// public/privacy.html is now generated from. SHELL-F-19 hand-copied the
// reviewed web text into this file to close a gap that had already opened
// once; a second hand copy would have opened it again the first time either
// side was edited alone.
export default function PrivacyPage({ onBack, back }: { onBack: () => void; back?: string }) {
  return (
    <LegalScreen title={PRIVACY.title} updated={PRIVACY.updated} onBack={onBack} back={back}>
      <LegalBody doc={PRIVACY} />
    </LegalScreen>
  );
}
