import { useEffect, useState } from "react";
import { getWeather, morningFact, eventFact, WEATHER_EMOJI, readCoords, writeCoords, readSnapshot, type WeatherFact } from "./weather";
import NoticeCard from "../today/NoticeCard";
import { CloudGlyph } from "../shared/glyphs";
import { showToast } from "../shared/toast";

// The Weather Fact renderers (addendum item 4). Self-contained: they read
// the cache, fetch when it is stale, and render NOTHING on mild days, with
// no location, or while loading. Weather never blocks a paint and never
// adjusts a number anywhere else in the app.

// THE FORECAST LEADS WITH WHAT IT IS (Dave, 2026-09-15: "add weather emojis
// when there's a weather notification. Right now it's just grey text that
// looks terrible").
//
// Both lines rendered a bare sentence in the page's meta ink, which is the
// same ink as "Until 10:00 AM" and every other piece of furniture around
// them -- so the one line on the page that might change what he wears read
// as the quietest thing on it. The symbol goes first, where the eye lands,
// and the words step up out of --tx-3 to the reading ink they should always
// have had. aria-hidden on the glyph: a screen reader gets "Rain likely 2 PM
// to 5 PM", which already says it, not "cloud with rain" in front of it.
function Fact({ fact }: { fact: WeatherFact }) {
  return (
    <>
      <span className="weather-ico" aria-hidden="true">{WEATHER_EMOJI[fact.kind]}</span>
      {fact.text}
    </>
  );
}

export function MorningWeatherLine({ todayIso }: { todayIso: string }) {
  const [fact, setFact] = useState<WeatherFact | null>(() => {
    const snap = readSnapshot();
    return snap ? morningFact(snap, todayIso) : null;
  });
  useEffect(() => {
    let on = true;
    void getWeather().then((snap) => { if (on && snap) setFact(morningFact(snap, todayIso)); });
    return () => { on = false; };
  }, [todayIso]);
  if (!fact) return null;
  return <div className="weather-line"><Fact fact={fact} /></div>;
}

export function EventWeatherLine({ dateIso, start }: { dateIso: string; start: string }) {
  const [fact, setFact] = useState<WeatherFact | null>(() => {
    const snap = readSnapshot();
    return snap ? eventFact(snap, dateIso, start) : null;
  });
  useEffect(() => {
    let on = true;
    void getWeather().then((snap) => { if (on && snap) setFact(eventFact(snap, dateIso, start)); });
    return () => { on = false; };
  }, [dateIso, start]);
  if (!fact) return null;
  return <span className="weather-inline"><Fact fact={fact} /></span>;
}

const OFFER_KEY = "jarvis.weather.offer.v1";

// The one-time connect moment, same doctrine as the gym page's Health row:
// a single row, appears once, disappears forever on decline. Granting stores
// a COARSE location (two decimals) and nothing else.
// The stream decides the form, never the producer (Law 3E) -- but a member
// whose TYPE is not NoticeCard used to escape that decision entirely: the
// stream's clone pass could not see the card inside. Found 2026-08-26 by the
// strip-the-boxes test, which counted one un-rowed card in a stream that
// promises zero. The form now passes through, and TodayPage clones this
// component the same way it clones a bare NoticeCard.
// `weight` is read by the stream's ranker (TodayPage passes AMBIENT), not by
// this component -- same reason NoticeCard declares and voids it: rankStream
// inspects the JSX element's own props without rendering it, so a prop that
// exists only for that inspection still has to be part of the type (2026-08-26
// soundness pass; this component's outer type has no weight of its own to
// forward, which is exactly how it went unweighted in the first place).
export function WeatherOfferRow({ form = "card", weight }: { form?: "card" | "row"; weight?: number }) {
  void weight;
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
  // TODAY-F-05 (2026-09-05): the error callback WAS `dismiss`, so every way
  // this could fail was recorded as "he said no" and the offer disappeared
  // for good, recoverable only by clearing local data. On the phone it could
  // not even be asked: Info.plist carried no NSLocationWhenInUseUsageDescription,
  // so WebKit cannot request authorization at all, and the one tap on Allow
  // buried the feature permanently. The plist key ships in this commit, and
  // only an actual refusal counts as one here: a timeout or an unavailable
  // fix says so and leaves the offer standing for the next try.
  const grant = () => {
    if (!("geolocation" in navigator)) {
      // Not a decision he made, but nothing here can ever work either, so the
      // row goes rather than asking again forever. It says why first.
      showToast({ message: "This device can't share a location" });
      dismiss();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        writeCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        try { localStorage.setItem(OFFER_KEY, "granted"); } catch { /* coords saved */ }
        setState("gone");
        void getWeather();
      },
      (err) => {
        // Code 1 is PERMISSION_DENIED. Code 2 (position unavailable) and code
        // 3 (timeout) are the phone failing to answer, not the user refusing,
        // and conflating them is what buried this feature.
        if (err.code === 1) { dismiss(); return; }
        showToast({ message: "Couldn't get your location · The offer stays" });
      },
      // A coarse fix is all this stores (two decimals), and an ask with no
      // timeout can hang forever with no callback at all, which is a third
      // way to look like nothing happened.
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  };
  // THE NOTICE LAW (A1, Dave 2026-08-20): this offer lives in the Heads Up
  // stream, so it is built like everything else in it. One visible control,
  // dismiss on the swipe. The promo-card shape stays for surfaces that own
  // their own space; a card in a stream matches the stream.
  return (
    <NoticeCard
      form={form}
      icon={
        <CloudGlyph />
      }
      tone="cat-fg-sky"
      // THE TITLE FITS THE ROOM THE ROW ACTUALLY HAS (measured 2026-09-20 at
      // 390x844, Dave's own width: "Add Weather to Y\u2026"). This offer renders
      // in the grouped Heads Up band, which is one line by his own pick
      // (TodayPage: "long titles truncate to one line, tap opens the full
      // thing"), and that line is 156px after the row spends 194 of its 358
      // on the 30px disc, the 100px action column and the padding. The old
      // title asked 197 and lost 21% of itself; the sub is dropped by the
      // shredded-sub latch before it ever shows here, so the title is the
      // whole offer and half of it was missing.
      //
      // Nothing structural was available to buy the room back. The 100px
      // floor on the pill is the action COLUMN (ruled.css: verbs of different
      // lengths used to leave the buttons ragged, which he reported), and the
      // second line is the band's stood-down two-line box. So the copy is
      // what gives: "Daily" carries the one fact the dropped sub was there to
      // say. Measured at 146 of 156 on Linux, which renders WIDER than the
      // phone's SF, so it clears on the device by more than that.
      //
      // Anything written here again gets measured first. There is no law
      // holding this width, because a character budget would have to guess
      // the font -- the same reason the latch in NoticeCard measures.
      title="Add Daily Weather"
      sub="One line each morning, only when it matters"
      action={{ label: "Allow", onClick: grant }}
      // ROW-TAP (Dave 2026-09-15: "I want all rows clickable"): nothing to
      // open, so the body asks for location, the same safe verb as the pill.
      onOpen={grant}
      onDismiss={dismiss}
    />
  );
}
