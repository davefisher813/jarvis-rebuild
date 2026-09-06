import { useEffect, useState } from "react";
import { supabase } from "../../auth/supabaseClient";
import { useOptionalPeople } from "../../data/NotesProvider";
import { readWindowWithSource, type WindowClient, type WindowRead } from "../window";
import { peopleForDerivation } from "../peopleFacts";
import { readConsolidation } from "../nightly";
import { daysSince } from "../recall";
import { readiness, READINESS_WINDOW_DAYS, type Readiness, type ReadinessState } from "../readiness";
import { Nums } from "../../bigger/GoalRowRuled";
import type { DerivePerson } from "../derive";
import type { Strand } from "./types";

// WHY IS THIS LIST NOT GROWING (Dave, 2026-09-06: "i dont see any trace of
// jarvis learning anything. theres 1 fact in what jarvis knows about me").
//
// Four completely different failures used to render as the same empty screen,
// and nobody, including the people who built it, could tell them apart:
//
//   a. not enough evidence yet,
//   b. enough evidence but a second condition unmet,
//   c. his events never reaching the server,
//   d. the day's pass never running.
//
// This panel separates them. It is an INSTRUMENT: it proposes nothing, writes
// nothing, gates nothing, and calls no AI, so it reads the same with the key
// missing and the plane in the air. Every number it prints is read back out
// of the modules that enforce it (brain/readiness.ts imports the gates from
// brain/derive.ts and today/planningPatterns.ts), so it cannot drift into
// telling him a threshold that is not the one in force.
//
// Two bands, because the two questions are different. The first is whether
// JARVIS is seeing his life at all. The second is what each detector is
// waiting for.

const STATE_CLASS: Record<ReadinessState, string> = {
  known: "rdy-good", ready: "rdy-good", close: "rdy-warn", waiting: "", muted: "rdy-off",
};

function Row({ label, why, slot, tone = "" }: { label: string; why: string; slot?: string; tone?: string }) {
  return (
    <div className="row rdy-row">
      <div className="row-grow">
        <div className="conn-name">{label}</div>
        <div className="rdy-why"><Nums text={why} /></div>
      </div>
      {slot !== undefined && <span className={"rdy-n " + tone}><b>{slot}</b></span>}
    </div>
  );
}

function DetectorRow({ r }: { r: Readiness }) {
  return (
    <div className="row rdy-row">
      <div className="row-grow">
        <div className="conn-name">{r.label}</div>
        {r.detail && <div className="rdy-why"><Nums text={r.detail} /></div>}
      </div>
      <span className={"rdy-n " + STATE_CLASS[r.state]}><b>{r.have}</b>/{r.need}</span>
    </div>
  );
}

export default function ReadinessPanel({ strands, today }: { strands: Strand[]; today: string }) {
  const peopleSvc = useOptionalPeople();
  const [read, setRead] = useState<WindowRead | null>(null);
  const [people, setPeople] = useState<DerivePerson[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [w, folk] = await Promise.all([
          // The same read the detectors do, through the same client, with the
          // same 30-day window. Anything else and the panel would be
          // reporting on a different Brain than the one he has.
          readWindowWithSource(supabase as unknown as WindowClient | null, Date.now()),
          peopleForDerivation(peopleSvc),
        ]);
        if (!live) return;
        setRead(w);
        setPeople(folk);
      } catch {
        // Silent automation that fails renders a receipt, never nothing:
        // an instrument that goes blank when it breaks is the exact defect
        // this panel was built to end.
        if (live) setFailed(true);
      }
    })();
    return () => { live = false; };
  }, [peopleSvc]);

  if (failed) {
    return (
      <>
        <div className="sh2 sh2-quiet"><span className="t">The Evidence</span></div>
        <div className="pad-x"><div className="card list-card-ruled">
          <Row label="Could Not Be Read" why="JARVIS could not read your activity just now · Open this screen again on a connection" />
        </div></div>
      </>
    );
  }
  if (!read) return null;

  const rows = readiness(read.rows, strands, people, Date.now());
  const pass = readConsolidation();
  const passAge = pass ? daysSince(pass.day, today) : 0;
  const passWhy = !pass
    ? "No day recorded yet · The pass only records a day it had something to propose · A quiet month looks the same"
    : passAge === 0
      ? "Ran today, and what it chose is offered above"
      : `Last recorded ${passAge} ${passAge === 1 ? "day" : "days"} ago · It reviews once a local day, whenever the app is open`;

  return (
    <>
      <div className="sh2 sh2-quiet"><span className="t">The Evidence</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        <Row
          label={`The Last ${READINESS_WINDOW_DAYS} Days`}
          why={read.source === "server"
            ? "Read from your account · Everything you have done, on every device"
            : "This device only, not everything you have done"}
          slot={String(read.rows.length)}
          tone={read.source === "server" ? "rdy-good" : "rdy-warn"}
        />
        <Row
          label="The Day's Pass"
          why={passWhy}
          slot={pass ? String(pass.keys.length) : undefined}
        />
      </div></div>

      <div className="sh2 sh2-quiet"><span className="t">What JARVIS Is Watching</span><span className="n">{rows.length}</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        {rows.map((r) => <DetectorRow r={r} key={r.key} />)}
      </div></div>
    </>
  );
}
