import { useRef, type ReactNode } from "react";
import { Tile } from "./FormSheet";

// THE PICKER ROW (2026-10-05, the perfect bar). A form row whose value is a day or a clock used to be the raw native
// input: "10/05/2026" with the browser's own calendar glyph, and "--:-- --" with a clock glyph and no words, which
// read as a field that had not loaded. This row says the value the way the app says it ("Today", "9:00 AM"), right aligned
// in the same value ink every dropdown row wears and drawn by the same classes the event sheet's own pickers use
// (`.xs-pick`, `.xs-pick-v`), so a date or a time reads the same on every sheet. The real native input lies over the
// WHOLE row, transparent, so a tap anywhere on it opens the system's own picker (iOS's wheel, the browser's calendar) and
// nothing about the picking is reinvented. A value that is not set yet says what to do in the quiet ink every unset value
// wears ("None"), and a refused Save turns it the sheet's late red.
export default function PickRow({ tone, glyph, label, kind, value, onChange, ariaLabel, display, emptyWord, error = false }: {
  tone: string;
  glyph: ReactNode;
  label: string;
  kind: "date" | "time";
  /** The ISO day (YYYY-MM-DD) or the clock (HH:MM) the native input holds; empty when unset. */
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  /** The value in the app's words; the caller owns the formatting ("Today", "Tomorrow", "9:00 AM"). */
  display: string;
  /** What the row says while nothing is set ("Pick a Time"). */
  emptyWord: string;
  error?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const empty = !value;
  return (
    <div className={"row xs-row pick-row" + (error ? " pick-error" : "")}>
      <Tile tone={tone}>{glyph}</Tile>
      <div className="conn-name">{label}</div>
      <span className={"xs-pick" + (error ? " xs-pick-bad" : "") + (empty ? " xs-pick-off" : "")} aria-hidden="true">
        <span className="xs-pick-v">{empty ? emptyWord : display}</span>
      </span>
      <input
        ref={input}
        className={"pick-native" + (error ? " input-error" : "")}
        type={kind}
        aria-label={ariaLabel}
        aria-invalid={error || undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={() => { try { input.current?.showPicker?.(); } catch { /* the picker needs a user gesture on some engines; the native tap opens it */ } }}
      />
    </div>
  );
}
