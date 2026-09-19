import { useCallback, useEffect, useState } from "react";

// GIVING THE HOUR BACK (Track 3, 2026-09-19). The second screen with no session
// behind it, reached only from the link in a visitor's own confirmation email.
//
// WHY IT EXISTS. The receipt used to say "reply to this email" and nothing
// more, which puts the work on the host and leaves the visitor with no idea
// whether anything happened. That is how a cancellation becomes a no-show: the
// person decides they cannot make it, sends a message into a mailbox, hears
// nothing, and the hour stays blocked on somebody's calendar for a meeting
// neither of them is going to.
//
// THREE THINGS IT GETS RIGHT.
//
//   IT SHOWS THE MEETING BEFORE IT OFFERS THE BUTTON. Nobody should cancel
//   something they cannot see. The times are drawn on the visitor's own clock,
//   the same rule the booking grid follows.
//
//   AN ALREADY-CANCELLED BOOKING IS A SUCCESS, NOT AN ERROR. Somebody who taps
//   the link in an old email is told the meeting is off, which it is. "No such
//   booking" would read as the link being broken and send them to write an
//   email after all.
//
//   IT SAYS WHAT IT DID, NOT THAT IT WORKED. The last screen states the hour is
//   free and the host will see it, because "Done" tells a person nothing about
//   whether they still need to do something.

export interface CancelFace { name: string; status: string; startMs: number | null; endMs: number | null }

type Phase =
  | { k: "loading" }
  | { k: "gone" }
  | { k: "standing"; booking: CancelFace }
  | { k: "off"; booking: CancelFace; justNow: boolean };

const dayLabel = (ms: number): string =>
  new Date(ms).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
const timeLabel = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The meeting in one line, on the visitor's clock, or null when the times did
 *  not survive the trip. A screen with no time on it is still honest; a screen
 *  with the wrong time is not. */
export function whenLine(b: CancelFace): string | null {
  if (b.startMs === null) return null;
  const day = dayLabel(b.startMs);
  return b.endMs === null
    ? `${day} at ${timeLabel(b.startMs)}`
    : `${day}, ${timeLabel(b.startMs)} to ${timeLabel(b.endMs)}`;
}

export default function PublicCancelPage({ bookingId, fetchImpl = fetch }: { bookingId: string; fetchImpl?: typeof fetch }) {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchImpl(`/api/book?cancel=${encodeURIComponent(bookingId)}`);
      if (!r.ok) { setPhase({ k: "gone" }); return; }
      const body = (await r.json()) as { booking?: CancelFace };
      const b = body.booking;
      if (!b) { setPhase({ k: "gone" }); return; }
      setPhase(b.status === "confirmed" ? { k: "standing", booking: b } : { k: "off", booking: b, justNow: false });
    } catch {
      setPhase({ k: "gone" });
    }
  }, [bookingId, fetchImpl]);
  useEffect(() => { void load(); }, [load]);

  const cancel = async () => {
    if (phase.k !== "standing" || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetchImpl("/api/book", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancel: bookingId }),
      });
      if (!r.ok) { setErr("Could not cancel that booking."); return; }
      const body = (await r.json()) as { already?: boolean };
      setPhase({ k: "off", booking: phase.booking, justNow: body.already !== true });
    } catch {
      setErr("Could not reach the booking service.");
    } finally {
      setBusy(false);
    }
  };

  if (phase.k === "loading") {
    return <div className="screen ruled bk-page"><div className="pad-x"><div className="card pad" /></div></div>;
  }

  if (phase.k === "gone") {
    return (
      <div className="screen ruled bk-page">
        <div className="pagehead"><div className="pagehead-title">Nothing to Cancel</div></div>
        <div className="pad-x"><div className="card pad">
          <div className="empty-title">We Could Not Find That Booking</div>
          <div className="empty-sub">The link may be mistyped, and replying to your confirmation email reaches a person</div>
        </div></div>
      </div>
    );
  }

  const b = phase.booking;
  const when = whenLine(b);

  if (phase.k === "off") {
    return (
      <div className="screen ruled bk-page">
        <div className="pagehead"><div className="pagehead-title">{phase.justNow ? "Cancelled" : "Already Cancelled"}</div></div>
        <div className="pad-x"><div className="card pad">
          <div className="bk-when">{b.name}</div>
          {when && <div className="bk-time">{when}</div>}
          <div className="bk-note">
            {phase.justNow
              ? "The hour is free again and it has come off their calendar"
              : "This meeting was already off, so there is nothing left to do"}
          </div>
          {phase.justNow && <div className="bk-note">Nothing else is needed from you</div>}
        </div></div>
      </div>
    );
  }

  return (
    <div className="screen ruled bk-page">
      <div className="pagehead"><div className="pagehead-title">Cancel This Booking</div></div>
      <div className="pad-x">
        <div className="card pad">
          <div className="bk-when">{b.name}</div>
          {when && <div className="bk-time">{when}</div>}
          <div className="facts"><span className="fact">{localZone()}</span></div>
        </div>
        <div className="card pad">
          <div className="bk-note">The hour goes back on offer and the meeting comes off their calendar.</div>
          {err && <div className="input-error">{err}</div>}
          <button type="button" className="btn btn-primary btn-block" onClick={() => void cancel()} disabled={busy}>
            {busy ? "Cancelling" : "Cancel It"}
          </button>
        </div>
      </div>
    </div>
  );
}

const localZone = (): string => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
};
