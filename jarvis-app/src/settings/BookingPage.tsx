import { useCallback, useEffect, useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Head, Card, Switch, Menu, Foot, DangerRow } from "./kit";
import { pressable } from "../shared/pressable";
import { capAfterNumber } from "../shared/casing";
import {
  readBookingSettings, updateBookingSettings, DURATIONS, WHO_LABEL, VISIBILITY_LABEL,
  type BookingSettings, type BookingWho, type BookingVisibility, type BookingDuration,
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

// YOUR TIMES (Track 3, 2026-09-14; the preview's Booking Settings screen:
// "One screen. Day toggles and a duration list, no wizard"). Available or
// not, the days, the slot length, who can book and how the link is found.
//
// The link and the bookings on it are the SERVER's (Track 3, 2026-09-19), so
// the screen asks for both rather than deciding either. What was once an
// honest note about a server that did not exist is now a published address and
// the list of people who have used it.
const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The day and time of a booking, on this device's clock, because that is the
 *  clock the person reading this screen is standing on. Two neutral facts,
 *  so two small-caps dates with the stylesheet's separator between them
 *  (§AM F5, 2026-09-26), never a dot typed into one string. */
function When({ b }: { b: BookingFace }) {
  const d = new Date(b.startMs);
  const day = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return <><span className="fact date">{day}</span><span className="fact date">{time}</span></>;
}

// The two reads are injectable, the same way PublicBookingPage takes its
// fetch: this screen's interesting states are the ones a running app cannot be
// put into on demand, a published link and somebody having booked on it.
export default function BookingPage({
  onBack,
  readLinkImpl = readLink,
  readBookingsImpl = readBookings,
  cancelImpl = cancelBooking,
  readDaysOffImpl = readDaysOff,
  saveDaysOffImpl = saveDaysOff,
}: {
  onBack: () => void;
  readLinkImpl?: typeof readLink;
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
      const made = await saveLink(s);
      setLink(made);
      setDirty(false);
      showToast({ message: made ? "Your Link Is Live" : "Saved on This Device" });
    } catch {
      showToast({ message: "Couldn't reach the booking server \u00b7 Try again" });
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
      showToast({ message: "Couldn't reach the booking server \u00b7 Try again" });
    } finally { setBusy(false); }
  };
  const toggleDay = (d: number) => set({ days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort((a, b) => a - b) });
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Booking" back="Settings" onBack={onBack} />
      <Head label="Your Times" />
      <Card>
        <Switch label="Available for Booking" meta={s.available ? capAfterNumber(`${s.days.length} ${s.days.length === 1 ? "day" : "days"} a week`) : "Nobody can book you"} on={s.available} onToggle={() => set({ available: !s.available })} />
        <div className="row set-row">
          <div className="chip-row" role="group" aria-label="Days you take bookings">
            {DAYS.map((d, i) => (
              <div key={i} {...pressable(() => toggleDay(i))} className={"chip" + (s.days.includes(i) ? " active" : "")} aria-pressed={s.days.includes(i)} aria-label={DAY_FULL[i]}>{d}</div>
            ))}
          </div>
        </div>
      </Card>
      <Head label="Duration" />
      <Card>
        <div className="row set-row">
          <div className="chip-row" role="group" aria-label="Slot length">
            {DURATIONS.map((m) => (
              <div key={m} {...pressable(() => set({ durationMin: m as BookingDuration }))} className={"chip" + (s.durationMin === m ? " active" : "")} aria-pressed={s.durationMin === m}>{capAfterNumber(`${m} min`)}</div>
            ))}
          </div>
        </div>
      </Card>
      <Head label="Who Can Book" />
      <Card>
        <Menu label="Who Can Book" value={s.who} ariaLabel="Who can book" word={WHO_LABEL[s.who]}
          options={(Object.keys(WHO_LABEL) as BookingWho[]).map((k) => ({ value: k, label: WHO_LABEL[k] }))}
          onPick={(v) => set({ who: v as BookingWho })} />
        <Menu label="Visibility" value={s.visibility} ariaLabel="Visibility" word={VISIBILITY_LABEL[s.visibility]}
          options={(Object.keys(VISIBILITY_LABEL) as BookingVisibility[]).map((k) => ({ value: k, label: VISIBILITY_LABEL[k] }))}
          onPick={(v) => set({ visibility: v as BookingVisibility })} />
      </Card>
      <Head label="Your Link" />
      <Card>
        {link ? (
          <div className="row set-row" {...pressable(() => {
            const url = linkUrl(link.slug);
            navigator.clipboard?.writeText(url).then(
              () => showToast({ message: "Link Copied" }),
              () => showToast({ message: url }),
            );
          })}>
            <div className="row-grow">
              <div className="conn-name">{linkUrl(link.slug)}</div>
              <div className="conn-meta">{link.days > 0 ? capAfterNumber(`Open ${link.days} ${link.days === 1 ? "day" : "days"} a week, tap to copy`) : "No hours set, nobody can book"}</div>
            </div>
          </div>
        ) : (
          <div className="row">
            <div className="row-grow">
              <div className="conn-name">No Link Yet</div>
              <div className="conn-meta">Publish your times to get an address you can give out</div>
            </div>
          </div>
        )}
        {/* Not a row: a row in this app is a door, and this is a block
            holding one button. It takes the card's own padding instead. */}
        <div className="set-publish">
          <button type="button" className="btn btn-primary btn-block" onClick={() => void publish()} disabled={busy}>
            {busy ? "Saving" : link ? (dirty ? "Update the Link" : "Republish") : "Publish My Times"}
          </button>
        </div>
        {link && (
          <DangerRow label="Take the Link Down" onClick={() => void takeDown()} disabled={busy} />
        )}
      </Card>
      <Foot>Your times stay on this device. Publishing writes them to the booking server so the address above can offer them; taking the link down clears the hours and never cancels a booking you already have.</Foot>
      <Head label="Days Off" />
      <Card>
        {daysOff.length > 0 ? daysOff.map((d) => (
          <div className="row" key={d} {...pressable(() => setActingDay(d))}>
            <div className="row-grow">
              <div className="conn-name">{dayOffLabel(d)}</div>
            </div>
          </div>
        )) : (
          <div className="row">
            <div className="row-grow">
              <div className="conn-name">No Days Off</div>
              <div className="conn-meta">Your hours run every week you set them</div>
            </div>
          </div>
        )}
        <div className="set-publish">
          <button type="button" className="btn btn-block" onClick={() => { setDayErr(null); setAddingDay(true); }} disabled={busy}>Add a Day Off</button>
        </div>
      </Card>
      <Foot>A day off beats your hours for that day, and it never touches a booking you already have.</Foot>
      {link && (
        <>
          <Head label="Booked So Far" />
          <Card>
            {booked && booked.length > 0 ? booked.map((b) => {
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
            }) : (
              <div className="row">
                <div className="row-grow">
                  <div className="conn-name">Nobody Yet</div>
                  <div className="conn-meta">{booked === null ? "Could not reach the booking server" : "Every booking also lands on your schedule"}</div>
                </div>
              </div>
            )}
          </Card>
          <Foot>These are on your schedule too, so you do not have to come back here to find them.</Foot>
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
                navigator.clipboard?.writeText(email).then(
                  () => showToast({ message: "Email Copied" }),
                  () => showToast({ message: email }),
                );
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
