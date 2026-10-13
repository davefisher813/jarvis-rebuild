import type { ReactNode } from "react";
import { Head, Card, Row, Foot, Menu } from "../../settings/kit";
import Stepper from "../../shared/Stepper";
import { monthDay } from "../../money/bills";
import {
  type PageData, type PageRecord, type RosterChange,
  golfTotals, holeWord, scoreOf, toParLabel, recordName, labelOf, OUTREACH_STATUS,
} from "./pageModel";

// THE FOUR TEMPLATE PAGES, DRAWN (issue #115, slice 1). Phone first: a
// readable page with clear actions, never a grid to arrange. Every record is
// a clean row (the approved anatomy: its name, then its facts as spans, one
// grey at most); a tap opens the record's sheet, and a section's action is
// its head's. A value the import was not sure of says so in amber, which is
// the key's "needs you soon", until it is corrected or kept.

/** A value he typed or brought in: drawn as it is, never re-cased, and outside the number-case check. */
export const U = ({ children }: { children: ReactNode }) => <span data-user-text="">{children}</span>;

function flagFact(page: PageData, r: PageRecord) {
  const keys = Object.keys(r.flags ?? {});
  if (!keys.length) return null;
  return <span className="fact warn">{keys.length === 1 ? "Check " + labelOf(page, keys[0]!) : `Check ${keys.length} Values`}</span>;
}

// ---------------------------------------------------------------------------
// Team Sheet

export function TeamView({ page, lineups, onOpen, onAdd, onMakeLineup, onOpenLineup }: {
  page: PageData;
  lineups: { id: string; title: string; date: string }[];
  onOpen: (recordId: string) => void;
  onAdd: () => void;
  onMakeLineup?: () => void;
  onOpenLineup: (noteId: string) => void;
}) {
  const n = page.records.length;
  return (
    <>
      <Head label={n === 1 ? "1 Player" : `${n} Players`} action={{ label: "Add Player", onClick: onAdd }} />
      {n > 0 && (
        <Card>
          {page.records.map((r) => {
            const num = (r.v.number ?? "").trim();
            const pos = (r.v.position ?? "").trim();
            const flag = flagFact(page, r);
            return (
              <Row key={r.id} label={<U>{recordName(page, r) || "Unnamed Player"}</U>} onClick={() => onOpen(r.id)} chev
                meta={num || pos || flag ? <>
                  {num && <span className="fact"><b><U>#{num}</U></b></span>}
                  {pos && <span className="fact"><U>{pos}</U></span>}
                  {flag}
                </> : undefined} />
            );
          })}
        </Card>
      )}
      {onMakeLineup && n > 0 && (
        <>
          <Head label="Lineups" action={{ label: "Make a Lineup", onClick: onMakeLineup }} />
          {lineups.length > 0 && (
            <Card>
              {lineups.map((l) => (
                <Row key={l.id} label={<U>{l.title}</U>} onClick={() => onOpenLineup(l.id)} chev
                  meta={l.date ? <span className="fact date">{monthDay(l.date)}</span> : undefined} />
              ))}
            </Card>
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Lineup Card

export function LineupView({ page, changes, onOpen, onAdd, onRefresh, onOpenTeam, onDate }: {
  page: PageData;
  changes: RosterChange[] | null;
  onOpen: (recordId: string) => void;
  onAdd?: () => void;
  onRefresh?: () => void;
  onOpenTeam?: () => void;
  onDate: () => void;
}) {
  const l = page.lineup!;
  const n = page.records.length;
  return (
    <>
      <Card>
        {onOpenTeam
          ? <Row label="Team Sheet" value={<U>{l.teamTitle || "Team"}</U>} onClick={onOpenTeam} chev />
          : <Row label="Team Sheet" value={<U>{l.teamTitle || "Team"}</U>} />}
        <Row label="Date" value={l.date ? monthDay(l.date) : ""} onClick={onDate} chev />
      </Card>
      <Head label="Batting Order" count={n} action={onAdd ? { label: "Add Player", onClick: onAdd } : undefined} />
      {n > 0 && (
        <Card>
          {page.records.map((r, i) => {
            const num = (r.v.number ?? "").trim();
            const pos = (r.v.position ?? "").trim();
            return (
              <Row key={r.id} lead={<div className="row-ico nav-tile-graphite"><b>{i + 1}</b></div>}
                label={<U>{(r.v.name ?? "").trim() || "Unnamed Player"}</U>} onClick={() => onOpen(r.id)} chev
                meta={num || pos ? <>
                  {num && <span className="fact"><b><U>#{num}</U></b></span>}
                  {pos && <span className="fact"><U>{pos}</U></span>}
                </> : undefined} />
            );
          })}
        </Card>
      )}
      {/* The lineup keeps the names and numbers it was made with. When the roster has moved on since, it says so once,
          quietly, and changes nothing unless he asks. */}
      {changes && changes.length > 0 && (
        <>
          <Foot>Roster Changed Since {monthDay(new Date(l.takenAt).toISOString().slice(0, 10))}</Foot>
          {onRefresh && <Head label="Roster" action={{ label: "Use Roster Names", onClick: onRefresh }} />}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Outreach Tracker

const STATUS_TONE: Record<string, string> = {
  "To Contact": "warn",
  "Reached Out": "warn",
  Replied: "good",
  "Meeting Set": "good",
  Closed: "good",
};

export function OutreachView({ page, onOpen, onAdd }: { page: PageData; onOpen: (recordId: string) => void; onAdd: () => void }) {
  const n = page.records.length;
  return (
    <>
      <Head label={n === 1 ? "1 Contact" : `${n} Contacts`} action={{ label: "Add Contact", onClick: onAdd }} />
      {n > 0 && (
        <Card>
          {page.records.map((r) => {
            const who = (r.v.who ?? "").trim();
            const org = (r.v.org ?? "").trim();
            const status = (r.v.status ?? "").trim();
            const last = (r.v.last ?? "").trim();
            const tone = STATUS_TONE[status] ?? "";
            const hasMeta = (who && org) || status || /^\d{4}-\d{2}-\d{2}$/.test(last);
            return (
              <Row key={r.id} label={<U>{who || org || "Unnamed Contact"}</U>} onClick={() => onOpen(r.id)} chev
                meta={hasMeta ? <>
                  {who && org && <span className="fact"><U>{org}</U></span>}
                  {status && (tone ? <span className={"fact " + tone}>{OUTREACH_STATUS.includes(status) ? status : <U>{status}</U>}</span> : <span className="fact"><b><U>{status}</U></b></span>)}
                  {/^\d{4}-\d{2}-\d{2}$/.test(last) && <span className="fact date">{monthDay(last)}</span>}
                </> : undefined} />
            );
          })}
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Golf Scorecard

export function ScorecardView({ page, onHole, onPlayer, onAddPlayer, onCourse, onHoles, onDate }: {
  page: PageData;
  onHole: () => void;
  onPlayer: (recordId: string) => void;
  onAddPlayer: () => void;
  onCourse: () => void;
  onHoles: (h: 9 | 18) => void;
  onDate: () => void;
}) {
  const g = page.golf!;
  const anyPlayed = page.records.some((r) => golfTotals(page, r).played > 0);
  const allDone = page.records.length > 0 && page.records.every((r) => golfTotals(page, r).played >= g.holes);
  return (
    <>
      <Head label="Scores" action={{ label: allDone ? "Review Holes" : anyPlayed ? "Keep Scoring" : "Start Hole 1", onClick: onHole }} />
      <Card>
        {page.records.map((r) => {
          const t = golfTotals(page, r);
          return (
            <Row key={r.id} label={<U>{(r.v.name ?? "").trim() || "Player"}</U>} onClick={() => onPlayer(r.id)} chev
              meta={t.played ? <>
                <span className="fact">{t.thru >= g.holes ? "Final" : `Thru ${t.thru}`}</span>
                <span className="fact"><b>{t.total}</b></span>
                <span className="fact"><b>{toParLabel(t.toPar)}</b></span>
              </> : undefined} />
          );
        })}
      </Card>
      <Head label="Round" action={{ label: "Add Player", onClick: onAddPlayer }} />
      <Card>
        <Row label="Course" value={g.course ? <U>{g.course}</U> : undefined} onClick={onCourse} chev />
        <Menu label="Holes" value={String(g.holes)} options={[{ value: "9", label: "9 Holes" }, { value: "18", label: "18 Holes" }]} onPick={(v) => onHoles(v === "9" ? 9 : 18)} />
        <Row label="Date" value={g.date ? monthDay(g.date) : ""} onClick={onDate} chev />
      </Card>
    </>
  );
}

/** ONE HOLE AT A TIME, BIG ENOUGH FOR A THUMB ON A COURSE. Par and every player's strokes for this hole, each on the
 *  app's one stepper (tap the number to type it), with the running total and score to par beside each name. */
export function HoleEntry({ page, hole, onScore, onPar, onFillPar }: {
  page: PageData;
  hole: number;
  onScore: (recordId: string, score: number) => void;
  onPar: (par: number) => void;
  onFillPar?: () => void;
}) {
  const g = page.golf!;
  const par = g.par[hole - 1] ?? 4;
  const open = page.records.some((r) => scoreOf(r, hole) === null);
  return (
    <>
      <Card>
        <Row label="Par" plain>
          <Stepper value={par} step={1} min={3} max={6} label={`Par for Hole ${hole}`} onChange={onPar} />
        </Row>
      </Card>
      <Head label="Strokes" action={open && onFillPar ? { label: "Par for the Rest", onClick: onFillPar } : undefined} />
      <Card>
        {page.records.map((r) => {
          const s = scoreOf(r, hole);
          const t = golfTotals(page, r);
          return (
            <Row key={r.id} plain label={<U>{(r.v.name ?? "").trim() || "Player"}</U>}
              meta={s !== null || t.played ? <>
                {s !== null && <span className="fact">{holeWord(s, par)}</span>}
                {t.played > 0 && <span className="fact"><b>{t.total}</b></span>}
                {t.played > 0 && <span className="fact"><b>{toParLabel(t.toPar)}</b></span>}
              </> : undefined}>
              <Stepper value={s ?? par} step={1} min={1} max={15} label={`Strokes for ${(r.v.name ?? "").trim() || "Player"}`}
                onChange={(n) => onScore(r.id, n)} />
            </Row>
          );
        })}
      </Card>
    </>
  );
}

/** A read-only page, for a snapshot: the records as they were, nothing to tap. */
export function ReadOnlyRecords({ page }: { page: PageData }) {
  if (page.kind === "scorecard") {
    return (
      <Card>
        {page.records.map((r) => {
          const t = golfTotals(page, r);
          return <Row key={r.id} label={<U>{(r.v.name ?? "").trim() || "Player"}</U>}
            meta={t.played ? <><span className="fact">{t.thru >= page.golf!.holes ? "Final" : `Thru ${t.thru}`}</span><span className="fact"><b>{t.total}</b></span><span className="fact"><b>{toParLabel(t.toPar)}</b></span></> : undefined} />;
        })}
      </Card>
    );
  }
  const shown = page.fields.filter((f) => f.key !== "player" && f.key !== (page.kind === "outreach" ? "who" : "name")).slice(0, 2);
  return (
    <Card>
      {page.records.map((r) => {
        const vals = shown.map((f) => (r.v[f.key] ?? "").trim()).filter(Boolean);
        return <Row key={r.id} label={<U>{recordName(page, r) || "Unnamed"}</U>}
          meta={vals.length ? <>{vals.map((v, i) => i === 0 ? <span key={i} className="fact"><U>{v}</U></span> : <span key={i} className="fact"><b><U>{v}</U></b></span>)}</> : undefined} />;
      })}
    </Card>
  );
}
