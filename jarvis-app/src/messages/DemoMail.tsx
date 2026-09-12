// DEMO MAIL (Dave 2026-08-18: "I need to see what a populated email page
// will actually look like"). The demo build has no Gmail behind it, so this
// renders the REAL email anatomy with fixture threads shaped like his inbox.
// Rows toast instead of opening; the moment a real account connects,
// MessagesFlow renders live data and this component never mounts.

import { useEffect, useState } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import { showToast } from "../shared/toast";
import { Plus, Archive, Clock, Volume2, CalendarClock } from "../shared/icons";
import { leadFor } from "./rowAnatomy";
import { saveMailSnapshot } from "./home";
import { decide } from "./mailAction";
import { nameFor } from "./names";
import { railClass, railToneForWaiting } from "./rows";
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
      <div className="screen ruled">
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
      {/* EM1 (2026-09-12): the first screen opens on the view chips and the
          outcome switch; search lives on the All view, which the demo does
          not draw. The demo never shows an anatomy the app does not have. */}
      <div className="pad-x msg-chips">
        <button className="chip on" onClick={demoTap}>For You</button>
        <button className="chip" onClick={demoTap}>All</button>
        <button className="chip" onClick={demoTap}>Drafts</button>
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
      {/* E-02 (2026-09-12): the Sweep is the head's own capsule, the same
          shape MessagesFlow draws, in place of the Mission Deck card. */}
      <div className="sh2 sh2-quiet">
        <span className="t">Needs You</span>
        <button className="see-all pill-action" onClick={demoTap}>Sweep {"\u00b7"} About 2 min</button>
      </div>
      {/* EM2 to EM4: the mail row, one anatomy with the live page's. Every
          row in Needs You earned its bold (alwaysStrong on the live page). */}
      <div className="pad-x"><div className="card list-card-ruled">
        {NEEDS.map((r) => {
          const lead = leadFor({ from: r.from, fromEmail: r.from.toLowerCase().replace(/\s+/g, "") + "@example.com", by: r.due?.toLowerCase(), displayName: r.from });
          return (
          <div className="row mrow" role="button" tabIndex={0} key={r.from} onClick={demoTap}>
            <span className="mlead">
              {lead.kind === "rail"
                ? <span className={"mrail" + (lead.railTone === "warn" ? " due" : "")}></span>
                : <span className={"mface cat-bg-" + lead.face} aria-hidden="true">{lead.initial}</span>}
            </span>
            <div className="ms">
              <div className="mline1">
                <span className="mfrom strong">{r.from}</span>
                {r.due ? <span className="mdue">{r.due}</span> : <span className="mwhen">{r.when}</span>}
              </div>
              <div className="mline2 strong">{r.sub}</div>
            </div>
          </div>
          );
        })}
      </div></div>
      <ListFloor>That&rsquo;s every one that needs you.</ListFloor>
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

      {/* TOOLS (EM1 / E-01, 2026-09-12): the drawers under the list, one
          quiet head, the same rows the live page draws. */}
      <div className="sh2 sh2-quiet"><span className="t">Tools</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        <div className="row" role="button" tabIndex={0} onClick={demoTap}>
          <span className="row-ico cat-bg-graphite" aria-hidden="true"><Archive className="ic" /></span>
          <div className="row-grow">
            <div className="conn-name">Clean Out</div>
            <div className="conn-meta">14 threads {"\u00b7"} 6 senders {"\u00b7"} In the inbox</div>
          </div>
          <div className="chev" />
        </div>
        <div className="row" role="button" tabIndex={0} onClick={demoTap}>
          <span className="row-ico cat-bg-graphite" aria-hidden="true"><Clock className="ic" /></span>
          <div className="row-grow">
            <div className="conn-name">Only a Few Minutes?</div>
            <div className="conn-meta">A timed drain {"\u00b7"} It stops itself</div>
          </div>
          <div className="chev" />
        </div>
        <div className="row" role="button" tabIndex={0} onClick={demoTap}>
          <span className="row-ico cat-bg-graphite" aria-hidden="true"><Volume2 className="ic" /></span>
          <div className="row-grow">
            <div className="conn-name">Read It to Me</div>
            <div className="conn-meta">Senders and gists only {"\u00b7"} Never the message</div>
          </div>
          <span className="pill-act">Play</span>
        </div>
        <div className="row" role="button" tabIndex={0} onClick={demoTap}>
          <span className="row-ico cat-bg-graphite" aria-hidden="true"><CalendarClock className="ic" /></span>
          <div className="row-grow">
            <div className="conn-name">Email Windows</div>
            <div className="conn-meta">Open email on a schedule</div>
          </div>
          <div className="chev" />
        </div>
      </div></div>

      {onConnect && (
        <div className="pad-x conn-action">
          <button className="btn btn-primary btn-block" onClick={onConnect}>Connect Google</button>
        </div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
