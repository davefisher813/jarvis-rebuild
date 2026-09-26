import { useEffect, useState } from "react";
import { supabase } from "../../auth/supabaseClient";
import { useOptionalPeople } from "../../data/NotesProvider";
import { readWindowWithSource, type WindowClient, type WindowRead } from "../window";
import { peopleForDerivation } from "../peopleFacts";
import { readConsolidation } from "../nightly";
import { daysSince } from "../recall";
import { readiness, READINESS_WINDOW_DAYS, type Readiness, type ReadinessState } from "../readiness";
import { readinessWord, toneForReadinessWord } from "./state";
import { Nums } from "../../bigger/GoalRowRuled";
import type { DerivePerson } from "../derive";
import type { Strand } from "./types";
import { pressable } from "../../shared/pressable";

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
// TWO FACES SINCE C-39 (Astra, 2026-09-12). What JARVIS Knows shows the
// "words" face: one word per detector (Known, Close, Waiting) and a receipt
// saying where the numbers went. The Learning Lab under Settings shows the
// "lab" face: the two evidence rows and every detector's have over need with
// the sentence saying what it still waits for. One read, one set of rows, two
// renderings, so the word on the Knows page and the number in the Lab can
// never disagree.

// THE READ, as a hook, so the Knows page, the Lab and the Brain's top bands
// make the same read through the same client with the same 30-day window.
// Anything else and one surface would be reporting on a different Brain
// than the one he has.
export interface ReadinessRead {
  rows: Readiness[];
  source: "server" | "local";
  /** Rows in the window, for the evidence line. */
  count: number;
  failed: boolean;
  loaded: boolean;
}

export function useReadiness(strands: Strand[], enabled = true): ReadinessRead {
  const peopleSvc = useOptionalPeople();
  const [read, setRead] = useState<WindowRead | null>(null);
  const [people, setPeople] = useState<DerivePerson[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void (async () => {
      try {
        const [w, folk] = await Promise.all([
          // The same read the detectors do, through the same client, with the
          // same 30-day window.
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
  }, [peopleSvc, enabled]);

  const rows = read ? readiness(read.rows, strands, people, Date.now()) : [];
  return { rows, source: read?.source ?? "local", count: read?.rows.length ?? 0, failed, loaded: read !== null };
}

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

// The words face (C-39): one word per detector, no numbers, and the receipt
// that says where the numbers went.
// C-38 fix (2026-09-13): `focused` marks the one row a Needs You tap named,
// so landing here reads as an answer to that specific tap instead of the
// same generic list every watching row used to open on.
function WordRow({ r, focused = false, onTell }: { r: Readiness; focused?: boolean; onTell?: () => void }) {
  const w = readinessWord(r.state);
  return (
    // Row tap (Dave 2026-09-15, "I want all rows clickable"): a counting
    // detector has no fact to open yet, so any row says it outright.
    <div id={"rdy-" + r.key} className={"row rdy-row" + (focused ? " rdy-row-focus" : "")} {...(onTell ? pressable(onTell) : {})}>
      <div className="row-grow"><div className="conn-name">{r.label}</div></div>
      <span className={"fact st " + toneForReadinessWord(w)}>{w}</span>
      {/* THE ROW HE TAPPED CAN BE TOLD (Dave 2026-09-13: "I clicked on when
          you train to mark it as a fact, and it pulled up a completely
          different fact"). A readiness row is JARVIS still counting; the one
          he came here for carries Tell JARVIS, so saying it outright is one
          tap from the row he meant. */}
      {focused && onTell && <button type="button" className="pill-act" onClick={(ev) => { ev.stopPropagation(); onTell(); }}>Tell JARVIS</button>}
    </div>
  );
}

export default function ReadinessPanel({ read, today, variant = "words", focusKey, onTell }: { read: ReadinessRead; today: string; variant?: "words" | "lab"; focusKey?: string; onTell?: (key: string) => void }) {
  // C-38 fix: land ON the row a Needs You tap named, the same "land on the
  // sentence, not the thread" pattern MessagesFlow uses for a deep-linked
  // message, rather than just opening the same list every watching row did.
  useEffect(() => {
    if (!focusKey) return;
    document.getElementById("rdy-" + focusKey)?.scrollIntoView({ block: "center" });
  }, [focusKey]);
  if (read.failed) {
    return (
      <>
        <div className="sh2 sh2-quiet"><span className="t">{variant === "lab" ? "The Evidence" : "Readiness"}</span></div>
        <div className="pad-x"><div className="card list-card-ruled">
          <Row label="Could Not Be Read" why="JARVIS could not read your activity just now, so open this screen again on a connection" />
        </div></div>
      </>
    );
  }
  if (!read.loaded) return null;

  if (variant === "words") {
    return (
      <>
        <div className="sh2 sh2-quiet"><span className="t">Readiness</span><span className="n">{read.rows.length}</span></div>
        <div className="pad-x"><div className="card list-card-ruled">
          {read.rows.map((r) => <WordRow r={r} focused={r.key === focusKey} onTell={onTell ? () => onTell(r.key) : undefined} key={r.key} />)}
          {/* Not a button: the Lab is three taps away under Settings and
              this page has no door into More. The line says where, which
              is the receipt's whole job. */}
          <div className="receipt-line rdy-receipt"><span className="rl-t">Numbers behind each gate are in Settings › Advanced › Learning Lab</span></div>
        </div></div>
      </>
    );
  }

  const pass = readConsolidation();
  const passAge = pass ? daysSince(pass.day, today) : 0;
  const passWhy = !pass
    ? "No day recorded yet, but the pass only records a day it had something to propose, so a quiet month looks the same"
    : passAge === 0
      ? "Ran today, and what it chose is offered on What JARVIS Knows"
      : `Last recorded ${passAge} ${passAge === 1 ? "day" : "days"} ago, and it reviews once a local day, whenever the app is open`;

  return (
    <>
      <div className="sh2 sh2-quiet"><span className="t">The Evidence</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        <Row
          label={`The Last ${READINESS_WINDOW_DAYS} Days`}
          why={read.source === "server"
            ? "Read from your account, everything you have done on every device"
            : "This device only, not everything you have done"}
          slot={String(read.count)}
          tone={read.source === "server" ? "rdy-good" : "rdy-warn"}
        />
        <Row
          label="The Day's Pass"
          why={passWhy}
          slot={pass ? String(pass.keys.length) : undefined}
        />
      </div></div>

      <div className="sh2 sh2-quiet"><span className="t">What JARVIS Is Watching</span><span className="n">{read.rows.length}</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        {read.rows.map((r) => <DetectorRow r={r} key={r.key} />)}
      </div></div>
    </>
  );
}
