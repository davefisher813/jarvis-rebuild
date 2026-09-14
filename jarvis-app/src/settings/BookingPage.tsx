import { useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Head, Card, Switch, Menu, Foot } from "./kit";
import { pressable } from "../shared/pressable";
import { capAfterNumber } from "../shared/casing";
import {
  readBookingSettings, updateBookingSettings, DURATIONS, WHO_LABEL, VISIBILITY_LABEL,
  type BookingSettings, type BookingWho, type BookingVisibility, type BookingDuration,
} from "../booking/settings";

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
  const set = (patch: Partial<BookingSettings>) => setS(updateBookingSettings(patch));
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
      <Head label="Your Links" />
      <Card>
        <div className="row">
          <div className="row-grow">
            <div className="conn-name">No Links Yet</div>
            <div className="conn-meta">A booking link needs the booking server, which is not deployed</div>
          </div>
        </div>
      </Card>
      <Foot>These times are kept on this device for now and seed your availability the day the booking server exists.</Foot>
      <div className="screen-foot" />
    </div>
  );
}
