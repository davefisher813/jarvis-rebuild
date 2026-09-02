import { useRef } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Head, Card, Row } from "./kit";

export default function AboutPage({ onBack, onTerms, onPrivacy, onSupport, onSecret }: { onBack: () => void; onTerms?: () => void; onPrivacy?: () => void; onSupport?: () => void; onSecret?: () => void }) {
  // Five taps on the version opens the test bench, the way every phone
  // hides its developer door behind the build number.
  const taps = useRef(0);
  const bump = () => { taps.current += 1; if (taps.current >= 5) { taps.current = 0; onSecret?.(); } };
  return (
    <div className="screen ruled">
      <LargeTitleNav title="About" back="Settings" onBack={onBack} />
      <div className="pad-x"><div className="card list-card-ruled set-card about-hero">
        <div className="brand-mark"><span className="j">J</span>ARVIS</div>
        <div className="account-sub" onClick={bump}>Version 1.0</div>
      </div></div>
      <Head label="Legal" />
      <Card>
        <Row label="Terms of Service" onClick={onTerms} chev />
        <Row label="Privacy Policy" onClick={onPrivacy} chev />
        <Row label="Support" onClick={onSupport} chev />
      </Card>
      <div className="screen-foot" />
    </div>
  );
}
