import { useCallback, useEffect, useState } from "react";

// THE BOOKING PAGE (Track 3, 2026-09-19). What a stranger sees.
//
// It is the only screen in the app with no session behind it, and it is
// written to hold that on its own: no providers, no store, no Supabase
// client. One fetch to /api/book and everything it needs is in hand. That
// isolation is the point. Nothing a visitor can do here can reach the app's
// data, because this page has no route to it.
//
// THE TIMES ARE THE VISITOR'S. A grid rendered in the owner's zone asks a
// person to do arithmetic before they can pick a meeting, and they will get
// it wrong. Every time here is drawn in the browser's own zone, with the
// owner's zone stated once so nobody has to guess whose morning it is.
//
// THE SERVER DECIDES. This page posts a start it was given; if the grid has
// moved underneath it (someone else booked, the notice window passed) the
// server says so and this shows that, rather than pretending.

export interface BookingLink {
  name: string;
  durationMin: number;
  timezone: string;
  slots: { startMs: number; endMs: number; date: string }[];
}
export interface Booked { startMs: number; endMs: number; timezone: string; name: string; confirmationSent?: boolean }

type Phase =
  | { k: "loading" }
  | { k: "gone"; why: string }
  | { k: "open"; link: BookingLink }
  | { k: "done"; made: Booked };

const localZone = (): string => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
};
const dayLabel = (ms: number): string =>
  new Date(ms).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
const timeLabel = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The slots grouped into the visitor's own days, because a slot's date on
 *  the owner's calendar can be yesterday or tomorrow on the visitor's. */
export function byLocalDay(slots: BookingLink["slots"]): { key: string; label: string; slots: BookingLink["slots"] }[] {
  const days = new Map<string, BookingLink["slots"]>();
  for (const s of slots) {
    const d = new Date(s.startMs);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.set(key, [...(days.get(key) ?? []), s]);
  }
  return [...days.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, list]) => ({ key, label: dayLabel(list[0]!.startMs), slots: list }));
}

export default function PublicBookingPage({ slug, fetchImpl = fetch }: { slug: string; fetchImpl?: typeof fetch }) {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [picked, setPicked] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetchImpl(`/api/book?slug=${encodeURIComponent(slug)}`);
      if (r.status === 503) { setPhase({ k: "gone", why: "This link is not taking bookings yet." }); return; }
      if (!r.ok) { setPhase({ k: "gone", why: "This link has expired or never existed." }); return; }
      setPhase({ k: "open", link: (await r.json()) as BookingLink });
    } catch {
      setPhase({ k: "gone", why: "Could not reach the booking service." });
    }
  }, [slug, fetchImpl]);
  useEffect(() => { void load(); }, [load]);

  const confirm = async () => {
    if (picked === null || saving) return;
    if (!name.trim()) { setErr("Add your name."); return; }
    if (!email.trim()) { setErr("Add an email we can confirm to."); return; }
    setSaving(true);
    setErr(null);
    try {
      const r = await fetchImpl("/api/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The zone goes with the booking so the confirmation email states the
        // time on the VISITOR's clock. A receipt in the host's zone asks a
        // stranger to do arithmetic about a meeting they have already agreed
        // to, which is exactly when somebody misses one.
        body: JSON.stringify({ slug, startMs: picked, name: name.trim(), email: email.trim(), timezone: localZone() }),
      });
      const body = (await r.json().catch(() => ({}))) as { error?: string } & Partial<Booked>;
      if (!r.ok) {
        setErr(body.error || "Could not book that time.");
        // The grid moved under us, so show the one that is true now.
        if (r.status === 409) { setPicked(null); void load(); }
        return;
      }
      setPhase({ k: "done", made: body as Booked });
    } catch {
      setErr("Could not reach the booking service.");
    } finally {
      setSaving(false);
    }
  };

  if (phase.k === "loading") return <div className="screen ruled" />;

  if (phase.k === "gone") {
    return (
      <div className="screen ruled bk-page">
        <div className="pagehead"><div className="pagehead-title">Booking</div></div>
        <div className="pad-x"><div className="card pad">
          <div className="empty-title">Nothing to Book Here</div>
          <div className="empty-sub">{phase.why}</div>
        </div></div>
      </div>
    );
  }

  if (phase.k === "done") {
    const m = phase.made;
    return (
      <div className="screen ruled bk-page">
        <div className="pagehead"><div className="eyebrow">{m.name}</div><div className="pagehead-title">You Are Booked</div></div>
        <div className="pad-x"><div className="card pad">
          <div className="bk-when">{dayLabel(m.startMs)}</div>
          <div className="bk-time">{timeLabel(m.startMs)} to {timeLabel(m.endMs)}</div>
          {/* ONE GREY UNDER THE TIME (§AK, 2026-09-26). The meeting's name
              rides the eyebrow, as it does on the grid, and the zone is a
              neutral time fact in small caps, so the confirmation below is
              the card's one quiet line. */}
          <div className="facts"><span className="fact date">{localZone() || m.timezone}</span></div>
          {/* WHAT ACTUALLY HAPPENED (2026-09-19). This line used to promise a
              confirmation whether or not one was sent. The server now says,
              and when nothing went out the page says the one thing that is
              still true: the time is held. Telling somebody to watch their
              inbox for an email that does not exist is how a booking turns
              into a no-show. */}
          {m.confirmationSent
            ? <div className="bk-note">A confirmation is on its way to {email}, with a calendar file attached.</div>
            : <div className="bk-note">Your time is held. No email went out, so take a note of it.</div>}
        </div></div>
      </div>
    );
  }

  const link = phase.link;
  const days = byLocalDay(link.slots);
  const zone = localZone();

  return (
    <div className="screen ruled bk-page">
      <div className="pagehead">
        <div className="eyebrow">{link.durationMin} Minutes</div>
        <div className="pagehead-title">{link.name}</div>
      </div>

      {days.length === 0 ? (
        <div className="pad-x"><div className="card pad">
          <div className="empty-title">No Times Open</div>
          <div className="empty-sub">Nothing is free in the next few weeks. Try again later.</div>
        </div></div>
      ) : (
        <>
          <div className="pad-x">
            <div className="bk-note">
              Times are shown in {zone || "your own time zone"}
              {zone && zone !== link.timezone ? ` · booked in ${link.timezone}` : ""}
              {/* THE REASON OUTLIVES THE CHOICE. When the server says the
                slot went, the pick is dropped so nobody confirms a time
                that is gone -- and the message used to live inside the
                form, which is rendered only while a pick stands, so it
                vanished in the same tick that made it true. It says what
                happened here, where the grid the visitor has to choose
                from again is. */}
            {picked === null && err && <div className="input-error">{err}</div>}
          </div>
          </div>
          {days.map((d) => (
            <div key={d.key}>
              <div className="sh2 sh2-quiet"><span className="t">{d.label}</span><span className="n">{d.slots.length}</span></div>
              <div className="pad-x">
                <div className="chip-row chip-wrap-row">
                  {d.slots.map((s) => (
                    <button
                      key={s.startMs}
                      type="button"
                      className={"chip" + (picked === s.startMs ? " active" : "")}
                      aria-pressed={picked === s.startMs}
                      onClick={() => { setPicked(s.startMs); setErr(null); }}
                    >{timeLabel(s.startMs)}</button>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {/* The form arrives with the choice, not before it: asking a
              stranger for their email before they have picked a time is
              asking them to pay before they know what for. */}
          {picked !== null && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Who Is Coming</span></div>
              <div className="pad-x"><div className="card pad bk-form">
                <label className="input-label" htmlFor="bk-name">Name</label>
                <input id="bk-name" className="input" value={name} placeholder="Your Name"
                  onChange={(e) => { setName(e.target.value); setErr(null); }} />
                <label className="input-label" htmlFor="bk-email">Email</label>
                <input id="bk-email" className="input" type="email" value={email} placeholder="you@example.com"
                  onChange={(e) => { setEmail(e.target.value); setErr(null); }} />
                {err && <div className="input-error">{err}</div>}
                <button type="button" className="btn btn-primary btn-block" onClick={() => void confirm()}>
                  {saving ? "Booking" : `Book ${timeLabel(picked)}`}
                </button>
                <div className="bk-note">{dayLabel(picked)}</div>
              </div></div>
            </>
          )}
        </>
      )}
      <div className="screen-foot" />
    </div>
  );
}
