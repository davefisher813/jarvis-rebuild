import { useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { useChat } from "../data/NotesProvider";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { WarningGlyph } from "../shared/glyphs";
const BACK = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>;

// onExport (2026-08-09): the Export Data row was role="button" with no
// onClick, a dead control on the exact page a user hunting for export lands
// on. It now goes where export actually lives.
export default function AdvancedPage({ onBack, onExport }: { onBack: () => void; onExport?: () => void }) {
  const chat = useChat();
  const [confirm, setConfirm] = useState(false);
  // Delete Chat History (addendum item 23): the ONE real chat-delete button.
  // Armed-tap like Clear local data below; hard deletes every row; receipt
  // states the count. Deleted means deleted.
  const [chatArmed, setChatArmed] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const deleteChat = async () => {
    if (chatBusy) return;
    setChatBusy(true);
    setChatArmed(false);
    const ok = await attemptWrite(async () => {
      const n = await chat.clearAll();
      showToast({ message: n === 0 ? "No chat history" : `Deleted ${n} ${n === 1 ? "message" : "messages"}` });
    });
    if (!ok) showToast({ message: "Couldn't delete · Try again" });
    setChatBusy(false);
  };
  return (
    <div className="screen">
      <LargeTitleNav title="Advanced" back="Settings" onBack={onBack} />
      <div className="grp"><div className="eyebrow">Data</div></div>
      <div className="pad-x"><div className="card">
        <div className="row" role="button" tabIndex={0} onClick={onExport}><div className="row-grow"><div className="conn-name">Export Data</div></div><span className="row-value">JSON</span></div>
        {/* Which commit this build came from. Exists so "is my phone on the
            new build?" is a ten-second look instead of a debugging session:
            that question has now been guessed at twice and guessed wrong. */}
        <div className="row"><div className="row-grow"><div className="conn-name">Build</div></div><span className="row-value">{typeof __BUILD_ID__ === "string" ? __BUILD_ID__ + " \u00b7 " + __BUILD_DATE__ : "dev"}</span></div>
      </div></div>
      <div className="pad-x"><div className="card">
        {!chatArmed
          ? <button className="row row-signout" onClick={() => setChatArmed(true)} disabled={chatBusy}>Delete Chat History</button>
          : <button className="row row-signout" onClick={() => void deleteChat()}>Tap Again to Confirm</button>}
      </div></div>
      <div className="pad-x"><div className="card">
        {!confirm
          ? <button className="row row-signout" onClick={() => setConfirm(true)}>Clear Local Data</button>
          : <button className="row row-signout" onClick={() => { try { localStorage.clear(); } catch { /* ignore */ } location.reload(); }}>Tap Again to Confirm</button>}
        {/* Catalog V3.1: the warning lives IN the card as a warn row, never
            floating below it. */}
        <div className="row">
          <div className="row-ico nav-tile-orange">
            <WarningGlyph />
          </div>
          <div className="row-stack"><div className="conn-meta"><span className="slip-warn">This device only · No undo</span></div></div>
        </div>
      </div></div>
    </div>
  );
}
