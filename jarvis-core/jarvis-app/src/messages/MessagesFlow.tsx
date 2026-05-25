import { useState } from "react";
import { EMAILS, DRAFTS, SCHEDULED, TEXTS, avFor } from "./demoData";

const PEN = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
const CHEV = <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>;

function Lead({ unread }: { unread: boolean }) {
  return <div className="msg-lead">{unread && <div className="unread-dot" />}</div>;
}

function EmailView() {
  return (
    <>
      <div className="pad-x"><div className="card">
        {EMAILS.map((m, i) => (
          <div className="msg-row" role="button" tabIndex={0} key={"e" + i}>
            <Lead unread={m.unread} />
            {(() => { const a = avFor(m.from); return <div className={"av av-40 cat-bg-" + a.slot}>{a.initials}</div>; })()}
            <div className="msg-body">
              <div className="msg-head"><div className="msg-name">{m.from}</div><div className="msg-time">{m.date}</div></div>
              <div className="msg-subject">{m.subject}</div>
              <div className="msg-preview">{m.preview}</div>
            </div>
            {CHEV}
          </div>
        ))}
      </div></div>

      <div className="grp"><div className="eyebrow">Drafts</div></div>
      <div className="pad-x"><div className="card">
        {DRAFTS.map((d, i) => (
          <div className="msg-row" role="button" tabIndex={0} key={"d" + i}>
            <Lead unread={false} />
            {(() => { const a = avFor(d.name); return <div className={"av av-40 cat-bg-" + a.slot}>{a.initials}</div>; })()}
            <div className="msg-body">
              <div className="msg-head"><div className="msg-name">To: {d.name}</div></div>
              <div className="msg-subject">{d.subject}</div>
              <div className="msg-preview">{d.preview}</div>
            </div>
            {CHEV}
          </div>
        ))}
      </div></div>

      <div className="grp"><div className="eyebrow">Scheduled</div></div>
      <div className="pad-x"><div className="card">
        {SCHEDULED.map((s, i) => (
          <div className="msg-row" role="button" tabIndex={0} key={"s" + i}>
            <Lead unread={false} />
            {(() => { const a = avFor(s.name); return <div className={"av av-40 cat-bg-" + a.slot}>{a.initials}</div>; })()}
            <div className="msg-body">
              <div className="msg-head"><div className="msg-name">To: {s.name}</div></div>
              <div className="msg-subject">{s.subject}</div>
              <div className="msg-sends">{s.sends}</div>
            </div>
            {CHEV}
          </div>
        ))}
      </div></div>
      <div className="screen-foot" />
    </>
  );
}

function TextsView() {
  return (
    <div className="pad-x"><div className="card">
      {TEXTS.map((t, i) => {
        const a = avFor(t.name);
        return (
          <div className="msg-row" role="button" tabIndex={0} key={"t" + i}>
            <Lead unread={t.unread} />
            <div className={"av av-40 cat-bg-" + a.slot}>{a.initials}</div>
            <div className="msg-body">
              <div className="msg-head"><div className="msg-name">{t.name}</div><div className="msg-time">{t.time}</div></div>
              <div className="msg-preview">{t.preview}</div>
            </div>
          </div>
        );
      })}
      <div className="screen-foot" />
    </div></div>
  );
}

export default function MessagesFlow() {
  const [tab, setTab] = useState<"email" | "texts">("email");
  return (
    <div className="screen">
      <div className="nav-bar"><div className="nav-large">Messages</div><button className="nav-action" aria-label="Compose">{PEN}</button></div>
      <div className="msg-seg">
        <div className="segmented">
          <button className={"seg" + (tab === "email" ? " active" : "")} onClick={() => setTab("email")}>Email</button>
          <button className={"seg" + (tab === "texts" ? " active" : "")} onClick={() => setTab("texts")}>Texts</button>
        </div>
      </div>
      {tab === "email" ? <EmailView /> : <TextsView />}
    </div>
  );
}
