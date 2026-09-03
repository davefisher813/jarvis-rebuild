import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Store, InMemoryAdapter } from "@core";
import { AIService } from "../ai/AIService";
import { HealthService } from "../health/HealthService";
import HealthFlow from "../health/HealthFlow";
import "../styles/jarvis-design-system.css";
import "../styles/uniformity.css";
import "../styles/components.css";
import "../styles/ruled.css";

// Health bench (dev only): walks all 21 src/health/screens/*.tsx with real
// content, offline of the module's own wiring into AppShell -- HealthFlow
// has zero importers there yet (see laws.test.ts's own exemption note), so
// this bench is the only way to see the ported screens rendered at all.
// Same shape as bench-email.html / bench-cond.html: a fake AIService, a
// seeded Store, no real network.

const NOW = Date.now();
const DAY = 86400000;
const day = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString().slice(0, 10);

const store = new Store(new InMemoryAdapter());
const svc = new HealthService(store, "bench");

async function seed() {
  // Lights Out: three prior nights, so "Last Time" has a real row.
  for (const d of [-3, -2, -1]) svc.logLightsOut(NOW + d * DAY + 22 * 3600000);
  // Ate Before: a couple of marks, so the timeline dots render.
  svc.logAteBefore({ eventId: "e_prev1", eventTitle: "Practice", date: day(-2), ate: true }, NOW - 2 * DAY);
  svc.logAteBefore({ eventId: "e_prev2", eventTitle: "Scrimmage", date: day(-1), ate: false }, NOW - DAY);
  // Took It: several taps, so the Med Window and the timeline have facts.
  for (const d of [-3, -2, -1, 0]) svc.logTookIt(NOW + d * DAY + 7 * 3600000);
  // Call It: recent session RPEs.
  svc.logCallIt({ eventId: "e_sess1", durationMin: 75, rpe: 6 }, NOW - 2 * DAY);
  svc.logCallIt({ eventId: "e_sess2", durationMin: 90, rpe: 8 }, NOW - DAY);
  // Point at It: a repeated spot, so "Still There?" has a row.
  svc.logPointAtIt({ x: 0.4, y: 0.6, side: "front" }, NOW - 3 * DAY);
  svc.logPointAtIt({ x: 0.42, y: 0.58, side: "front" }, NOW - DAY);
  // Med Refill: a fill logged a while back, drawn down by the TookIt taps
  // above, so Refill Runway can show either state depending on count.
  svc.logMedRefill({ filledAt: NOW - 25 * DAY, dosesInFill: 30 }, NOW - 25 * DAY);
  // The Bag: one event, half-checked.
  svc.logBagCheck({ eventId: "e_bag1", eventTitle: "Away Game", date: day(2), items: [{ key: "water", checked: true }] }, NOW - 3600000);
  // The Locker: one doc on file, one expiring soon.
  svc.logLockerDoc({ kind: "physical", label: "Physical", expiresAt: day(60) }, NOW - 10 * DAY);
  svc.logLockerDoc({ kind: "insurance", label: "Insurance", expiresAt: day(4) }, NOW - 5 * DAY);
  // Trusted Adult, so Say It to Someone shows the saved-person row.
  await svc.setTrustedAdult("Coach Ridgeley", "555-0139");
  await svc.flush();
}

const ai = new AIService({
  available: true,
  fetchImpl: (async () => ({
    ok: true,
    json: async () => ({ text: JSON.stringify({ org: "Travel Team", events: [{ title: "Practice", date: day(3), start: "17:30" }, { title: "Game", date: day(5), start: "10:00", end: "12:00" }] }) }),
  })) as unknown as typeof fetch,
});

const SCREENS: { key: string; label: string }[] = [
  { key: "share", label: "The Share Line" },
  { key: "whatTheySee", label: "What They See" },
  { key: "lightsOut", label: "Lights Out" },
  { key: "ateBefore", label: "Ate Before" },
  { key: "tookIt", label: "Took It" },
  { key: "callIt", label: "Call It" },
  { key: "pointAtIt", label: "Point at It" },
  { key: "refillRunway", label: "Refill Runway" },
  { key: "medWindow", label: "The Med Window" },
  { key: "doctorReport", label: "Take This to the Doctor" },
  { key: "nightBefore", label: "The Night Before" },
  { key: "eatingWindows", label: "Eating Windows" },
  { key: "theBag", label: "The Bag" },
  { key: "thirdPractice", label: "The Third Practice" },
  { key: "weekShape", label: "Week Shape" },
  { key: "twoDaysOff", label: "Two Days Off" },
  { key: "ageRule", label: "The Age Rule" },
  { key: "sayItToSomeone", label: "Say It to Someone" },
  { key: "seasonFeed", label: "The Season Feed" },
  { key: "locker", label: "The Locker" },
  { key: "handoff", label: "The Handoff" },
];

const weekDates = Array.from({ length: 7 }, (_, i) => day(i - 3));

function Bench() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<string>("share");
  const [picking, setPicking] = useState(true);

  useEffect(() => { void seed().then(() => setReady(true)); }, []);

  if (!ready) return <div style={{ padding: 20, color: "#fff" }}>Seeding...</div>;

  return (
    <>
      {picking && (
        <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "#000", overflow: "auto", padding: 16 }}>
          <div style={{ color: "#fff", fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Health Bench</div>
          {SCREENS.map((s) => (
            <button
              key={s.key}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 14px", marginBottom: 6, background: "#1C1C1E", color: "#fff", border: 0, borderRadius: 10, fontSize: 15 }}
              onClick={() => { setScreen(s.key); setPicking(false); }}
            >{s.label}</button>
          ))}
        </div>
      )}
      {!picking && (
        <>
          <button
            style={{ position: "fixed", top: 8, right: 8, zIndex: 998, background: "#FF2B3C", color: "#fff", border: 0, borderRadius: 8, padding: "6px 10px", fontSize: 12 }}
            onClick={() => setPicking(true)}
          >Menu</button>
          <HealthFlow
            key={screen}
            store={store}
            ownerId="bench"
            initialScreen={screen as never}
            onExit={() => setPicking(true)}
            candidates={[
              { eventId: "e_today1", eventTitle: "Practice", date: day(0) },
              { eventId: "e_today2", eventTitle: "Game vs Northlake", date: day(0) },
            ]}
            callItDuration={75}
            sportSessions={[
              { date: day(0), org: "School Team", durationMin: 90 },
              { date: day(0), org: "Travel Team", durationMin: 60 },
              { date: day(-1), org: "School Team", durationMin: 75 },
              { date: day(-3), org: "School Team", durationMin: 80 },
            ]}
            weekDates={weekDates}
            athleteAgeYears={15}
            monthsInSeason={9}
            nightBeforeCommitments={[{ title: "Bus to Regionals", at: NOW + 14 * 3600000 }]}
            eatingWindowBlocks={[
              { title: "School", start: NOW + 8 * 3600000, end: NOW + 14.8 * 3600000 },
              { title: "Practice", start: NOW + 15.1 * 3600000, end: NOW + 17 * 3600000 },
            ]}
            sessionStarts={[{ date: day(0), at: NOW - 3600000, title: "Practice" }]}
            bagEvent={{ eventId: "e_bag1", eventTitle: "Away Game", date: day(2) }}
            ai={ai}
            onOffer={() => {}}
            onLandParentTask={() => {}}
            onCommitSeasonFeed={() => {}}
          />
        </>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Bench />);
