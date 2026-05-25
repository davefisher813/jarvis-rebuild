import { useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
const BACK = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>;

export default function AdvancedPage({ onBack }: { onBack: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="screen">
      <LargeTitleNav title="Advanced" back="Settings" onBack={onBack} />
      <div className="grp"><div className="eyebrow">Data</div></div>
      <div className="pad-x"><div className="card">
        <div className="row" role="button" tabIndex={0}><div className="row-grow"><div className="conn-name">Export data</div></div><span className="row-value">JSON</span></div>
      </div></div>
      <div className="pad-x"><div className="card">
        {!confirm
          ? <button className="row row-signout" onClick={() => setConfirm(true)}>Clear local data</button>
          : <button className="row row-signout" onClick={() => { try { localStorage.clear(); } catch { /* ignore */ } location.reload(); }}>Tap again to confirm</button>}
      </div></div>
      <div className="page-explainer">Clearing local data removes everything stored on this device. This cannot be undone.</div>
    </div>
  );
}
