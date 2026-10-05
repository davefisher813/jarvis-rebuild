import { useCallback, useEffect, useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Head, Card, Switch, Foot, DangerRow } from "./kit";
import { pressable } from "../shared/pressable";
import { lineCase } from "../shared/casing";
import {
  readBookingSettings, updateBookingSettings, DURATIONS,
  type BookingSettings, type BookingDuration,
} from "../booking/settings";
import { readLink, saveLink, removeLink, linkUrl, type LinkFace } from "../booking/link";
import { readBookings, cancelBooking, importBookings } from "../booking/importBookings";
import { mapBooking, type BookingFace } from "../booking/bookedEvents";
import RowActionSheet from "../shared/RowActionSheet";
import CancelBookingSheet from "../booking/CancelBookingSheet";
import DayOffSheet from "../booking/DayOffSheet";
import { readDaysOff, saveDaysOff, dayOffLabel } from "../booking/daysOff";
import { useOptionalSchedule } from "../data/NotesProvider";
import { showToast } from "../shared/toast";
import { copyText } from "../shared/shareText";
import { Link2, CalendarDays } from "../shared/icons";

// YOUR TIMES (Track 3, 2026-09-14; the preview's Booking Settings screen:
// "One screen. Day toggles and a duration list, no wizard"). Available or
// not, the days and the slot length. Who can book is not a choice any more
// (2026-10-05): the screen shows the one answer, anyone with the link.
//
// The link and the bookings on it are the SERVER's (Track 3, 2026-09-19), so
// the screen asks for both rather than deciding either. What was once an
// honest note about a server that did not exist is now a published address and
// the list of people who have used it.
// TWO LETTERS, SO NO TWO DAYS READ ALIKE (2026-10-05, the round 2 review: a lone T and a lone S were each two different days).
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The day and time of a booking, on this device's clock, because that is the
 *  clock the person reading this screen is standing on. Two neutral facts,
 *  so two small-caps dates with the stylesheet's separator between them
 *  (§AM F5, 2026-09-26), never a dot typed into one string. */
function When({ b }: { b: BookingFace }) {
  const d = new Date(b.startMs);
  const day = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  // A clock time is 12-hour with AM or PM whatever the phone's region says
  // (2026-10-05, the catalog gate: a 24-hour region drew "18:00").
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return <><span className="fact date">{day}</span><span className="fact date">{time}</span></>;
}

// The two reads are injectable, the same way PublicBookingPage takes its
// fetch: this screen's interesting states are the ones a running app cannot be
// put into on demand, a published link and somebody having booked on it.
export default function BookingPage({
  onBack,
  readLinkImpl = readLink,
  saveLinkImpl = saveLink,
  readBookingsImpl = readBookings,
  cancelImpl = cancelBooking,
  readDaysOffImpl = readDaysOff,
  saveDaysOffImpl = saveDaysOff,
}: {
  onBack: () => void;
  readLinkImpl?: typeof readLink;
  saveLinkImpl?: typeof saveLink;
  readBookingsImpl?: typeof readBookings;
  cancelImpl?: typeof cancelBooking;
  readDaysOffImpl?: typeof readDaysOff;
  saveDaysOffImpl?: typeof saveDaysOff;
}) {
  // OPTIONAL ON PURPOSE. This screen has no business requiring the schedule:
  // it needs it only to take a cancelled hour off the calendar straight away,
  // and without one the next app open does that anyway. It also lets the screen
  // be rendered on its own, which is how its interesting states get tested.
  const schedule = useOptionalSchedule();
  // WHICH BOOKING THE SHEETS ARE ABOUT. Two steps to call a meeting off, which
  // is proportionate: the row's own menu, then a sheet that says what the
  // stranger will receive. Neither step touches anything until the last tap.
  const [acting, setActing] = useState<BookingFace | null>(null);
  const [cancelling, setCancelling] = useState<BookingFace | null>(null);
  const [cancelErr, setCancelErr] = useState<string | null>(null);
  // DAYS OFF. The grid has honoured a blocked day since the arithmetic was
  // written and nothing ever wrote one, so a holiday could not be said: he sets
  // Monday to Friday, goes away for a week, and the link hands that week out.
  const [daysOff, setDaysOff] = useState<string[]>([]);
  const [addingDay, setAddingDay] = useState(false);
  const [actingDay, setActingDay] = useState<string | null>(null);
  const [dayErr, setDayErr] = useState<string | null>(null);
  const [s, setS] = useState<BookingSettings>(() => readBookingSettings());
  // THE LINK IS THE SERVER'S (Track 3, 2026-09-19). The settings stay on the
  // device, the way they always have; the LINK is a row in Track 3, so the
  // screen asks for it rather than deciding it. Saving is explicit: a person
  // flicking through day chips is not publishing an address with every tap.
  const [link, setLink] = useState<LinkFace | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  // WHO HAS ACTUALLY BOOKED. The schedule is where a booking belongs and it
  // lands there on its own (see booking/BookingImportPump). This list answers
  // a different question, the first one anybody asks after publishing a link:
  // is the thing working, and has anyone used it. Null means it could not be
  // asked, which is not the same as nobody having booked.
  const [booked, setBooked] = useState<BookingFace[] | null>(null);
  const load = useCallback(() => {
    readLinkImpl().then(setLink).catch(() => setLink(null));
    readBookingsImpl().then(setBooked).catch(() => setBooked(null));
    readDaysOffImpl().then((d) => setDaysOff(d ?? [])).catch(() => setDaysOff([]));
  }, [readLinkImpl, readBookingsImpl, readDaysOffImpl]);
  useEffect(() => { load(); }, [load]);

  const set = (patch: Partial<BookingSettings>) => { setS(updateBookingSettings(patch)); setDirty(true); };

  // Both directions are one write of the whole list, because the table means
  // exactly what this screen shows and nothing else.
  const writeDays = async (next: string[], onDone?: () => void) => {
    if (busy) return;
    setBusy(true);
    setDayErr(null);
    try {
      setDaysOff(await saveDaysOffImpl(next));
      onDone?.();
    } catch {
      setDayErr("Could not save that.");
    } finally { setBusy(false); }
  };

  const doCancel = async (b: BookingFace, reason: string) => {
    if (busy) return;
    setBusy(true);
    setCancelErr(null);
    try {
      const { told } = await cancelImpl(b.id, reason);
      setCancelling(null);
      // The list and the schedule both stop showing it now rather than at the
      // next app open: the import is the one thing that knows how to take the
      // event off, so it is asked rather than second-guessed here.
      readBookingsImpl().then(setBooked).catch(() => { /* the list is stale, not wrong */ });
      if (schedule) void importBookings(schedule).catch(() => { /* next open heals it */ });
      // Two facts, said as two, because "Cancelled" over an email that never
      // sent leaves him thinking a stranger knows not to turn up.
      showToast({ message: told ? "Cancelled \u00b7 They Have Been Emailed" : "Cancelled \u00b7 We Could Not Email Them" });
    } catch {
      setCancelErr("Could not cancel that booking.");
    } finally { setBusy(false); }
  };

  const publish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const made = await saveLinkImpl(s);
      setLink(made);
      setDirty(false);
      // Live means somebody can book on it. A link with no hours open is an
      // address that offers nothing, and a link the server wrote as
      // named_contacts answers 404 to everyone; neither is "live" (2026-10-04).
      showToast({
        message: !made ? "Saved on This Device"
          : made.visibility === "named_contacts" ? "Saved · The Link Is Closed to Everyone"
          : made.days > 0 ? "Your Link Is Live" : "Saved · No Hours Are Open Yet",
      });
    } catch {
      showToast({ message: "Couldn't Reach the Booking Server \u00b7 Try Again" });
    } finally { setBusy(false); }
  };
  const takeDown = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await removeLink();
      setLink(null);
      setDirty(false);
      // Said plainly, because the one thing a person fears here is that
      // taking the link down cancelled meetings they already have.
      showToast({ message: "Link Taken Down \u00b7 Bookings You Have Are Kept" });
    } catch {
      showToast({ message: "Couldn't Reach the Booking Server \u00b7 Try Again" });
    } finally { setBusy(false); }
  };
  // COPY, AND SAY SO ONLY IF IT WORKED (2026-10-04). `navigator.clipboard?.`
  // short-circuited the whole chain where there is no clipboard, so the tap
  // closed a sheet and did nothing, with no toast and no way to get the text.
  // copyText throws there and when a write is refused; the failure shows the
  // text itself so it can be read off.
  const copyOrShow = (text: string, done: string) => {
    copyText(text).then(
      () => showToast({ message: done }),
      () => showToast({ message: `Couldn't Copy \u00b7 ${text}` }),
    );
  };
  const toggleDay = (d: number) => set({ days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort((a, b) => a - b) });
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Booking" back="Settings" onBack={onBack} />
      <Head label="Your Times" />
      <Card>
        <Switch label="Available for Booking" meta={s.available ? lineCase(`${s.days.length} ${s.days.length === 1 ? "day" : "days"} a week`) : "Nobody Can Book You"} on={s.available} onToggle={() => set({ available: !s.available })} />
        <div className="row set-row">
          {/* SEVEN EQUAL COLUMNS, NOT A SCROLLING STRIP (2026-10-05): the strip clipped and faded its seventh chip, so Saturday
              and Sunday, both off, drew as two different states. A grid shows all seven whole, every one the same off style.
              WITH AVAILABLE OFF THE GROUP IS WASHED (the round 2 review: "Nobody Can Book You" over five fully lit days). Still a tap
              away, so a person can set the week before turning it on, but it no longer reads as live. */}
          <div className={"set-grid set-grid-days" + (s.available ? "" : " set-grid-off")} role="group" aria-label="Days you take bookings">
            {DAYS.map((d, i) => (
              <div key={i} {...pressable(() => toggleDay(i))} className={"chip" + (s.days.includes(i) ? " active" : "")} aria-pressed={s.days.includes(i)} aria-label={DAY_FULL[i]}>{d}</div>
            ))}
          </div>
        </div>
      </Card>
      <Head label="Duration" />
      <Card>
        <div className="row set-row">
          {/* FOUR EQUAL COLUMNS (2026-10-05): the wrapping row left 60 Min alone on a second line. One choice of four is one row. */}
          <div className={"set-grid set-grid-slots" + (s.available ? "" : " set-grid-off")} role="group" aria-label="Slot length">
            {DURATIONS.map((m) => (
              <div key={m} {...pressable(() => set({ durationMin: m as BookingDuration }))} className={"chip" + (s.durationMin === m ? " active" : "")} aria-pressed={s.durationMin === m}>{lineCase(`${m} min`)}</div>
            ))}
          </div>
        </div>
      </Card>
      {/* THE PUBLISH IS THE HEAD'S (Dave 2026-10-05, locked: an action never sits alone in a box). With no link the section is
          a crafted empty state (a glyph, its title, one warm line) and the one capsule that fills it is on the head; with a link
          the card holds the address and Take the Link Down, and the same capsule says what it does now. */}
      <Head label="Your Link"
        action={{ label: busy ? "Saving" : link ? (dirty ? "Update the Link" : "Republish") : "Publish My Times", onClick: () => void publish(), disabled: busy }} />
      <Card>
        {link ? (
          <>
            <div className="row set-row" {...pressable(() => copyOrShow(linkUrl(link.slug), "Link Copied"))}>
              <div className="row-grow">
                <div className="conn-name">{linkUrl(link.slug)}</div>
                {/* A link an older build published as named_contacts is still
                    stored that way, and the public page answers 404 to everyone
                    until it is republished (2026-10-04). */}
                <div className="conn-meta">{link.visibility === "named_contacts" ? "Closed to Everyone, Republish to Open It" : link.days > 0 ? lineCase(`Open ${link.days} ${link.days === 1 ? "day" : "days"} a week, tap to copy`) : "No Hours Set, Nobody Can Book"}</div>
              </div>
            </div>
            <DangerRow label="Take the Link Down" onClick={() => void takeDown()} disabled={busy} />
          </>
        ) : (
          <div className="empty-state empty-compact">
            <div className="empty-icon cat-fg-blue"><Link2 className="ic" /></div>
            <div className="empty-title">No Link Yet</div>
            <div className="empty-sub">Publish to Get a Link to Share</div>
          </div>
        )}
      </Card>
      {/* ONE ANSWER, SAID AS A NOTE (2026-10-04, then the round 2 review). The server serves the link to anyone who holds it and never reads
          who may book, so there is nothing to choose, and a card in the settings style with no control in it read as a setting that did
          nothing. It is a field note under the link it is about. */}
      <Foot>Anyone with the link can book, and it is not listed anywhere</Foot>
      <Foot>Your times stay on this device until you publish them to the booking server</Foot>
      <Foot>Taking the link down never cancels a booking you already have</Foot>
      {/* THE ADD IS THE HEAD'S (Dave 2026-10-05, locked); the card keeps its own words when there are no days off (an empty state with a title of its own, rule 12). */}
      <Head label="Days Off" action={{ label: "Add a Day Off", onClick: () => { setDayErr(null); setAddingDay(true); }, disabled: busy }} />
      <Card>
        {daysOff.length > 0 ? daysOff.map((d) => (
          <div className="row" key={d} {...pressable(() => setActingDay(d))}>
            <div className="row-grow">
              <div className="conn-name">{dayOffLabel(d)}</div>
            </div>
          </div>
        )) : (
          <div className="empty-state empty-compact">
            <div className="empty-icon cat-fg-sky"><CalendarDays className="ic" /></div>
            <div className="empty-title">No Days Off</div>
            <div className="empty-sub">Block a Day and Nobody Can Book It</div>
          </div>
        )}
      </Card>
      <Foot>A day off beats your hours for that day, and it never touches a booking you already have</Foot>
      {link && (
        <>
          <Head label="Booked So Far" />
          {/* A list with nothing in it draws no card (2026-10-05, rule 2: "Nobody Yet" in a box was a placeholder row). The note
              says it once; a list that could not be asked says that instead. */}
          {booked === null && <Card><div className="row"><div className="row-grow"><div className="conn-name">Could Not Reach the Booking Server</div></div></div></Card>}
          {booked && booked.length > 0 && (
            <Card>
              {booked.map((b) => {
                const m = mapBooking(b);
                if (!m) return null;
                return (
                  <div className="row" key={b.id} {...pressable(() => setActing(b))}>
                    <div className="row-grow">
                      <div className="conn-name">{m.title}</div>
                      <div className="conn-meta"><When b={b} /></div>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
          <Foot>{booked && booked.length === 0 ? "Nobody has booked yet, and new bookings land on your schedule too" : "These are on your schedule too, so you do not have to come back here to find them"}</Foot>
        </>
      )}
      <div className="screen-foot" />
      {acting && (
        <RowActionSheet
          title={mapBooking(acting)?.title}
          actions={[
            ...(acting.guestEmail ? [{
              label: "Copy Their Email",
              onPick: () => {
                const email = acting.guestEmail;
                setActing(null);
                copyOrShow(email, "Email Copied");
              },
            }] : []),
            {
              label: "Cancel This Booking",
              destructive: true,
              onPick: () => { setCancelErr(null); setCancelling(acting); setActing(null); },
            },
          ]}
          onCancel={() => setActing(null)}
        />
      )}
      {actingDay && (
        <RowActionSheet
          title={dayOffLabel(actingDay)}
          actions={[{
            label: "Take This Day Back",
            onPick: () => {
              const day = actingDay;
              setActingDay(null);
              void writeDays(daysOff.filter((x) => x !== day));
            },
          }]}
          onCancel={() => setActingDay(null)}
        />
      )}
      {addingDay && (
        <DayOffSheet
          taken={daysOff}
          busy={busy}
          error={dayErr}
          onCancel={() => setAddingDay(false)}
          onAdd={(date) => void writeDays([...daysOff, date], () => setAddingDay(false))}
        />
      )}
      {cancelling && (
        <CancelBookingSheet
          booking={cancelling}
          busy={busy}
          error={cancelErr}
          onCancel={() => setCancelling(null)}
          onConfirm={(reason) => void doCancel(cancelling, reason)}
        />
      )}
    </div>
  );
}
