import { useRef } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { pressable } from "../shared/pressable";
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
        {/* SHELL-F-26 (2026-09-05): this read "Version 1.0" forever, on every
            build, while Settings > Advanced showed the real one two taps
            away. There is no version number to show (package.json has none),
            so it shows what actually identifies a build, the same stamp
            Advanced shows. Still the door to the test bench at five taps. */}
        {/* Slice 09 QA (2026-10-04): fifteen taps on an iPhone opened nothing. The cause was
            MoreFlow, not this line: the door was wired only once the admin probe had already
            answered yes, so taps before that answer, or in a session where it failed, went
            nowhere. The line is also a full control now (role, tab stop, Enter and Space) with
            a 44px-class tap area, which is what pressable() is for. */}
        <div className="account-sub about-build" {...pressable(bump)}>
          {typeof __BUILD_ID__ === "string" ? <><span className="fact">{`Build ${__BUILD_ID__}`}</span>{" "}<span className="fact date">{__BUILD_DATE__}</span></> : "Build dev"}
        </div>
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
