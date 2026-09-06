import LegalScreen from "./LegalScreen";
import LegalBody from "../legal/Body";
import { SUPPORT } from "../legal/content";

// UP-LAUNCH-05 (2026-09-05): one source, in src/legal/content.ts, rendered
// here and generated into public/support.html. The support address lives
// there too, so the app and the published page cannot give out different
// ones.
export default function SupportPage({ onBack, back }: { onBack: () => void; back?: string }) {
  return (
    <LegalScreen title={SUPPORT.title} onBack={onBack} back={back}>
      <LegalBody doc={SUPPORT} />
    </LegalScreen>
  );
}
