import { useCallback, useEffect, useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Head, Card, Switch, Menu, Foot } from "./kit";
import { pressable } from "../shared/pressable";
import { capAfterNumber } from "../shared/casing";
import {
  readBookingSettings, updateBookingSettings, DURATIONS, WHO_LABEL, VISIBILITY_LABEL,
  type BookingSettings, type BookingWho, type BookingVisibility, type BookingDuration,
} from "../booking/settings";
import { readLink, saveLink, removeLink, linkUrl, type LinkFace } from "../booking/link";
import { showToast } from "../shared/toast";

// YOUR TIMES (Track 3, 2026-09-14; the preview's Booking Settings screen:
// "One screen. Day toggles and a duration list, no wizard"). Available or
// not, the days, the slot length, who can book and how the link is found.
// The links list is honest about what does not exist yet: a public booking
// link needs the Track 3 server and its tables (jarvis-core/supabase/track3),
// which have no project to run in, so there is no Share button to press.
const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function BookingPage({ onBack }: { onBack: () => void }) {
  const [s, setS] = useState<BookingSettings>(() => readBookingSettings());
  // THE LINK IS THE SERVER'S (Track 3, 2026-09-19). The settings stay on the
  // device, the way they always have; the LINK is a row in Track 3, so the
  // screen asks for it rather than deciding it. Saving is explicit: a person
  // flicking through day chips is not publishing an address with every tap.
  const [link, setLink] = useState<LinkFace | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const load = useCallback(() => {
    readLink().then(setLink).catch(() => setLink(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (patch: Partial<BookingSettings>) => { setS(updateBookingSettings(patch)); setDirty(true); };

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
              <div className="conn-meta">{link.days > 0 ? capAfterNumber(`Open ${link.days} ${link.days === 1 ? "day" : "days"} a week \u00b7 Tap to copy`) : "No hours set \u00b7 Nobody can book"}</div>
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
          <button type="button" className="row xs-row xs-del" onClick={() => void takeDown()} disabled={busy}>Take the Link Down</button>
        )}
      </Card>
      <Foot>Your times stay on this device. Publishing writes them to the booking server so the address above can offer them; taking the link down clears the hours and never cancels a booking you already have.</Foot>
      <div className="screen-foot" />
    </div>
  );
}
