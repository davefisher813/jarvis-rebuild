import type { ReactNode } from "react";
import { Head, Card, Row, Foot, Menu } from "../../settings/kit";
import Stepper from "../../shared/Stepper";
import { monthDay } from "../../money/bills";
import { formatMoney } from "../../money/types";
import { type PageData, type PageRecord, type PageField, recordName, labelOf } from "./pageModel";
import { templateDef } from "./templateDefs";
import { groupedRecords, totalsLine, pitcherStatuses, restDaysFor, num, sumOf, standingsOf, sessionClock, dueFact, confirmState, unconfirmedCount, monthsWords, type PitcherStatus, type DebtPlan, type DebtIn, type DebtMethod } from "./templateLogic";
import type { LedgerRow } from "./bizLedger";
import type { Suggestion } from "./appSuggest";
import {
  type Standing, SPORTS, SPORT_GROUPS, scoreStanding, sportName, nextPeriod, periodScore, bowlingFrames, bKey, pKey, dKey, dartTurns, dartsLeft, pinsLeft,
} from "./scoreboard";
import { U } from "./PageViews";

// THE TEMPLATE PAGES OF WAVES 2 TO 4, DRAWN. One shared list of rows under headings (SheetView) draws most of them; the few that
// do arithmetic for the person (a scoreboard, standings, the pitching board) have a view of their own. Phone first, the Slice 1
// anatomy: a clean row (its name, then its facts, one grey at most), a tap opens the record's sheet, a section's action is its head's.
// A checkbox, where a template has one, leads its row, at the left, like every other checkbox in the app.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const todayLocalISO = (): string => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

/** The checkbox that leads a row. It is its own tap: the row's tap opens the record. */
export function RowCheck({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <div className="task-check-tap" role="checkbox" aria-checked={on} aria-label={label} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      <div className={"task-check" + (on ? " done" : "")} />
    </div>
  );
}

function factFor(f: PageField, v: string, key: number): ReactNode {
  if (f.type === "date" && ISO.test(v)) return <span key={key} className="fact date">{monthDay(v)}</span>;
  if (f.type === "money") { const n = num(v); return <span key={key} className="fact"><b>{n === null ? <U>{v}</U> : formatMoney(n, { cents: n % 1 !== 0 })}</b></span>; }
  if (f.type === "number") return <span key={key} className="fact"><b><U>{v}</U></b></span>;
  return <span key={key} className="fact"><U>{v}</U></span>;
}

/** A row's facts: the template's `show` fields that have a value, in the order the page lists its fields. */
export function rowFacts(page: PageData, r: PageRecord, extra?: ReactNode): ReactNode {
  const d = templateDef(page.kind);
  const keys = new Set(d?.show ?? []);
  const fields = page.fields.filter((f) => f.type !== "check" && f.key !== (d?.headline ?? "name") && (keys.has(f.key) || f.extra || f.key.startsWith("f_")));
  const facts = fields.map((f, i) => ((r.v[f.key] ?? "").trim() ? factFor(f, r.v[f.key]!.trim(), i) : null)).filter(Boolean);
  const flags = Object.keys(r.flags ?? {});
  const flag = flags.length ? <span className="fact warn">{flags.length === 1 ? "Check " + labelOf(page, flags[0]!) : `Check ${flags.length} Values`}</span> : null;
  // What is coming ("Due in 12 Days", "In 3 Days") and, on a sensitive page, whether the row was confirmed.
  const t = todayLocalISO();
  const due = d?.due ? dueFact(r.v[d.due.key], t, d.due.yearly) : null;
  const dueEl = due ? <span className={"fact " + (due.tone === "red" ? "red" : due.tone === "warn" ? "warn" : "")}>{due.text}</span> : null;
  const cs = d?.confirm ? confirmState(r, t) : null;
  const confirmEl = cs === "fresh" ? <span className="fact date">Confirmed {monthDay(r.confirmedOn!)}</span> : cs === "stale" ? <span className="fact warn">Confirm Again</span> : cs === "never" ? <span className="fact warn">Not Confirmed</span> : null;
  if (!facts.length && !extra && !flag && !dueEl && !confirmEl) return undefined;
  return <>{extra}{facts}{dueEl}{confirmEl}{flag}</>;
}

// ---------------------------------------------------------------------------
// The shared list.

export function SheetView({ page, onOpen, onAdd, onToggle, onSections, timeOf, belowHead, onConfirmAll }: {
  page: PageData;
  onOpen: (recordId: string) => void;
  onAdd: () => void;
  onToggle?: (recordId: string, key: string) => void;
  onSections?: () => void;
  /** A clock time per record (a session's), drawn as the row's first fact. */
  timeOf?: Map<string, string>;
  belowHead?: ReactNode;
  /** A sensitive page: confirm every row still true, on the person's tap alone. */
  onConfirmAll?: () => void;
}) {
  const d = templateDef(page.kind);
  const noun = d?.noun ?? "Row";
  const n = page.records.length;
  const check = page.fields.find((f) => f.type === "check");
  const headline = d?.headline ?? "name";
  const total = totalsLine(page, (x) => formatMoney(x, { cents: x % 1 !== 0 }));
  const groups = groupedRecords(page);
  const rowOf = (r: PageRecord) => {
    const name = (r.v[headline] ?? "").trim() || recordName(page, r) || "Unnamed " + noun;
    const t = timeOf?.get(r.id);
    const done = check ? (r.v[check.key] ?? "") === "1" : false;
    return (
      <Row key={r.id} label={<U>{name}</U>} onClick={() => onOpen(r.id)} chev
        lead={check && onToggle ? <RowCheck on={done} label={(done ? "Mark Not Done: " : "Mark Done: ") + name} onToggle={() => onToggle(r.id, check.key)} /> : undefined}
        meta={rowFacts(page, r, t ? <span className="fact date">{t}</span> : null)} />
    );
  };
  return (
    <>
      <Head label={n === 1 ? `1 ${noun}` : `${n} ${d?.plural ?? "Rows"}`} count={total || undefined} action={{ label: "Add " + noun, onClick: onAdd }} />
      {d?.note && <Foot>{d.note}</Foot>}
      {onConfirmAll && n > 0 && unconfirmedCount(page, todayLocalISO()) > 0 && (
        <Card><Row label="Confirm Everything Is Still True" meta={<span className="fact warn">{unconfirmedCount(page, todayLocalISO())} To Confirm</span>} onClick={onConfirmAll} chev /></Card>
      )}
      {belowHead}
      {groups.map((g) => (
        <div key={g.section?.key ?? "loose"}>
          {g.section && <Head label={g.section.label} count={g.records.length} />}
          <Card>{g.records.map(rowOf)}</Card>
        </div>
      ))}
      {onSections && <Head label="Headings" action={{ label: "Edit Headings", onClick: onSections }} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Profile One-Pager: one record, drawn as a page. Empty fields are not drawn.

export function ProfileView({ page, onEdit }: { page: PageData; onEdit: (recordId: string) => void }) {
  const r = page.records[0];
  if (!r) return null;
  const filled = page.fields.filter((f) => (r.v[f.key] ?? "").trim());
  return (
    <>
      <Head label="Profile" action={{ label: "Edit Profile", onClick: () => onEdit(r.id) }} />
      {filled.length > 0
        ? <Card>{filled.map((f) => <Row key={f.key} label={f.label} value={<U>{r.v[f.key]!.trim()}</U>} onClick={() => onEdit(r.id)} />)}</Card>
        : <Foot>Add What You Want on the Page; Empty Fields Stay Off It</Foot>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pitching Board.

export function PitchingView({ page, today, onOpen, onAdd, onLimit }: {
  page: PageData; today: string; onOpen: (id: string) => void; onAdd: () => void; onLimit: () => void;
}) {
  const limit = num(page.meta?.limit) ?? 85;
  const statuses = pitcherStatuses(page, today);
  const outings = [...page.records].sort((a, b) => ((b.v.date ?? "") > (a.v.date ?? "") ? 1 : -1));
  const status = (s: PitcherStatus) => s.availableNow
    ? <span className="fact good">Available</span>
    : <span className="fact warn">Rests Until {monthDay(s.availableOn!)}</span>;
  return (
    <>
      {statuses.length > 0 && (
        <>
          <Head label="Who Can Pitch" count={statuses.filter((s) => s.availableNow).length + " of " + statuses.length} />
          <Card>
            {statuses.map((s) => (
              <Row key={s.name} label={<U>{s.name}</U>} onClick={s.last ? () => onOpen(s.last!.id) : undefined} chev={!!s.last}
                meta={<>{status(s)}{s.last && <span className="fact"><b>{s.pitchesLast}</b> Pitches Last</span>}<span className="fact"><b>{s.total}</b> Total</span></>} />
            ))}
          </Card>
        </>
      )}
      <Head label={outings.length === 1 ? "1 Outing" : `${outings.length} Outings`} action={{ label: "Add Outing", onClick: onAdd }} />
      {outings.length > 0 && (
        <Card>
          {outings.map((r) => {
            const p = num(r.v.pitches);
            const over = p !== null && p > limit;
            return (
              <Row key={r.id} label={<U>{(r.v.name ?? "").trim() || "Unnamed Pitcher"}</U>} onClick={() => onOpen(r.id)} chev
                meta={<>
                  {ISO.test(r.v.date ?? "") && <span className="fact date">{monthDay(r.v.date!)}</span>}
                  {p !== null && <span className="fact"><b>{p}</b> Pitches</span>}
                  {p !== null && <span className="fact">{restDaysFor(p)} {restDaysFor(p) === 1 ? "Day" : "Days"} Rest</span>}
                  {over && <span className="fact warn">Over the Limit</span>}
                </>} />
            );
          })}
        </Card>
      )}
      <Head label="Rules" />
      <Card><Row label="Daily Limit" value={String(limit)} onClick={onLimit} chev /></Card>
      <Foot>Rest Days Follow From the Pitches Thrown: 21, 36, 51 and 66 Each Add a Day</Foot>
    </>
  );
}

// ---------------------------------------------------------------------------
// League Standings.

export function StandingsView({ page, onTeam, onAddTeam, onGame, onAddGame }: {
  page: PageData; onTeam: (id: string) => void; onAddTeam: () => void; onGame: (id: string) => void; onAddGame: () => void;
}) {
  const rows = standingsOf(page);
  const games = [...(page.games ?? [])].sort((a, b) => (b.date > a.date ? 1 : -1));
  const name = (id: string) => (page.records.find((r) => r.id === id)?.v.name ?? "").trim() || "Team";
  return (
    <>
      <Head label="Standings" action={page.records.length >= 2 ? { label: "Record a Game", onClick: onAddGame } : undefined} />
      {rows.length > 0 && (
        <Card>
          {rows.map((t, i) => (
            <Row key={t.id} lead={<div className="row-ico nav-tile-graphite"><b>{i + 1}</b></div>} label={<U>{t.name}</U>} onClick={() => onTeam(t.id)} chev
              meta={<>
                <span className="fact"><b>{t.w}-{t.l}{t.t ? "-" + t.t : ""}</b></span>
                <span className="fact"><b>{t.pts}</b> Pts</span>
                {t.gp > 0 && <span className="fact">{t.pf}-{t.pa}</span>}
              </>} />
          ))}
        </Card>
      )}
      <Head label={page.records.length === 1 ? "1 Team" : `${page.records.length} Teams`} action={{ label: "Add Team", onClick: onAddTeam }} />
      {games.length > 0 && (
        <>
          <Head label="Games" count={games.length} />
          <Card>
            {games.map((g) => (
              <Row key={g.id} label={<U>{name(g.a)} {g.sa}, {name(g.b)} {g.sb}</U>} onClick={() => onGame(g.id)} chev
                meta={ISO.test(g.date) ? <span className="fact date">{monthDay(g.date)}</span> : undefined} />
            ))}
          </Card>
        </>
      )}
      {rows.length < 2 && <Foot>Add Two Teams, Then Record a Game; Wins, Losses and Points Work Themselves Out</Foot>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Scoreboard.

function sideLine(page: PageData, s: Standing, id: string): ReactNode {
  const sc = page.score!;
  const r = page.records.find((x) => x.id === id)!;
  const parts: ReactNode[] = [];
  if (sc.mode === "periods") {
    const cols = Array.from({ length: sc.periods }, (_, i) => periodScore(r, i + 1));
    if (cols.some((c) => c !== null)) parts.push(<span key="cols" className="fact">{cols.map((c) => (c === null ? "-" : c)).join(" · ")}</span>);
    if (s.secondary !== null) parts.push(<span key="tot" className="fact"><b>{s.secondary}</b> Total</span>);
  } else if (sc.mode === "countdown") {
    const t = dartTurns(page, r);
    if (t.length) parts.push(<span key="t" className="fact">{t.length} {t.length === 1 ? "Turn" : "Turns"}</span>);
  } else if (sc.mode === "bowling") {
    const fr = bowlingFrames(r).filter((f) => f.rolls.length);
    if (fr.length) parts.push(<span key="f" className="fact">Frame {fr.length}</span>);
  }
  if (s.done) parts.push(<span key="d" className="fact good">{sc.mode === "countdown" ? "Checked Out" : sc.mode === "target" ? "Reached " + sc.target : "Finished"}</span>);
  else if (s.leading) parts.push(<span key="l" className="fact good">Leading</span>);
  return parts.length ? <>{parts}</> : undefined;
}

export function ScoreboardView({ page, onScore, onSide, onAddSide, onSport, onDate, onAddPeriod }: {
  page: PageData; onScore: () => void; onSide: (id: string) => void; onAddSide: () => void; onSport: (key: string) => void; onDate: () => void; onAddPeriod: () => void;
}) {
  const sc = page.score!;
  const standing = scoreStanding(page);
  const anyScored = standing.some((s) => (sc.mode === "countdown" ? s.value < (sc.target ?? 501) : s.value > 0 || (s.secondary ?? 0) > 0));
  const cta = sc.mode === "target" ? "Keep Score" : anyScored ? "Keep Scoring" : "Start " + sc.unit + " 1";
  const big = (s: Standing) => (sc.mode === "countdown" ? String(s.value) : String(s.value));
  const bigLabel = sc.mode === "countdown" ? "Left" : sc.winBy === "periodsWon" ? "Sets" : sc.mode === "target" ? "" : "Pts";
  return (
    <>
      <Head label="Score" action={{ label: cta, onClick: onScore }} />
      <Card>
        {standing.map((s) => (
          <Row key={s.id} label={<U>{s.name}</U>} onClick={() => onSide(s.id)} chev
            value={<span className="fact"><b>{big(s)}</b>{bigLabel ? " " + bigLabel : ""}</span>}
            meta={sideLine(page, s, s.id)} />
        ))}
      </Card>
      <Head label="Game" action={{ label: "Add a Side", onClick: onAddSide }} />
      <Card>
        <Menu label="Sport" value={sc.sport} word={sportName(page)}
          options={SPORT_GROUPS.flatMap((g) => SPORTS.filter((s) => s.group === g).map((s) => ({ value: s.key, label: s.name })))}
          onPick={onSport} />
        <Row label="Date" value={sc.date ? monthDay(sc.date) : ""} onClick={onDate} chev />
        {sc.mode === "periods" && <Row label={"Add a " + sc.unit} value={String(sc.periods)} onClick={onAddPeriod} chev />}
      </Card>
    </>
  );
}

/** ONE COLUMN AT A TIME, BIG ENOUGH FOR A THUMB: the Golf Scorecard's hole screen for every other game. */
export function ScoreEntry({ page, at, onSet }: { page: PageData; at: number; onSet: (recordId: string, key: string, score: number | null) => void }) {
  const sc = page.score!;
  const sideName = (r: PageRecord) => (r.v.name ?? "").trim() || "Side";
  if (sc.mode === "bowling") {
    return (
      <>
        {page.records.map((r) => {
          const fr = bowlingFrames(r)[at - 1]!;
          const rolls: ("a" | "b" | "c")[] = at === 10 ? ["a", "b", "c"] : ["a", "b"];
          const aVal = num(r.v[bKey(at, "a")]);
          return (
            <div key={r.id}>
              <Head label={sideName(r)} count={fr.total === null ? undefined : String(fr.total)} />
              <Card>
                {rolls.map((roll, i) => {
                  // No second roll in frames 1 to 9 after a strike; a third only in the tenth after a strike or spare.
                  if (at < 10 && roll === "b" && aVal === 10) return null;
                  if (at === 10 && roll === "c") { const b = num(r.v[bKey(10, "b")]); if (!(aVal === 10 || (aVal !== null && b !== null && aVal + b === 10))) return null; }
                  const v = num(r.v[bKey(at, roll)]);
                  const left = pinsLeft(r, at, roll);
                  return (
                    <Row key={roll} plain label={"Roll " + (i + 1)} meta={v === 10 && roll === "a" ? <span className="fact good">Strike</span> : v !== null && roll === "b" && aVal !== null && aVal + v === 10 ? <span className="fact good">Spare</span> : undefined}>
                      <Stepper value={v ?? 0} step={1} min={0} max={left} label={`Roll ${i + 1} for ${sideName(r)}`} onChange={(x) => onSet(r.id, bKey(at, roll), x)} />
                    </Row>
                  );
                })}
              </Card>
            </div>
          );
        })}
      </>
    );
  }
  if (sc.mode === "countdown") {
    return (
      <Card>
        {page.records.map((r) => {
          const turns = dartTurns(page, r);
          const cur = turns.find((t) => t.n === at);
          const left = dartsLeft(page, r);
          return (
            <Row key={r.id} plain label={<U>{sideName(r)}</U>}
              meta={<><span className="fact"><b>{cur ? cur.remaining : left}</b> Left</span>{cur?.bust && <span className="fact warn">Bust, Does Not Count</span>}{left === 0 && <span className="fact good">Checked Out</span>}</>}>
              <Stepper value={num(r.v[dKey(at)]) ?? 0} step={1} min={0} max={180} label={`Thrown for ${sideName(r)}`} onChange={(x) => onSet(r.id, dKey(at), x)} />
            </Row>
          );
        })}
      </Card>
    );
  }
  const key = pKey(sc.mode === "target" ? 1 : at);
  const tgt = sc.target;
  return (
    <Card>
      {page.records.map((r) => {
        const total = standing(page, r);
        return (
          <Row key={r.id} plain label={<U>{sideName(r)}</U>}
            meta={sc.mode === "periods" && total !== null ? <span className="fact"><b>{total}</b> Total</span> : tgt && (num(r.v[key]) ?? 0) >= tgt ? <span className="fact good">Reached {tgt}</span> : undefined}>
            <Stepper value={num(r.v[key]) ?? 0} step={1} min={0} max={sc.mode === "target" ? 99 : 999} label={`${sc.unit} ${sc.mode === "target" ? "" : at} for ${sideName(r)}`.replace("  ", " ")} onChange={(x) => onSet(r.id, key, x)} />
          </Row>
        );
      })}
    </Card>
  );
}

function standing(page: PageData, r: PageRecord): number | null {
  const sc = page.score!;
  let t = 0, any = false;
  for (let p = 1; p <= sc.periods; p++) { const v = periodScore(r, p); if (v !== null) { t += v; any = true; } }
  return any ? t : null;
}

/** Where a scoreboard's score screen starts. */
export const scoreStart = (page: PageData): number => nextPeriod(page);

// ---------------------------------------------------------------------------
// Training Log: the workouts come from Health, read where they live, never copied; the page's own rows are notes.

export interface WorkoutLine { id: string; date: string; name: string; minutes: number | null; exercises: number }

export function TrainingLogView({ page, workouts, onOpen, onAdd }: { page: PageData; workouts: WorkoutLine[] | null; onOpen: (id: string) => void; onAdd: () => void }) {
  const notes = [...page.records].sort((a, b) => ((b.v.date ?? "") > (a.v.date ?? "") ? 1 : -1));
  return (
    <>
      <Head label="From Health" count={workouts ? workouts.length : undefined} />
      {workouts && workouts.length > 0
        ? <Card>{workouts.slice(0, 12).map((w) => (
            <Row key={w.id} label={<U>{w.name}</U>}
              meta={<>{ISO.test(w.date) && <span className="fact date">{monthDay(w.date)}</span>}{w.minutes !== null && <span className="fact"><b>{w.minutes}</b> Min</span>}<span className="fact">{w.exercises} {w.exercises === 1 ? "Exercise" : "Exercises"}</span></>} />
          ))}</Card>
        : <Foot>{workouts ? "No Workouts Logged Yet; They Appear Here From Health" : "Workouts Appear Here From Health"}</Foot>}
      <Head label={notes.length === 1 ? "1 Note" : `${notes.length} Notes`} action={{ label: "Add Note", onClick: onAdd }} />
      {notes.length > 0 && (
        <Card>
          {notes.map((r) => (
            <Row key={r.id} label={<U>{(r.v.note ?? "").trim() || "Note"}</U>} onClick={() => onOpen(r.id)} chev
              meta={rowFacts(page, r)} />
          ))}
        </Card>
      )}
      <Foot>Workouts Are Read From Health, Never Copied; Notes Live on This Page</Foot>
    </>
  );
}

export { sumOf, sessionClock };

// ---------------------------------------------------------------------------
// What the app can suggest, confirm first: a row per suggestion, one tap to add it, nothing added by being shown.

export function SuggestCard({ title, items, labelOf: label, metaOf, onAdd }: {
  title: string;
  items: Suggestion[];
  labelOf: (s: Suggestion) => string;
  metaOf?: (s: Suggestion) => ReactNode;
  onAdd: (s: Suggestion) => void;
}) {
  if (!items.length) return null;
  return (
    <>
      <Head label={title} count={items.length} />
      <Card>{items.slice(0, 8).map((s) => <Row key={s.key} label={<U>{label(s)}</U>} meta={metaOf?.(s)} value="Add" onClick={() => onAdd(s)} />)}</Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Debt Payoff: the order to pay in and how long it takes, from the balances Money holds.

const METHOD_WORD: Record<DebtMethod, string> = { avalanche: "Highest Rate First", snowball: "Smallest Balance First" };
export const debtMethodWord = (m: string | undefined): string => METHOD_WORD[(m as DebtMethod) in METHOD_WORD ? (m as DebtMethod) : "avalanche"];

export function DebtView({ page, debts, plan, linkedAsOf, canFromMoney, onOpen, onAdd, onFromMoney, onMethod, onExtra }: {
  page: PageData;
  debts: DebtIn[];
  plan: DebtPlan;
  /** The day a linked debt's balance was last entered in Money, by record id. */
  linkedAsOf: Map<string, string>;
  canFromMoney: boolean;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onFromMoney: () => void;
  onMethod: () => void;
  onExtra: () => void;
}) {
  const byId = new Map(debts.map((d) => [d.id, d]));
  const extra = num(page.meta?.extra) ?? 0;
  const n = page.records.length;
  const owed = debts.reduce((s, d) => s + d.balance, 0);
  const stepOf = new Map(plan.steps.map((x) => [x.id, x]));
  const rows = plan.order.length ? plan.order : page.records.map((r) => r.id);
  return (
    <>
      <Head label={n === 1 ? "1 Debt" : `${n} Debts`} count={owed > 0 ? formatMoney(owed, { cents: owed % 1 !== 0 }) : undefined} action={{ label: "Add Debt", onClick: onAdd }} />
      <Foot>Balances Come From Money; Only the Rate and the Minimum Are Kept Here</Foot>
      <Card>
        {canFromMoney && <Row label="Add From Money" meta={<span className="fact">Cards and Debts You Already Track</span>} onClick={onFromMoney} chev />}
        <Row label="Pay First" value={debtMethodWord(page.meta?.method)} onClick={onMethod} chev />
        <Row label="Extra Each Month" value={extra > 0 ? formatMoney(extra, { cents: extra % 1 !== 0 }) : "None"} onClick={onExtra} chev />
      </Card>
      {rows.length > 0 && (
        <>
          <Head label="Pay in This Order" />
          <Card>
            {rows.map((id) => {
              const r = page.records.find((x) => x.id === id);
              const d = byId.get(id);
              if (!r || !d) return null;
              const st = stepOf.get(id);
              const asOf = linkedAsOf.get(id);
              return (
                <Row key={id} label={<U>{d.name}</U>} onClick={() => onOpen(id)} chev
                  meta={<>
                    <span className="fact"><b>{formatMoney(d.balance, { cents: d.balance % 1 !== 0 })}</b></span>
                    {d.apr > 0 && <span className="fact"><b>{d.apr}</b>% APR</span>}
                    {st && <span className="fact good">Clear by Month {st.month}</span>}
                    {d.balance > 0 && !st && <span className="fact warn">Not Cleared</span>}
                    {asOf && ISO.test(asOf) && <span className="fact date">As of {monthDay(asOf)}</span>}
                  </>} />
              );
            })}
          </Card>
          <Foot>{plan.total <= 0 ? "Nothing Owed" : plan.monthly <= 0 ? "Add Each Debt's Minimum Payment to See How Long It Takes" : plan.months === null ? "These Payments Never Clear the Debt; Raise the Extra or the Minimums" : `Debt-Free in ${monthsWords(plan.months)} · Paying ${formatMoney(plan.monthly, { cents: false })} a Month · Interest ${formatMoney(plan.interest, { cents: false })}`}</Foot>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Business Ledger: read from Money, never stored.

export function BizLedgerView({ page, rows, filterWord, onFilter }: { page: PageData; rows: LedgerRow[]; filterWord: string; onFilter: () => void }) {
  const total = rows.reduce((s, r) => s + r.cents, 0) / 100;
  const d = templateDef(page.kind);
  return (
    <>
      <Head label={rows.length === 1 ? "1 Entry" : `${rows.length} Entries`} count={rows.length ? formatMoney(total, { cents: total % 1 !== 0 }) : undefined} />
      {d?.note && <Foot>{d.note}</Foot>}
      <Card><Row label="Showing" value={filterWord} onClick={onFilter} chev /></Card>
      {rows.length > 0 ? (
        <Card>
          {rows.map((r) => (
            // row-tap: a row read from Money opens nothing here; a correction is made in Money and shows here next time
            <Row key={r.id} label={<U>{r.vendor || "Unnamed"}</U>}
              meta={<><span className="fact date">{monthDay(r.date)}</span><span className="fact"><b>{formatMoney(r.cents / 100, { cents: r.cents % 100 !== 0 })}</b></span><span className="fact">{r.from}</span></>} />
          ))}
        </Card>
      ) : <Foot>Nothing in This Category Yet; Tag Spending or Receipts in Money With It and They Appear Here</Foot>}
    </>
  );
}
