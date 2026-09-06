import LegalScreen from "./LegalScreen";
import LegalBody from "../legal/Body";
import { TERMS } from "../legal/content";

// UP-LAUNCH-05 (2026-09-05): one source, in src/legal/content.ts, rendered
// here and generated into public/terms.html. See PrivacyPage for the why.
export default function TermsPage({ onBack, back }: { onBack: () => void; back?: string }) {
  return (
    <LegalScreen title={TERMS.title} updated={TERMS.updated} onBack={onBack} back={back}>
      <LegalBody doc={TERMS} />
    </LegalScreen>
  );
}
