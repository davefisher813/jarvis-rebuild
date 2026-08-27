import { useState } from "react";
import { telHref, hasTrustedAdult, CRISIS_LINE_LABEL, CRISIS_LINE_NUMBER } from "../trustedAdult";

// SAY IT TO SOMEONE (Part 5). Always present, one tap, no preamble: the
// athlete's own chosen trusted adult, plus 988. Never gated behind a mood
// question or any screener -- this screen asks nothing before it offers
// both numbers.
export default function SayItToSomeoneScreen({
  name, phone, onSetTrustedAdult, onBack,
}: {
  name: string;
  phone: string;
  onSetTrustedAdult: (name: string, phone: string) => void;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState(!hasTrustedAdult(name, phone));
  const [draftName, setDraftName] = useState(name);
  const [draftPhone, setDraftPhone] = useState(phone);

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Say It To Someone</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">Reach A Human Now</div>
        <div className="bp-sub">One tap, no questions first.</div>
      </div></div>

      <div className="pad-x"><div className="card">
        {hasTrustedAdult(name, phone) && !editing ? (
          <a className="row" href={telHref(phone)}>
            <div className="row-grow"><div className="conn-name">{name}</div><div className="bp-sub">Your chosen person</div></div>
          </a>
        ) : (
          <div className="row"><div className="row-grow"><div className="conn-name">Choose Someone</div></div></div>
        )}
        <a className="row" href={telHref(CRISIS_LINE_NUMBER)}>
          <div className="row-grow"><div className="conn-name">{CRISIS_LINE_LABEL}</div><div className="bp-sub">Always here, day or night</div></div>
        </a>
      </div></div>

      {editing ? (
        <div className="pad-x"><div className="card pad">
          <div className="field">
            <div className="input-label">Their Name</div>
            <input className="input" value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="A Name You Trust" />
          </div>
          <div className="field">
            <div className="input-label">Their Number</div>
            <input className="input" type="tel" value={draftPhone} onChange={(e) => setDraftPhone(e.target.value)} placeholder="A Number That Reaches Them" />
          </div>
          <button
            className="btn btn-primary btn-block"
            disabled={!draftName.trim() || !draftPhone.trim()}
            onClick={() => { onSetTrustedAdult(draftName, draftPhone); setEditing(false); }}
          >
            Save This Person
          </button>
        </div></div>
      ) : (
        <div className="pad-x"><button className="btn btn-secondary btn-block" onClick={() => setEditing(true)}>Change Who You Call</button></div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
