// DEMO MAIL (Dave 2026-08-18: "I need to see what a populated email page
// will actually look like"). The demo build has no Gmail behind it, so this
// renders the REAL email anatomy with fixture threads shaped like his inbox.
// Rows toast instead of opening; the moment a real account connects,
// MessagesFlow renders live data and this component never mounts.

import { useEffect, useState } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import { showToast } from "../shared/toast";
import { Plus } from "lucide-react";
import { saveMailSnapshot } from "./home";
import { decide } from "./mailAction";

interface DemoRow { from: string; sub: string; when: string; unread?: boolean; due?: string }
interface DemoWait { to: string; sub: string; days: number }

const NEEDS: DemoRow[] = [
  { from: "Northwind Cloud", sub: "Security advisories flagged in two projects", when: "2:55 PM", unread: true, due: "Today" },
  { from: "Nadia Brandt", sub: "Invoice attached · Net 15 starts Monday", when: "11:20 AM", unread: true },
  { from: "App Store Team", sub: "Action needed: complete your enrollment", when: "9:04 AM" },
];
// The demo runs the SAME action model as the live page (2026-08-21), so what
// a demo shows and what the app does can never drift. Before this the demo
// printed "Nudge" four times, which was the exact bug Dave reported on his
// real inbox.
const WAITING: DemoWait[] = [
  { to: "summitgear", sub: "Missing Items From Order #D2565", days: 55 },
  { to: "Marcus Delaney", sub: "Harper v Northline · can you call me", days: 55 },
  { to: "nadia@northlake.org", sub: "Invoice", days: 50 },
  { to: "Elieserhenry0", sub: "Reservation Receipt", days: 46 },
];

const MAIL_ICO = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
);

const demoTap = () => showToast({ message: "Demo mail · Connect Google for the real thing" });

export default function DemoMail({ onConnect }: { onConnect?: () => void }) {
  // The home page reads a snapshot the Email tab leaves behind. In the demo
  // there is no Gmail, so the fixtures leave the same snapshot: Dave sees the
  // real home-page email anatomy instead of an empty stream. Demo only; the
  // moment an account connects, MessagesFlow writes the real one.
  useEffect(() => {
    saveMailSnapshot({
      ts: Date.now(),
      needsYou: NEEDS.length + 4,
      threads: NEEDS.map((r, i) => ({
        id: "demo-" + i,
        from: r.from,
        fromEmail: r.from.toLowerCase().replace(/\s+/g, "") + "@example.com",
        subject: r.sub,
        gist: r.sub,
        by: r.due ? r.due.toLowerCase() : undefined,
      })),
      waiting: WAITING.slice(0, 3).map((w, i) => ({
        threadId: "demo-w" + i,
        to: w.to,
        subject: w.sub.split(" · ")[0] ?? w.sub,
        days: [55, 55, 50][i] ?? 30,
      })),
      promises: [{ threadId: "demo-p0", text: "send rob the deck", due: "2026-08-21" }],
    });
  }, []);

  // The compose surface is real typing even in the demo: the fields work,
  // only Send explains itself. Dave sees the page, nothing pretends to mail.
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState({ to: "", subject: "", body: "" });

  if (composing) {
    return (
      <div className="screen">
        <div className="nav-bar">
          <button className="nav-back" onClick={() => setComposing(false)}>Cancel</button>
          <span className="nav-title">New Message</span>
          <div className="nav-actions">
            <button className="nav-action-text" onClick={demoTap}>Send</button>
          </div>
        </div>
        <div className="pad-x sheet-form">
          <input className="msg-input" placeholder="To" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <input className="msg-input" placeholder="Subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          <textarea className="msg-textarea" placeholder="Message" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <PageHeader title="Email" actions={<BarAction label="New Message" onClick={() => setComposing(true)}><Plus className="ic" /></BarAction>} />
      <div className="pad-x">
        <input className="msg-input msg-search" placeholder="Search All Mail" onFocus={demoTap} readOnly />
      </div>
      <div className="pad-x msg-chips">
        <button className="chip on" onClick={demoTap}>For You</button>
        <button className="chip" onClick={demoTap}>All</button>
        <button className="chip" onClick={demoTap}>Drafts</button>
      </div>

      <div className="pad-x deck-cta">
        <div className="promo-card">
          <div className="promo-head">
            <div className="promo-badge b-red">{MAIL_ICO}</div>
            <div className="promo-body">
              <div className="promo-title">3 Threads Need You</div>
              <div className="promo-sub">Everything else is filed below.</div>
            </div>
          </div>
          <div className="promo-acts">
            <button className="promo-pill quiet" onClick={demoTap}>Only have a few minutes?</button>
            <button className="promo-pill" onClick={demoTap}>Deal With It</button>
          </div>
        </div>
      </div>

      <div className="sh2"><span className="t">Needs You</span></div>
      <div><div className="list-flat">
        {NEEDS.map((r) => (
          <div className="row" role="button" tabIndex={0} key={r.from} onClick={demoTap}>
            <span className={"msg-dot" + (r.unread ? "" : " off")}></span>
            <div className="row-grow">
              <div className="msg-line">
                <span className={"conn-name truncate" + (r.unread ? " msg-strong" : "")}>{r.from}</span>
                {r.due ? <span className="msg-due">{r.due}</span> : <span className="msg-when">{r.when}</span>}
              </div>
              <div className="conn-meta msg-gist">{r.sub}</div>
            </div>
          </div>
        ))}
      </div></div>

      <div className="sh2"><span className="t">Waiting On</span></div>
      <div><div className="list-flat">
        {WAITING.map((w) => {
          const d = decide(w.sub, "", w.days);
          return (
          <div className="row" role="button" tabIndex={0} key={w.to} onClick={demoTap}>
            <span className="msg-dot off"></span>
            <div className="row-grow">
              <div className="msg-line">
                <span className="conn-name truncate">{w.to}</span>
                <span className={"mail-age" + (d.tone === "firm" ? " hot" : d.tone === "direct" ? " warm" : "")}>{w.days}d</span>
                <span className="pill-act">{d.primary.label}</span>
              </div>
              <div className="conn-meta msg-gist">{w.sub} · No reply</div>
            </div>
          </div>
          );
        })}
      </div></div>

      <div className="pad-x msg-fold">
        <div className="card">
          <div className="row" role="button" tabIndex={0} onClick={demoTap}>
            <div className="row-grow">
              <div className="conn-name">The Rest</div>
              <div className="conn-meta msg-gist">Nothing waiting on you</div>
            </div>
            <span className="pill pill-subdued">14</span>
          </div>
        </div>
      </div>

      {onConnect && (
        <div className="pad-x conn-action">
          <button className="btn btn-primary btn-block" onClick={onConnect}>Connect Google</button>
        </div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
