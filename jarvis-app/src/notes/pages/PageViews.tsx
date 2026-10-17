import type { ReactNode } from "react";
import { Head, Card, Row, Foot, Menu } from "../../settings/kit";
import Stepper from "../../shared/Stepper";
import { monthDay } from "../../money/bills";
import {
  type PageData, type PageRecord, type RosterChange,
  golfTotals, holeWord, scoreOf, toParLabel, recordName, labelOf,
} from "./pageModel";
import { suggestedFor } from "./templateLogic";
import { TEAM_SPORTS, teamSportOf } from "./teamSports";
import { OUTREACH_KINDS, outreachKindOf, KNOWN_STATUS, STATUS_TONE } from "./outreachKinds";

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
// WHAT THE PAGE STARTS WITH (Alfred 2026-10-16: 24 templates opened as an empty shell, a "0 Items" counter and one Add). A page
// with no rows yet shows the fields its rows will have, as a quiet facts line under a head whose capsule opens the Fields sheet,
// and the fields the template offers in one tap, each a row whose word is Add (the shape SuggestCard already draws). Nothing here
// is added by being shown. The fields' names are the facts, so the line is the row's one grey.

export function StarterCard({ page, onFields, onSuggest }: { page: PageData; onFields?: () => void; onSuggest?: (key: string) => void }) {
  const fields = page.fields;
  const suggested = onSuggest ? suggestedFor(page) : [];
  if (!fields.length) return null;
  return (
    <>
      <Head label="Starts With" action={onFields ? { label: "Edit Fields", onClick: onFields } : undefined} />
      <Card>
        <Row label={fields.length === 1 ? "1 Field" : `${fields.length} Fields`} onClick={onFields} chev={!!onFields}
          meta={<>{fields.map((f) => <span key={f.key} className="fact"><U>{f.label}</U></span>)}</>} />
      </Card>
      {suggested.length > 0 && (
        <>
          <Head label="Suggested" count={suggested.length} />
          <Card>{suggested.map((f) => <Row key={f.key} label={f.label} value="Add" onClick={() => onSuggest!(f.key)} />)}</Card>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Team Sheet

export function TeamView({ page, lineups, onOpen, onAdd, onMakeLineup, onOpenLineup, onFields, onSport }: {
  page: PageData;
  lineups: { id: string; title: string; date: string }[];
  onOpen: (recordId: string) => void;
  onAdd: () => void;
  onMakeLineup?: () => void;
  onOpenLineup: (noteId: string) => void;
  onFields?: () => void;
  /** The sheet's sport: Position offers that sport's spots (the 2026-10-13 spec's flagship adjustment). */
  onSport?: (key: string) => void;
}) {
  const n = page.records.length;
  const sport = teamSportOf(page.meta?.sport);
  return (
    <>
      <Head label={n === 0 ? "Players" : n === 1 ? "1 Player" : `${n} Players`} action={{ label: "Add Player", onClick: onAdd }} />
      {n === 0 && <StarterCard page={page} onFields={onFields} />}
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
      {onSport && (
        <>
          <Head label="Team" />
          <Card>
            <Menu label="Sport" value={sport?.key ?? ""} word={sport?.name ?? "Any Sport"}
              options={[{ value: "", label: "Any Sport" }, ...TEAM_SPORTS.map((s) => ({ value: s.key, label: s.name }))]} onPick={onSport} />
          </Card>
          <Foot>Pick the Sport and Position Offers Its Spots; a Position Already Typed Stays</Foot>
        </>
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

export function OutreachView({ page, onOpen, onAdd, onFields, onKind }: {
  page: PageData; onOpen: (recordId: string) => void; onAdd: () => void; onFields?: () => void;
  /** The tracker's kind: outreach, grants and sponsors, or networking (the 2026-10-13 spec: "configurations"). */
  onKind?: (key: string) => void;
}) {
  const n = page.records.length;
  const kind = outreachKindOf(page.meta?.kind);
  return (
    <>
      <Head label={n === 0 ? "Contacts" : n === 1 ? "1 Contact" : `${n} Contacts`} action={{ label: "Add Contact", onClick: onAdd }} />
      {n === 0 && <StarterCard page={page} onFields={onFields} />}
      {n > 0 && (
        <Card>
          {page.records.map((r) => {
            const who = (r.v.who ?? "").trim();
            const org = (r.v.org ?? "").trim();
            const status = (r.v.status ?? "").trim();
            const last = (r.v.last ?? "").trim();
            const known = KNOWN_STATUS.has(status);
            const tone = known ? STATUS_TONE[status] ?? "" : "";
            const hasMeta = (who && org) || status || /^\d{4}-\d{2}-\d{2}$/.test(last);
            return (
              <Row key={r.id} label={<U>{who || org || "Unnamed Contact"}</U>} onClick={() => onOpen(r.id)} chev
                meta={hasMeta ? <>
                  {who && org && <span className="fact"><U>{org}</U></span>}
                  {/* An app status word wears its meaning's colour (a close with nothing left to do is plain); a typed one is drawn as typed. */}
                  {status && (known ? <span className={"fact" + (tone ? " " + tone : "")}>{status}</span> : <span className="fact"><b><U>{status}</U></b></span>)}
                  {/^\d{4}-\d{2}-\d{2}$/.test(last) && <span className="fact date">{monthDay(last)}</span>}
                </> : undefined} />
            );
          })}
        </Card>
      )}
      {onKind && (
        <>
          <Head label="Tracker" />
          <Card>
            <Menu label="Kind" value={kind.key} word={kind.name} options={OUTREACH_KINDS.map((k) => ({ value: k.key, label: k.name }))} onPick={onKind} />
          </Card>
          <Foot>A Kind Renames the Fields and the Status Words; Every Value Stays</Foot>
        </>
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
