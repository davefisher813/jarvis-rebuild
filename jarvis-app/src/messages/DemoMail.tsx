// DEMO MAIL (Dave 2026-08-18: "I need to see what a populated email page
// will actually look like"). The demo build has no Gmail behind it, so this
// renders the REAL email anatomy with fixture threads shaped like his inbox.
// Rows toast instead of opening; the moment a real account connects,
// MessagesFlow renders live data and this component never mounts.

import { useEffect, useState } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import { showToast } from "../shared/toast";
import { Plus } from "../shared/icons";
import { saveMailSnapshot } from "./home";
import { decide } from "./mailAction";
import { nameFor } from "./names";
import { railClass, railToneForWaiting, railToneForDeadline } from "./rows";
import { EnvelopeGlyph } from "../shared/glyphs";
import ListFloor from "../shared/ListFloor";

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
  <EnvelopeGlyph />
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
  const [outcome, setOutcome] = useState<"needs" | "waiting">("needs");
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
    <div className="screen ruled">
      <PageHeader title="Email" actions={<BarAction label="New Message" onClick={() => setComposing(true)}><Plus className="ic" /></BarAction>} />
      <div className="pad-x">
        <input className="msg-input msg-search" placeholder="Search All Mail" onFocus={demoTap} readOnly />
      </div>
      <div className="pad-x msg-chips">
        <button className="chip on" onClick={demoTap}>For You</button>
        <button className="chip" onClick={demoTap}>All</button>
        <button className="chip" onClick={demoTap}>Drafts</button>
      </div>

      {/* The demo never shows an anatomy the app does not have, so when the
          Mission Deck landed (2026-08-26) it landed here the same day. */}
      <div className="pad-x mode-deck">
        <div className="mode-card mode-hero" role="button" tabIndex={0} onClick={demoTap}>
          <div className="mode-name">The Sweep</div>
          <div className="mode-n">{NEEDS.length}</div>
          <div className="mode-why">Need you &middot; About 2 min</div>
          <div className="mode-go">Start</div>
        </div>
        <div className="mode-card" role="button" tabIndex={0} onClick={demoTap}>
          <div className="mode-name">Clean Out</div>
          <div className="mode-n">14</div>
          <div className="mode-why">6 Senders &middot; In the inbox</div>
          <div className="mode-go mode-go-quiet">Open</div>
        </div>
      </div>
      {/* THE OUTCOME SWITCH (ruled 2026-09-01), the same one MessagesFlow
          draws: one section at a time, counts on the labels. The demo never
          shows an anatomy the app does not have. */}
      <div className="pad-x outcome-seg">
        <div className="segmented" role="tablist" aria-label="Outcome">
          {(["needs", "waiting"] as const).map((o) => (
            <button key={o} role="tab" aria-selected={o === outcome} className={"seg" + (o === outcome ? " active" : "")} onClick={() => setOutcome(o)}>
              {o === "needs" ? "Needs You" : "Waiting On"}<span className="seg-n">{o === "needs" ? NEEDS.length : WAITING.length}</span>
            </button>
          ))}
        </div>
      </div>
      {outcome === "needs" && (<>
      <div className="pad-x"><div className="card list-card-ruled">
        {NEEDS.map((r) => (
          <div className="row" role="button" tabIndex={0} key={r.from} onClick={demoTap}>
            <span className={railClass(!!r.unread, railToneForDeadline(r.due))}></span>
            <div className="row-grow">
              <div className="msg-line">
                <span className="msg-from truncate">{r.from}</span>
                {r.due ? <span className="msg-due">{r.due}</span> : <span className="msg-when">{r.when}</span>}
              </div>
              <div className={"msg-headline" + (r.unread ? " msg-strong" : "")}>{r.sub}</div>
            </div>
          </div>
        ))}
      </div></div>
      <ListFloor />
      </>)}

      {outcome === "waiting" && (<>
      <div className="pad-x"><div className="card list-card-ruled">
        {WAITING.map((w) => {
          const d = decide(w.sub, "", w.days);
          return (
          <div className="row" role="button" tabIndex={0} key={w.to} onClick={demoTap}>
            <span className={railClass(false, railToneForWaiting(d.tone))}></span>
            <div className="row-grow">
              <div className="msg-line">
                <span className="conn-name truncate">{d.primary.label}</span>
              </div>
              {/* E2: the ask leads; the sender is context under it. */}
              <div className="conn-meta msg-gist">{nameFor({ byEmail: {} }, undefined, w.to)} · {w.sub}</div>
            </div>
          </div>
          );
        })}
      </div></div>
      <ListFloor />
      </>)}

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
