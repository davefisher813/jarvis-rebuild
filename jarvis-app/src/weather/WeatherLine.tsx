import { useEffect, useState } from "react";
import { getWeather, morningLine, eventLine, readCoords, writeCoords, readSnapshot } from "./weather";

// The Weather Fact renderers (addendum item 4). Self-contained: they read
// the cache, fetch when it is stale, and render NOTHING on mild days, with
// no location, or while loading. Weather never blocks a paint and never
// adjusts a number anywhere else in the app.

export function MorningWeatherLine({ todayIso }: { todayIso: string }) {
  const [line, setLine] = useState<string | null>(() => {
    const snap = readSnapshot();
    return snap ? morningLine(snap, todayIso) : null;
  });
  useEffect(() => {
    let on = true;
    void getWeather().then((snap) => { if (on && snap) setLine(morningLine(snap, todayIso)); });
    return () => { on = false; };
  }, [todayIso]);
  if (!line) return null;
  return <div className="conn-meta weather-line">{line}</div>;
}

export function EventWeatherLine({ dateIso, start }: { dateIso: string; start: string }) {
  const [line, setLine] = useState<string | null>(() => {
    const snap = readSnapshot();
    return snap ? eventLine(snap, dateIso, start) : null;
  });
  useEffect(() => {
    let on = true;
    void getWeather().then((snap) => { if (on && snap) setLine(eventLine(snap, dateIso, start)); });
    return () => { on = false; };
  }, [dateIso, start]);
  if (!line) return null;
  return <span className="weather-inline">{line}</span>;
}

const OFFER_KEY = "jarvis.weather.offer.v1";

// The one-time connect moment, same doctrine as the gym page's Health row:
// a single row, appears once, disappears forever on decline. Granting stores
// a COARSE location (two decimals) and nothing else.
export function WeatherOfferRow() {
  const [state, setState] = useState<"offer" | "gone">(() => {
    try {
      if (readCoords()) return "gone";
      if (typeof localStorage !== "undefined" && localStorage.getItem(OFFER_KEY)) return "gone";
      return "offer";
    } catch {
      return "gone";
    }
  });
  if (state === "gone") return null;
  const dismiss = () => {
    try { localStorage.setItem(OFFER_KEY, "declined"); } catch { /* gone either way */ }
    setState("gone");
  };
  const grant = () => {
    if (!("geolocation" in navigator)) { dismiss(); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        writeCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        try { localStorage.setItem(OFFER_KEY, "granted"); } catch { /* coords saved */ }
        setState("gone");
        void getWeather();
      },
      dismiss,
    );
  };
  // Catalog V3.1 tip banner (approved 2026-08-18): glyph, Title Case title,
  // gray sub, X to dismiss, Allow as the one primary action.
  return (
    <div className="tip-banner">
      <div className="tip-ico">
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 19a4.5 4.5 0 1 0 0-9h-1.8A7 7 0 1 0 4 14.9" /></svg>
      </div>
      <div className="tip-body">
        <div className="tip-title">Add Weather to Your Day</div>
        <div className="tip-sub">One line each morning · only when it matters</div>
        <div className="tip-acts">
          <button className="btn btn-primary btn-sm" onClick={grant}>Allow</button>
        </div>
      </div>
      <button className="tip-x" aria-label="Dismiss" onClick={dismiss}>
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </div>
  );
}
