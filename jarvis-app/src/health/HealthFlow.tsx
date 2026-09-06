import { useCallback, useEffect, useState } from "react";
import type { Store } from "@core";
import type { AIService } from "../ai/AIService";
import type { EventInput } from "../events";
import { HealthService } from "./HealthService";
import type {
  ConsentGrant, HealthCategoryId, LightsOutEntry, AteBeforeEntry, TookItEntry, CallItEntry, PointAtItEntry,
  MedRefillEntry, BagCheckEntry, LockerDocEntry, LockerDocKind,
} from "./types";
import { stillThere, stillThereSummary, stillThereMessage, tookItTimeline, ateBeforeMarks } from "./timelines";
import { refillRunway, refillOffer } from "./refillRunway";
import { medWindowDays, type SessionStartCandidate } from "./medWindow";
import { buildDoctorReport, doctorReportText } from "./doctorReport";
import { nightBeforeOffer, type FixedCommitment } from "./nightBefore";
import { eatingWindowOffers, type DayBlock } from "./eatingWindows";
import { defaultBagItems, latestBagCheck, toggleItem, checkAll } from "./bag";
import { thirdPracticeOffers } from "./thirdPractice";
import { weekShape } from "./weekShape";
import { restDayOffer } from "./twoDaysOff";
import { ageRuleFacts } from "./ageRule";
import { LOCKER_DOC_LABEL } from "./locker";
import { healthComebackMessage } from "./healthComeback";
import { handoffItems } from "./handoff";
import type { SportSession } from "./loadCandidates";
import type { SeasonFeedDraft } from "./seasonFeed";
import { showToast } from "../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import { capAfterNumber } from "../shared/casing";
import { saveTextFile } from "../shared/saveTextFile";
import { shareText } from "../shared/shareText";
import ShareLineScreen from "./screens/ShareLineScreen";
import WhatTheySeeScreen from "./screens/WhatTheySeeScreen";
import LightsOutScreen from "./screens/LightsOutScreen";
import AteBeforeScreen, { type AteBeforeCandidate } from "./screens/AteBeforeScreen";
import TookItScreen from "./screens/TookItScreen";
import CallItScreen from "./screens/CallItScreen";
import PointAtItScreen from "./screens/PointAtItScreen";
import RefillRunwayScreen from "./screens/RefillRunwayScreen";
import MedWindowScreen from "./screens/MedWindowScreen";
import DoctorReportScreen from "./screens/DoctorReportScreen";
import NightBeforeScreen from "./screens/NightBeforeScreen";
import EatingWindowsScreen from "./screens/EatingWindowsScreen";
import TheBagScreen from "./screens/TheBagScreen";
import ThirdPracticeScreen from "./screens/ThirdPracticeScreen";
import WeekShapeScreen from "./screens/WeekShapeScreen";
import TwoDaysOffScreen from "./screens/TwoDaysOffScreen";
import AgeRuleScreen from "./screens/AgeRuleScreen";
import SayItToSomeoneScreen from "./screens/SayItToSomeoneScreen";
import SeasonFeedScreen from "./screens/SeasonFeedScreen";
import LockerScreen from "./screens/LockerScreen";
import HandoffScreen from "./screens/HandoffScreen";

// HMN-F-06 (2026-09-05): exported now that something outside this module
// chooses which screen to open (brain/CategoryDetail's More menu).
export type ScreenKey =
  | "share" | "whatTheySee" | "lightsOut" | "ateBefore" | "tookIt" | "callIt" | "pointAtIt"
  | "refillRunway" | "medWindow" | "doctorReport" | "nightBefore" | "eatingWindows" | "theBag"
  | "thirdPractice" | "weekShape" | "twoDaysOff" | "ageRule" | "sayItToSomeone" | "seasonFeed"
  | "locker" | "handoff";

function localDay(atMs: number = Date.now()): string {
  const d = new Date(atMs);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function defaultWeekDates(startMs: number = Date.now()): string[] {
  return Array.from({ length: 7 }, (_, i) => localDay(startMs + i * 86400000));
}

// HMN-F-22 (2026-09-05): two branches on this flow returned bare null when
// the thing they needed was absent, which paints a blank screen with no way
// off it. Every screen in this module ends in a way out, so the absence gets
// a screen of its own with the same nav bar the real ones carry.
function NothingHere({ title, sub, onBack }: { title: string; sub: string; onBack: () => void }) {
  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
      </div>
      <div className="empty-state">
        <div className="empty-title">{title}</div>
        <div className="empty-sub">{sub}</div>
      </div>
    </div>
  );
}

function currentSeason(now: number = Date.now()): string {
  const d = new Date(now);
  return d.getFullYear() + "-q" + (Math.floor(d.getMonth() / 3) + 1);
}

// Wires every Track 3 screen to a real HealthService. Screens stay
// presentational (props in, callbacks out); this component owns the data.
//
// EXTERNAL CANDIDATES, same pattern the foundation established with
// `candidates`/`callItDuration`: everything this module reads from the
// calendar or from tasks arrives as a plain prop from outside, so
// src/health never imports src/schedule or src/tasks directly. Whatever
// wires Health into the real app (still out of scope here, same Track 3
// follow-up the foundation already named) supplies these shapes.
export default function HealthFlow({
  store, ownerId, service, onEvent, candidates = [], callItDuration, initialScreen = "share", initialHandOff, onExit,
  sportSessions = [], weekDates, athleteAgeYears, monthsInSeason,
  nightBeforeCommitments = [], eatingWindowBlocks = [], sessionStarts = [],
  bagEvent, ai, onOffer, onLandParentTask, onCommitSeasonFeed,
}: {
  // HMN-F-06 (2026-09-05), option A: the app hands in the service the rest
  // of it already uses (data/NotesProvider's useHealth), so a dose logged
  // through one of these screens is the same row the health area page's own
  // loggers read. The bench and this module's tests build one from a bare
  // store instead, which is what these two props are still for.
  service?: HealthService;
  store?: Store;
  ownerId?: string;
  onEvent?: (e: EventInput) => void;
  candidates?: AteBeforeCandidate[];
  callItDuration?: number;
  initialScreen?: ScreenKey;
  // UP-ATH-05 (2026-09-06): a Still There? summary handed in from outside, so
  // the health area page's own grafted Point at It (brain/CategoryDetail) can
  // walk into Say It to Someone carrying the same message this flow's copy of
  // Point at It builds for itself.
  initialHandOff?: string;
  onExit: () => void;
  // Part 2 (The Third Practice, Week Shape, Two Days Off, The Age Rule):
  // the same calendar candidates, reduced to which org and how long.
  sportSessions?: SportSession[];
  weekDates?: string[]; // 7 local-ISO dates; defaults to today plus the next 6
  athleteAgeYears?: number;
  monthsInSeason?: number;
  // Part 1 (The Night Before): tomorrow's fixed commitments.
  nightBeforeCommitments?: FixedCommitment[];
  // Part 3 (Eating Windows): tomorrow's fixed blocks.
  eatingWindowBlocks?: DayBlock[];
  // Part 4 (The Med Window): today's session starts, with a real timestamp.
  sessionStarts?: SessionStartCandidate[];
  // Part 3 (The Bag): the one calendar event a checklist binds to.
  bagEvent?: { eventId: string; eventTitle: string; date: string };
  // Part 8 (The Season Feed): optional, since extraction needs a live model.
  ai?: AIService;
  // Fired when a calendar-shaped offer is taken (The Night Before, Eating
  // Windows, The Third Practice, Two Days Off, The Age Rule). The real
  // Routine-block/task creation is schedule/tasks' job, out of scope here;
  // this is the seam a real wiring layer hangs off.
  // HMN-F-06 (2026-09-05): a wired caller writes something real here (the
  // health area page lands it as a task), so this may answer with false when
  // the write failed; the receipt below waits for that answer.
  onOffer?: (line: string) => void | Promise<boolean | void>;
  // Refill Runway's call, specifically: the catalog is explicit this lands
  // on the PARENT's list, not a generic offer, so it gets its own seam.
  onLandParentTask?: (line: string) => void | Promise<boolean | void>;
  // Same shape, same reason: The Season Feed's receipt counts events, and a
  // count is the loudest claim on this flow, so it waits for the answer too.
  onCommitSeasonFeed?: (draft: SeasonFeedDraft) => void | Promise<boolean | void>;
}) {
  const svc = useState(() => service ?? new HealthService(store!, ownerId ?? "", onEvent))[0];
  const [screen, setScreen] = useState<ScreenKey>(initialScreen);
  // UP-ATH-05: the dated summary in flight between Point at It and Say It to
  // Someone. Null on every other path through this flow.
  const [handOff, setHandOff] = useState<string | null>(initialHandOff ?? null);

  const [grants, setGrants] = useState<ConsentGrant[]>([]);
  const [lightsOut, setLightsOut] = useState<LightsOutEntry[]>([]);
  const [ateBefore, setAteBefore] = useState<AteBeforeEntry[]>([]);
  const [tookIt, setTookIt] = useState<TookItEntry[]>([]);
  const [callIt, setCallIt] = useState<CallItEntry[]>([]);
  const [pointAtIt, setPointAtIt] = useState<PointAtItEntry[]>([]);
  const [medRefill, setMedRefill] = useState<MedRefillEntry[]>([]);
  const [bagCheck, setBagCheck] = useState<BagCheckEntry[]>([]);
  const [lockerDocs, setLockerDocs] = useState<LockerDocEntry[]>([]);
  const [trustedAdult, setTrustedAdultState] = useState<{ name: string; phone: string }>({ name: "", phone: "" });
  const [ageRuleGate, setAgeRuleGate] = useState(false);

  const reload = useCallback(async () => {
    const [g, lo, ab, ti, ci, pa, mr, bc, ld, ta, gate] = await Promise.all([
      svc.getConsent(), svc.listLightsOut(), svc.listAteBefore(), svc.listTookIt(), svc.listCallIt(), svc.listPointAtIt(),
      svc.listMedRefill(), svc.listBagCheck(), svc.listLockerDoc(), svc.getTrustedAdult(), svc.wasAgeRuleShown(currentSeason()),
    ]);
    setGrants(g); setLightsOut(lo); setAteBefore(ab); setTookIt(ti); setCallIt(ci); setPointAtIt(pa);
    setMedRefill(mr); setBagCheck(bc); setLockerDocs(ld);
    setTrustedAdultState(ta ? { name: ta.data.name, phone: ta.data.phone } : { name: "", phone: "" });
    setAgeRuleGate(gate);
  }, [svc]);

  useEffect(() => { void reload(); }, [reload]);

  // HMN-F-22 (2026-09-05): marking The Age Rule seen used to happen inside
  // the render branch below, so a re-render for any reason fired a write and
  // StrictMode's double render fired two. A write is an effect; it belongs
  // here. It runs once per season, only while that screen is the one open,
  // and it says so when it cannot land, because a silent failed write is how
  // the card comes back next season as if it had never been shown.
  useEffect(() => {
    if (screen !== "ageRule" || ageRuleGate) return;
    let on = true;
    void svc.markAgeRuleShown(currentSeason())
      .then(() => { if (on) setAgeRuleGate(true); })
      .catch(() => { if (on) showToast({ message: WRITE_FAILED_MESSAGE }); });
    return () => { on = false; };
  }, [screen, ageRuleGate, svc]);

  const answeredFor: Record<string, boolean> = {};
  for (const e of ateBefore) if (e.data.eventId) answeredFor[e.data.eventId] = e.data.ate;

  const patterns = stillThere(pointAtIt);

  // BACK ON TRACK, EXTENDED TO HEALTH. Reads the mark history BEFORE the new
  // tap lands (same ordering TodayFlow.onToggleTask uses for tasks), so the
  // celebration is judged against the real gap, not one that already closed.
  const celebrateOnLog = (marksBefore: { at: number }[]) => {
    const msg = healthComebackMessage(marksBefore, localDay());
    if (msg) showToast({ message: msg });
  };

  const today = localDay();

  // HMN-F-06 (2026-09-05): every offer on these screens used to announce
  // itself on the tap, before the caller it hands the line to had written
  // anything. Now that the screens are reachable (the health area page's
  // More row) that receipt has to be true: it waits for the write, and says
  // so when the write failed. A caller that returns nothing (the bench, the
  // module's own tests) is unchanged.
  //
  // HMN-F-22 (2026-09-05), folded in here rather than repeated per handler:
  // every seam on this flow is optional, and a missing seam is not a failed
  // write, it is nothing happening at all. With no seam this says nothing,
  // because "Wind Down added" on a HealthFlow mounted without onOffer is the
  // same lie as a receipt that beats its own write. This is the ONE place
  // that decides whether a receipt is earned; no handler below toasts an
  // offer of its own. The argument is generic because The Season Feed hands
  // over a draft rather than a line, and onDone runs only on a real write,
  // so a failed commit leaves the person on the screen they can retry from.
  const take = <T,>(
    fn: ((arg: T) => void | Promise<boolean | void>) | undefined,
    arg: T,
    said: string,
    onDone?: () => void,
  ) => {
    if (!fn) return;
    void (async () => {
      const ok = await Promise.resolve(fn(arg)).catch(() => false);
      showToast({ message: ok === false ? WRITE_FAILED_MESSAGE : said });
      if (ok !== false) onDone?.();
    })();
  };

  switch (screen) {
    case "share":
      return (
        <ShareLineScreen
          grants={grants}
          // HMN-F-22 (2026-09-05): a failed grant write left the switch
          // looking flipped with nothing behind it. It says so and reloads,
          // which puts the switch back where the store actually has it.
          onToggle={async (c: HealthCategoryId, granted: boolean) => {
            try { await svc.setGrant(c, granted); } catch { showToast({ message: WRITE_FAILED_MESSAGE }); }
            await reload();
          }}
          onOpenWhatTheySee={() => setScreen("whatTheySee")}
          onBack={onExit}
        />
      );
    case "whatTheySee":
      return (
        <WhatTheySeeScreen
          grants={grants} lightsOut={lightsOut} ateBefore={ateBefore} tookIt={tookIt} callIt={callIt} pointAtIt={pointAtIt}
          onManage={() => setScreen("share")}
          onBack={() => setScreen("share")}
        />
      );
    case "lightsOut":
      return (
        <LightsOutScreen
          last={lightsOut[lightsOut.length - 1] ?? null}
          onLog={() => { celebrateOnLog(lightsOut.map((e) => ({ at: e.data.at }))); svc.logLightsOut(); void reload(); }}
          onBack={onExit}
        />
      );
    case "ateBefore":
      return (
        <AteBeforeScreen
          candidates={candidates}
          answered={answeredFor}
          marks={ateBeforeMarks(ateBefore)}
          onMark={(c, ate) => {
            if (ate) celebrateOnLog(ateBefore.filter((e) => e.data.ate).map((e) => ({ at: e.data.at })));
            svc.logAteBefore({ eventId: c.eventId, eventTitle: c.eventTitle, date: c.date, ate });
            void reload();
          }}
          onBack={onExit}
        />
      );
    case "tookIt":
      return (
        <TookItScreen
          timeline={tookItTimeline(tookIt)}
          onLog={() => { celebrateOnLog(tookIt.map((e) => ({ at: e.data.at }))); svc.logTookIt(); void reload(); }}
          onBack={onExit}
        />
      );
    case "callIt":
      return (
        <CallItScreen
          durationMin={callItDuration}
          history={callIt.map((e) => ({ at: e.data.at, rpe: e.data.rpe, durationMin: e.data.durationMin }))}
          onLog={(rpe) => {
            celebrateOnLog(callIt.map((e) => ({ at: e.data.at })));
            svc.logCallIt({ rpe, durationMin: callItDuration });
            void reload();
          }}
          onBack={onExit}
        />
      );
    case "pointAtIt": {
      const summaries = patterns.map((p) => stillThereSummary(pointAtIt, p));
      return (
        <PointAtItScreen
          patterns={patterns}
          // HMN-F-23 (2026-09-05): the dated taps behind each pattern, which
          // is what the catalog says gets handed over.
          summaries={summaries}
          onLog={(x, y, side) => { svc.logPointAtIt({ x, y, side }); void reload(); }}
          // UP-ATH-05 (2026-09-06): the summary travels with the tap. Before
          // this the button walked to Say It to Someone empty-handed, so the
          // athlete had to remember and retype the dates the screen had just
          // shown them.
          onHandToSomeone={() => { setHandOff(stillThereMessage(patterns, summaries)); setScreen("sayItToSomeone"); }}
          onBack={onExit}
        />
      );
    }

    case "refillRunway":
      return (
        <RefillRunwayScreen
          state={refillRunway(medRefill, tookIt)}
          onLogFill={(dosesInFill) => { svc.logMedRefill({ filledAt: Date.now(), dosesInFill }); void reload(); }}
          // HMN-F-22 (2026-09-05): this toast used to fire whether or not
          // there was a seam to land the call on, so a HealthFlow mounted
          // without onLandParentTask said "Sent to the parent's list" with
          // nothing sent. It reports only what actually left.
          onLandParentTask={() => {
            const line = refillOffer(refillRunway(medRefill, tookIt));
            // HMN-F-06: the catalog wrote this for a parent's list, and there
            // is one list in this app. The receipt names the list it landed on.
            if (line) take(onLandParentTask, line, "Added to your list");
          }}
          onBack={onExit}
        />
      );
    case "medWindow":
      return (
        <MedWindowScreen
          days={medWindowDays(tookIt, ateBefore, sessionStarts, lightsOut)}
          onOpenDoctorReport={() => setScreen("doctorReport")}
          onBack={onExit}
        />
      );
    case "doctorReport": {
      const report = buildDoctorReport({ tookIt, ateBefore, lightsOut, callIt });
      return (
        <DoctorReportScreen
          report={report}
          // HMN-F-22 (2026-09-05): Export This Log used to toast the
          // report's own first line and export nothing at all. It hands the
          // text to the OS now, through the same share sheet the backup
          // export uses (S3-Q16), and says so only after the file left.
          onExport={async () => {
            try {
              const sent = await saveTextFile(
                doctorReportText(report),
                `jarvis-health-log-${report.toDate}.txt`,
                { title: "The Family's Own Log" },
              );
              if (sent) showToast({ message: "Log exported" });
            } catch {
              showToast({ message: "Couldn't export · Try again" });
            }
          }}
          onBack={onExit}
        />
      );
    }
    case "nightBefore":
      return (
        <NightBeforeScreen
          offer={nightBeforeOffer(nightBeforeCommitments, Date.now())}
          // HMN-F-22 (2026-09-05): every offer toast on this flow used to
          // fire whether or not onOffer existed to place the block. The
          // toast now follows the offer instead of announcing it.
          onAddWindDown={() => {
            const offer = nightBeforeOffer(nightBeforeCommitments, Date.now());
            if (offer) take(onOffer, "Wind Down at " + new Date(offer.windDownAt).toLocaleTimeString(), "Wind Down added");
          }}
          onBack={onExit}
        />
      );
    case "eatingWindows":
      return (
        <EatingWindowsScreen
          offers={eatingWindowOffers(eatingWindowBlocks)}
          onTakeOffer={(o) => take(onOffer, o.line, "Added to your list")}
          onBack={onExit}
        />
      );
    case "theBag": {
      // HMN-F-22 (2026-09-05): same blank dead end as the Season Feed. A
      // checklist binds to one calendar event; with none there is nothing to
      // check, and saying so beats an empty screen with no Back on it.
      if (!bagEvent) return <NothingHere title="No Bag to Check Yet" sub="The bag list binds to one event on the calendar" onBack={onExit} />;
      const latest = latestBagCheck(bagCheck, bagEvent.eventId);
      const items = latest?.data.items ?? defaultBagItems();
      return (
        <TheBagScreen
          eventTitle={bagEvent.eventTitle}
          items={items}
          onToggle={(key) => { svc.logBagCheck({ ...bagEvent, items: toggleItem(items, key) }); void reload(); }}
          onCheckAll={() => { svc.logBagCheck({ ...bagEvent, items: checkAll(items) }); void reload(); }}
          onBack={onExit}
        />
      );
    }
    case "thirdPractice":
      return (
        <ThirdPracticeScreen
          offers={thirdPracticeOffers(sportSessions)}
          onProtectGap={(o) => take(onOffer, o.line, "Added to your list")}
          onBack={onExit}
        />
      );
    case "weekShape":
      return (
        <WeekShapeScreen
          shape={weekShape(sportSessions, weekDates ?? defaultWeekDates())}
          onOpenTwoDaysOff={() => setScreen("twoDaysOff")}
          onBack={onExit}
        />
      );
    case "twoDaysOff":
      return (
        <TwoDaysOffScreen
          offer={restDayOffer(weekShape(sportSessions, weekDates ?? defaultWeekDates()))}
          onPlaceRestDay={(date) => take(onOffer, "Rest day, " + date, "Rest day added")}
          onBack={onExit}
        />
      );
    case "ageRule": {
      const shape = weekShape(sportSessions, weekDates ?? defaultWeekDates());
      const facts = ageRuleFacts({
        ageYears: athleteAgeYears ?? 15,
        weeklyHours: shape.totalHours,
        monthsInSeason: monthsInSeason ?? 9,
        daysOffPerWeek: shape.daysWithNone,
      });
      return (
        <AgeRuleScreen
          facts={facts}
          onProtectAGap={() => take(onOffer, "Protect a gap this week", "Added to your list")}
          onBack={onExit}
        />
      );
    }
    case "sayItToSomeone":
      return (
        <SayItToSomeoneScreen
          name={trustedAdult.name}
          phone={trustedAdult.phone}
          // HMN-F-22 (2026-09-05): this write had no catch, so the one
          // screen that has to work in a crisis could drop the person it
          // just promised to remember without a word.
          onSetTrustedAdult={(name, phone) => {
            void svc.setTrustedAdult(name, phone)
              .then(reload)
              .catch(() => showToast({ message: WRITE_FAILED_MESSAGE }));
          }}
          handOff={handOff ?? undefined}
          // UP-ATH-05: no saved person, or a different one this time. The
          // receipt waits for the sheet, and says nothing at all when the
          // person backed out of it, because a dismissed share sheet sent
          // nothing and "Sent" would be the same lie every other seam here
          // was just taught not to tell.
          onShare={(text) => {
            void shareText(text, "Still There?")
              .then((r) => { if (r === "copied") showToast({ message: "Copied to your clipboard" }); })
              .catch(() => showToast({ message: "Couldn't hand that over · Try again" }));
          }}
          onBack={onExit}
        />
      );
    case "seasonFeed":
      // HMN-F-22 (2026-09-05): with no AI service this returned null, which
      // is a blank screen with no way back, on a stack whose only exit is
      // the Back button it did not draw.
      if (!ai) return <NothingHere title="The Season Feed Isn't On" sub="Reading a schedule out of a photo needs JARVIS's AI turned on" onBack={onExit} />;
      return (
        <SeasonFeedScreen
          ai={ai}
          // HMN-F-22 (2026-09-05), through HMN-F-06's helper: this counted
          // the draft's events and said they were added before the seam that
          // adds them had run, and said it with no seam there at all. It goes
          // through take like every other offer, so the count is a receipt
          // for a write, and a failed commit stays on this screen.
          onCommit={(draft) => take(
            onCommitSeasonFeed,
            draft,
            capAfterNumber(draft.events.length + (draft.events.length === 1 ? " event added" : " events added")),
            onExit,
          )}
          onBack={onExit}
        />
      );
    case "locker":
      return (
        <LockerScreen
          docs={lockerDocs}
          today={today}
          onAdd={(kind: LockerDocKind, expiresAt: string) => {
            svc.logLockerDoc({ kind, label: LOCKER_DOC_LABEL[kind], expiresAt });
            void reload();
          }}
          onRemove={(id) => { void svc.removeLockerDoc(id).then(reload); }}
          onBack={onExit}
        />
      );
    case "handoff": {
      const state = refillRunway(medRefill, tookIt);
      return (
        <HandoffScreen
          items={handoffItems(state, lockerDocs, today)}
          onOpenSeasonFeed={() => setScreen("seasonFeed")}
          onOpenLocker={() => setScreen("locker")}
          onBack={onExit}
        />
      );
    }
    default:
      return null;
  }
}
