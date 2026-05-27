const BACK = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>;
import { useRef } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
const CHEV = <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>;

export default function AboutPage({ onBack, onTerms, onPrivacy, onSupport, onSecret }: { onBack: () => void; onTerms?: () => void; onPrivacy?: () => void; onSupport?: () => void; onSecret?: () => void }) {
  const taps = useRef(0);
  const bump = () => { taps.current += 1; if (taps.current >= 5) { taps.current = 0; onSecret?.(); } };
  return (
    <div className="screen">
      <LargeTitleNav title="About" back="Settings" onBack={onBack} />
      <div className="pad-x"><div className="card about-hero">
        <div className="brand-mark"><span className="j">J</span>ARVIS</div>
        <div className="account-sub" onClick={bump}>Version 1.0</div>
      </div></div>
      <div className="grp"><div className="eyebrow">Legal</div></div>
      <div className="pad-x"><div className="card">
        <div className="row" role="button" tabIndex={0} onClick={onTerms}><div className="row-grow"><div className="conn-name">Terms of Service</div></div>{CHEV}</div>
        <div className="row" role="button" tabIndex={0} onClick={onPrivacy}><div className="row-grow"><div className="conn-name">Privacy Policy</div></div>{CHEV}</div>
        <div className="row" role="button" tabIndex={0} onClick={onSupport}><div className="row-grow"><div className="conn-name">Support</div></div>{CHEV}</div>
      </div></div>
    </div>
  );
}
