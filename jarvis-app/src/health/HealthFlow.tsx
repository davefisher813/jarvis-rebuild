import { useCallback, useEffect, useState } from "react";
import type { Store } from "@core";
import type { EventInput } from "../events";
import { HealthService } from "./HealthService";
import type { ConsentGrant, HealthCategoryId, LightsOutEntry, AteBeforeEntry, TookItEntry, CallItEntry, PointAtItEntry } from "./types";
import { stillThere, tookItTimeline, ateBeforeMarks } from "./timelines";
import ShareLineScreen from "./screens/ShareLineScreen";
import WhatTheySeeScreen from "./screens/WhatTheySeeScreen";
import LightsOutScreen from "./screens/LightsOutScreen";
import AteBeforeScreen, { type AteBeforeCandidate } from "./screens/AteBeforeScreen";
import TookItScreen from "./screens/TookItScreen";
import CallItScreen from "./screens/CallItScreen";
import PointAtItScreen from "./screens/PointAtItScreen";

type ScreenKey = "share" | "whatTheySee" | "lightsOut" | "ateBefore" | "tookIt" | "callIt" | "pointAtIt";

// Wires the five loggers and the Share Line to a real HealthService. Screens
// stay presentational (props in, callbacks out, same shape as gym's
// SessionScreen/HistoryScreen); this component owns the data.
//
// `candidates` and `callItDuration` are handed in from outside rather than
// read from src/schedule directly, so this module has no hard dependency on
// the schedule's shape: whatever wires Health into the real app (out of
// scope for this module) supplies today's practice/game rows in this small
// shape, and this file never has to know how a real EventData looks.
export default function HealthFlow({
  store, ownerId, onEvent, candidates = [], callItDuration, initialScreen = "share", onExit,
}: {
  store: Store;
  ownerId: string;
  onEvent?: (e: EventInput) => void;
  candidates?: AteBeforeCandidate[];
  callItDuration?: number;
  initialScreen?: ScreenKey;
  onExit: () => void;
}) {
  const svc = useState(() => new HealthService(store, ownerId, onEvent))[0];
  const [screen, setScreen] = useState<ScreenKey>(initialScreen);

  const [grants, setGrants] = useState<ConsentGrant[]>([]);
  const [lightsOut, setLightsOut] = useState<LightsOutEntry[]>([]);
  const [ateBefore, setAteBefore] = useState<AteBeforeEntry[]>([]);
  const [tookIt, setTookIt] = useState<TookItEntry[]>([]);
  const [callIt, setCallIt] = useState<CallItEntry[]>([]);
  const [pointAtIt, setPointAtIt] = useState<PointAtItEntry[]>([]);

  const reload = useCallback(async () => {
    const [g, lo, ab, ti, ci, pa] = await Promise.all([
      svc.getConsent(), svc.listLightsOut(), svc.listAteBefore(), svc.listTookIt(), svc.listCallIt(), svc.listPointAtIt(),
    ]);
    setGrants(g); setLightsOut(lo); setAteBefore(ab); setTookIt(ti); setCallIt(ci); setPointAtIt(pa);
  }, [svc]);

  useEffect(() => { void reload(); }, [reload]);

  const answeredFor: Record<string, boolean> = {};
  for (const e of ateBefore) if (e.data.eventId) answeredFor[e.data.eventId] = e.data.ate;

  const patterns = stillThere(pointAtIt);

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
          onLog={() => { svc.logLightsOut(); void reload(); }}
          onBack={onExit}
        />
      );
    case "ateBefore":
      return (
        <AteBeforeScreen
          candidates={candidates}
          answered={answeredFor}
          marks={ateBeforeMarks(ateBefore)}
          onMark={(c, ate) => { svc.logAteBefore({ eventId: c.eventId, eventTitle: c.eventTitle, date: c.date, ate }); void reload(); }}
          onBack={onExit}
        />
      );
    case "tookIt":
      return (
        <TookItScreen
          timeline={tookItTimeline(tookIt)}
          onLog={() => { svc.logTookIt(); void reload(); }}
          onBack={onExit}
        />
      );
    case "callIt":
      return (
        <CallItScreen
          durationMin={callItDuration}
          history={callIt.map((e) => ({ at: e.data.at, rpe: e.data.rpe, durationMin: e.data.durationMin }))}
          onLog={(rpe) => { svc.logCallIt({ rpe, durationMin: callItDuration }); void reload(); }}
          onBack={onExit}
        />
      );
    case "pointAtIt":
      return (
        <PointAtItScreen
          patterns={patterns}
          onLog={(x, y, side) => { svc.logPointAtIt({ x, y, side }); void reload(); }}
          onHandToSomeone={onExit}
          onBack={onExit}
        />
      );
    default:
      return null;
  }
}
