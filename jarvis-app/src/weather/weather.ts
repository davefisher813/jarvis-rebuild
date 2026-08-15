// Weather Fact (addendum item 4). Facts, not theater: a line renders ONLY
// when a threshold is crossed (rain likely, real heat, real cold, real
// wind); a mild day says nothing anywhere. Data is Open-Meteo, fetched
// client-side against the remembered coarse location (Tier 1), cached and
// served stale with its age shown rather than refetched eagerly. The v1 law
// from the spec: weather NEVER adjusts Leave By math or any other number in
// the app; it only ever adds a line a human reads.

export interface HourlyWeather {
  // ISO hour strings aligned with the arrays below, e.g. "2026-08-15T14:00".
  time: string[];
  tempF: number[];
  precipProb: number[]; // 0-100
  windMph: number[];
}

export interface WeatherSnapshot {
  fetchedAt: number; // epoch ms
  hourly: HourlyWeather;
}

export interface Coords { lat: number; lon: number }

const LOC_KEY = "jarvis.location.v1";
const WX_KEY = "jarvis.weather.v1";
export const WX_TTL_MS = 30 * 60_000;

// Thresholds (the gate). Below all of these, silence.
export const RAIN_PROB_MIN = 40;
export const HOT_F = 85;
export const COLD_F = 32;
export const WINDY_MPH = 20;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readCoords(): Coords | null {
  const s = storage();
  if (!s) return null;
  try {
    const c = JSON.parse(s.getItem(LOC_KEY) || "null") as Coords | null;
    return c && typeof c.lat === "number" && typeof c.lon === "number" ? c : null;
  } catch {
    return null;
  }
}

// Tier 1 location: coarse, remembered once, never re-asked by code (the ONE
// ask is a user tap on the offer row; declining leaves no trace to nag from).
export function writeCoords(c: Coords): void {
  const s = storage();
  if (!s) return;
  try {
    // Coarse on purpose: two decimals is a neighborhood, which is all a
    // forecast needs, and all this app should hold.
    s.setItem(LOC_KEY, JSON.stringify({ lat: Math.round(c.lat * 100) / 100, lon: Math.round(c.lon * 100) / 100 }));
  } catch { /* no location, no weather; the app shrugs */ }
}

export function readSnapshot(): WeatherSnapshot | null {
  const s = storage();
  if (!s) return null;
  try {
    const w = JSON.parse(s.getItem(WX_KEY) || "null") as WeatherSnapshot | null;
    return w && w.hourly && Array.isArray(w.hourly.time) ? w : null;
  } catch {
    return null;
  }
}

export function writeSnapshot(w: WeatherSnapshot): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(WX_KEY, JSON.stringify(w));
  } catch { /* stale beats nothing; nothing beats a crash */ }
}

// Fetch, cache-first. Fresh cache: no network at all. Failure: the stale
// snapshot (age will show) or null.
export async function getWeather(now: () => number = Date.now, fetchImpl: typeof fetch = fetch): Promise<WeatherSnapshot | null> {
  const cached = readSnapshot();
  if (cached && now() - cached.fetchedAt < WX_TTL_MS) return cached;
  const coords = readCoords();
  if (!coords) return cached;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}` +
      "&hourly=temperature_2m,precipitation_probability,windspeed_10m" +
      "&temperature_unit=fahrenheit&windspeed_unit=mph&forecast_days=2&timezone=auto";
    const res = await fetchImpl(url);
    if (!res.ok) return cached;
    const j = (await res.json()) as {
      hourly?: { time?: string[]; temperature_2m?: number[]; precipitation_probability?: number[]; windspeed_10m?: number[] };
    };
    if (!j.hourly?.time) return cached;
    const snap: WeatherSnapshot = {
      fetchedAt: now(),
      hourly: {
        time: j.hourly.time,
        tempF: j.hourly.temperature_2m ?? [],
        precipProb: j.hourly.precipitation_probability ?? [],
        windMph: j.hourly.windspeed_10m ?? [],
      },
    };
    writeSnapshot(snap);
    return snap;
  } catch {
    return cached;
  }
}

function hourIndex(hourly: HourlyWeather, isoHour: string): number {
  return hourly.time.findIndex((t) => t.startsWith(isoHour));
}

const fmtHour = (iso: string): string => {
  const h = parseInt(iso.slice(11, 13), 10);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ap}`;
};

// "Checked 20 min ago" once the snapshot is older than 15 minutes; a fresh
// read earns no caveat. Hours after that; a snapshot older than a day says
// nothing at all (a two-day-old forecast is not a fact worth stating).
export function staleSuffix(snap: WeatherSnapshot, now: () => number = Date.now): string | null {
  const age = now() - snap.fetchedAt;
  if (age > 24 * 3600e3) return null;
  if (age < 15 * 60_000) return "";
  const mins = Math.round(age / 60_000);
  if (mins < 90) return ` · checked ${mins} min ago`;
  return ` · checked ${Math.round(mins / 60)} hr ago`;
}

// The morning line: today's first rain window, or the day's extreme, or
// nothing. One sentence, one fact.
export function morningLine(snap: WeatherSnapshot, todayIso: string, now: () => number = Date.now): string | null {
  const stale = staleSuffix(snap, now);
  if (stale === null) return null;
  const { hourly } = snap;
  const idx = hourly.time.map((t, i) => ({ t, i })).filter((x) => x.t.startsWith(todayIso));
  if (idx.length === 0) return null;

  // Rain window: first run of hours at/above the probability gate.
  let rainStart = -1;
  let rainEnd = -1;
  for (const { i } of idx) {
    const p = hourly.precipProb[i] ?? 0;
    if (p >= RAIN_PROB_MIN) {
      if (rainStart < 0) rainStart = i;
      rainEnd = i;
    } else if (rainStart >= 0) break;
  }
  if (rainStart >= 0) {
    const until = hourly.time[rainEnd + 1];
    const line = until && until.startsWith(todayIso)
      ? `Rain likely ${fmtHour(hourly.time[rainStart]!)}-${fmtHour(until)}`
      : `Rain likely from ${fmtHour(hourly.time[rainStart]!)}`;
    return line + stale;
  }

  const temps = idx.map(({ i }) => hourly.tempF[i] ?? 70);
  const hi = Math.max(...temps);
  const lo = Math.min(...temps);
  if (hi >= HOT_F) return `${Math.round(hi)} at the peak` + stale;
  if (lo <= COLD_F) return `Down to ${Math.round(lo)}` + stale;

  const wind = Math.max(...idx.map(({ i }) => hourly.windMph[i] ?? 0));
  if (wind >= WINDY_MPH) return `Wind to ${Math.round(wind)} mph` + stale;

  return null; // mild: silence
}

// The day-of line for an event with a place: conditions at its start hour,
// only when a threshold is crossed there.
export function eventLine(snap: WeatherSnapshot, dateIso: string, startHHMM: string, now: () => number = Date.now): string | null {
  const stale = staleSuffix(snap, now);
  if (stale === null) return null;
  const i = hourIndex(snap.hourly, `${dateIso}T${startHHMM.slice(0, 2)}:00`);
  if (i < 0) return null;
  const p = snap.hourly.precipProb[i] ?? 0;
  const t = snap.hourly.tempF[i];
  const w = snap.hourly.windMph[i] ?? 0;
  if (p >= RAIN_PROB_MIN) return `Rain likely at start` + stale;
  if (t !== undefined && t >= HOT_F) return `${Math.round(t)} at start` + stale;
  if (t !== undefined && t <= COLD_F) return `${Math.round(t)} at start` + stale;
  if (w >= WINDY_MPH) return `Wind to ${Math.round(w)} mph at start` + stale;
  return null;
}
