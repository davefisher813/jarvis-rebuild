import { useCallback, useEffect, useState } from "react";
import type { Store } from "@core";
import type { AIService } from "../ai/AIService";
import type { EventInput } from "../events";
import { HealthService } from "./HealthService";
import type {
  ConsentGrant, HealthCategoryId, LightsOutEntry, AteBeforeEntry, TookItEntry, CallItEntry, PointAtItEntry,
  MedRefillEntry, BagCheckEntry, LockerDocEntry, LockerDocKind,
} from "./types";
import { stillThere, tookItTimeline, ateBeforeMarks } from "./timelines";
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

type ScreenKey =
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
  store, ownerId, onEvent, candidates = [], callItDuration, initialScreen = "share", onExit,
  sportSessions = [], weekDates, athleteAgeYears, monthsInSeason,
  nightBeforeCommitments = [], eatingWindowBlocks = [], sessionStarts = [],
  bagEvent, ai, onOffer, onLandParentTask, onCommitSeasonFeed,
}: {
  store: Store;
  ownerId: string;
  onEvent?: (e: EventInput) => void;
  candidates?: AteBeforeCandidate[];
  callItDuration?: number;
  initialScreen?: ScreenKey;
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
  onOffer?: (line: string) => void;
  // Refill Runway's call, specifically: the catalog is explicit this lands
  // on the PARENT's list, not a generic offer, so it gets its own seam.
  onLandParentTask?: (line: string) => void;
  onCommitSeasonFeed?: (draft: SeasonFeedDraft) => void;
}) {
  const svc = useState(() => new HealthService(store, ownerId, onEvent))[0];
  const [screen, setScreen] = useState<ScreenKey>(initialScreen);

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

  switch (screen) {
    case "share":
      return (
        <ShareLineScreen
          grants={grants}
          onToggle={async (c: HealthCategoryId, granted: boolean) => { await svc.setGrant(c, granted); await reload(); }}
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
    case "pointAtIt":
      return (
        <PointAtItScreen
          patterns={patterns}
          onLog={(x, y, side) => { svc.logPointAtIt({ x, y, side }); void reload(); }}
          onHandToSomeone={() => setScreen("sayItToSomeone")}
          onBack={onExit}
        />
      );

    case "refillRunway":
      return (
        <RefillRunwayScreen
          state={refillRunway(medRefill, tookIt)}
          onLogFill={(dosesInFill) => { svc.logMedRefill({ filledAt: Date.now(), dosesInFill }); void reload(); }}
          onLandParentTask={() => {
            const line = refillOffer(refillRunway(medRefill, tookIt));
            if (line) onLandParentTask?.(line);
            showToast({ message: "Sent to the parent's list" });
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
          onExport={() => showToast({ message: doctorReportText(report).split("\n")[0] + " · ready" })}
          onBack={onExit}
        />
      );
    }
    case "nightBefore":
      return (
        <NightBeforeScreen
          offer={nightBeforeOffer(nightBeforeCommitments, Date.now())}
          onAddWindDown={() => {
            const offer = nightBeforeOffer(nightBeforeCommitments, Date.now());
            if (offer && onOffer) onOffer("Wind Down at " + new Date(offer.windDownAt).toLocaleTimeString());
            showToast({ message: "Wind Down added" });
          }}
          onBack={onExit}
        />
      );
    case "eatingWindows":
      return (
        <EatingWindowsScreen
          offers={eatingWindowOffers(eatingWindowBlocks)}
          onTakeOffer={(o) => { onOffer?.(o.line); showToast({ message: "Added to the list" }); }}
          onBack={onExit}
        />
      );
    case "theBag": {
      if (!bagEvent) return null;
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
          onProtectGap={(o) => { onOffer?.(o.line); showToast({ message: "Noted" }); }}
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
          onPlaceRestDay={(date) => { onOffer?.("Rest day, " + date); showToast({ message: "Rest day placed" }); }}
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
      if (!ageRuleGate) void svc.markAgeRuleShown(currentSeason());
      return (
        <AgeRuleScreen
          facts={facts}
          onProtectAGap={() => { onOffer?.("Protect a gap this week"); showToast({ message: "Noted" }); }}
          onBack={onExit}
        />
      );
    }
    case "sayItToSomeone":
      return (
        <SayItToSomeoneScreen
          name={trustedAdult.name}
          phone={trustedAdult.phone}
          onSetTrustedAdult={(name, phone) => { void svc.setTrustedAdult(name, phone).then(reload); }}
          onBack={onExit}
        />
      );
    case "seasonFeed":
      if (!ai) return null;
      return (
        <SeasonFeedScreen
          ai={ai}
          onCommit={(draft) => { onCommitSeasonFeed?.(draft); showToast({ message: draft.events.length + " events added" }); onExit(); }}
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
