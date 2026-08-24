import { useEffect, useState } from "react";
import { getWeather, morningLine, eventLine, readCoords, writeCoords, readSnapshot } from "./weather";
import NoticeCard from "../today/NoticeCard";
import { CloudGlyph } from "../shared/glyphs";

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
  // THE NOTICE LAW (A1, Dave 2026-08-20): this offer lives in the Heads Up
  // stream, so it is built like everything else in it. One visible control,
  // dismiss on the swipe. The promo-card shape stays for surfaces that own
  // their own space; a card in a stream matches the stream.
  return (
    <NoticeCard
      icon={
        <CloudGlyph />
      }
      tone="cat-fg-sky"
      title="Add Weather to Your Day"
      sub="One line each morning, only when it matters"
      action={{ label: "Allow", onClick: grant }}
      onDismiss={dismiss}
    />
  );
}
