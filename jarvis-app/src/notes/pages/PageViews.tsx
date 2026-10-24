import { Fragment, useState, type ReactNode } from "react";
import { Head, Card, Row, Foot, Menu } from "../../settings/kit";
import { monthDay } from "../../money/bills";
import {
  type PageData, type PageRecord, type RosterChange,
  holeWord, scoreOf, toParLabel, recordName, labelOf,
} from "./pageModel";
import {
  parOf, parsSet, playerRound, matchState, roundStory, winnerLine, isFinished, statsOf, girOn, puttKey, fairKey, penKey, sandKey, FAIRWAYS,
} from "./golf";
import { suggestedFor, groupDues, keyDates, dueFact, num as parseNum } from "./templateLogic";
import { formatMoney } from "../../money/types";
import { todayISO } from "../../schedule/calendar";
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

export function TeamView({ page, lineups, onOpen, onAdd, onMakeLineup, onOpenLineup, onFields, onSport, onSuggest }: {
  page: PageData;
  lineups: { id: string; title: string; date: string }[];
  onOpen: (recordId: string) => void;
  onAdd: () => void;
  onMakeLineup?: () => void;
  onOpenLineup: (noteId: string) => void;
  onFields?: () => void;
  /** The sheet's sport: Position offers that sport's spots (the 2026-10-13 spec's flagship adjustment). */
  onSport?: (key: string) => void;
  /** One tap adds a group field (Role, Fee Owed, Paid, Coming, Key Date) to every row: the Group Manager folded into the sheet. */
  onSuggest?: (key: string) => void;
}) {
  const n = page.records.length;
  const sport = teamSportOf(page.meta?.sport);
  const dues = groupDues(page);
  const dates = keyDates(page, todayISO());
  const offered = onSuggest && n > 0 ? suggestedFor(page) : [];
  const money = (x: number) => formatMoney(x, { cents: x % 1 !== 0 });
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
            const role = (r.v.role ?? "").trim();
            const fee = parseNum(r.v.fee);
            const owes = dues && fee !== null && fee > 0 ? (r.v.paid === "1" ? "Paid" : `Owes ${money(fee)}`) : "";
            const coming = page.fields.some((x) => x.key === "coming") && r.v.coming === "1";
            return (
              <Row key={r.id} label={<U>{recordName(page, r) || "Unnamed Player"}</U>} onClick={() => onOpen(r.id)} chev
                meta={num || pos || role || owes || coming || flag ? <>
                  {num && <span className="fact"><b><U>#{num}</U></b></span>}
                  {pos && <span className="fact"><U>{pos}</U></span>}
                  {role && <span className="fact"><U>{role}</U></span>}
                  {owes && <span className={"fact" + (owes === "Paid" ? "" : " warn")}>{owes}</span>}
                  {coming && <span className="fact">Coming</span>}
                  {flag}
                </> : undefined} />
            );
          })}
        </Card>
      )}
      {dues && (
        <>
          <Head label="Dues" />
          <Card>
            <Row plain label="Owed" value={money(dues.owed)} />
            <Row plain label="Paid" value={money(dues.paid)} />
            <Row plain label="Still Due" value={money(dues.left)} meta={dues.unpaid ? <span className="fact warn">{dues.unpaid === 1 ? "1 Unpaid" : `${dues.unpaid} Unpaid`}</span> : undefined} />
          </Card>
        </>
      )}
      {dates.length > 0 && (
        <>
          <Head label="Key Dates" />
          <Card>
            {dates.map((d) => {
              const due = dueFact(d.date, todayISO());
              return (
                <Row key={d.id} plain label={<U>{d.name || "Unnamed"}</U>}
                  meta={<><span className="fact date">{monthDay(d.date)}</span>{due && <span className="fact">{due.text}</span>}</>} />
              );
            })}
          </Card>
        </>
      )}
      {offered.length > 0 && (
        <>
          <Head label="Make It a Group" />
          <Card>{offered.map((f) => <Row key={f.key} label={f.label} value="Add" onClick={() => onSuggest!(f.key)} />)}</Card>
          <Foot>Fees, Roles, Who Is Coming and Key Dates, One Tap Each; the Roster Stays as It Is Until You Ask</Foot>
        </>
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
            const next = (r.v.next ?? "").trim();
            const hasLast = /^\d{4}-\d{2}-\d{2}$/.test(last);
            const hasMeta = hasLast || next || (who && org) || status;
            return (
              <Row key={r.id} label={<U>{who || org || "Unnamed Contact"}</U>} onClick={() => onOpen(r.id)} chev
                meta={hasMeta ? <>
                  {/* LAST TOUCH AND NEXT STEP LEAD (Dave's fix item): what you did last and what comes next, then who and where it stands. */}
                  {hasLast && <span className="fact date">Last {monthDay(last)}</span>}
                  {next && <span className="fact"><U>{next}</U></span>}
                  {who && org && <span className="fact"><U>{org}</U></span>}
                  {/* An app status word wears its meaning's colour (a close with nothing left to do is plain); a typed one is drawn as typed. */}
                  {status && (known ? <span className={"fact" + (tone ? " " + tone : "")}>{status}</span> : <span className="fact"><b><U>{status}</U></b></span>)}
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
// Golf Scorecard (rebuilt 2026-10-23, Dave's Golf decision): big score chips, a stats strip a tap deep, the real grid on screen,
// net and Stableford live, and a finish that tells the round. Nothing here is guessed: a par that was never set is left out of
// "to par" and said so, and a hole nobody scored is never filled in.

const playerName = (r: PageRecord) => (r.v.name ?? "").trim() || "Player";

/** The facts that follow a player everywhere: where they are, what they have, to par, net, points. */
function playerFacts(page: PageData, r: PageRecord): ReactNode {
  const g = page.golf!;
  const p = playerRound(page, r);
  if (!p.played) return undefined;
  return (
    <>
      <span className="fact">{p.thru >= g.holes ? "Final" : `Thru ${p.thru}`}</span>
      <span className="fact"><b>{p.gross}</b></span>
      {p.toPar !== null && <span className="fact"><b>{toParLabel(p.toPar)}</b></span>}
      {p.net !== null && <span className="fact">{p.net} Net</span>}
      {p.points !== null && <span className="fact">{p.points} Pts</span>}
    </>
  );
}

/** THE REAL SCORECARD, ON SCREEN. Holes down the side and players across, which is what a phone can hold. Every score is a 44px tap
 *  that opens that hole to fix it. Under par is ringed, over par is boxed, in the page's one ink: no colour is spent on it. */
export function ScoreGrid({ page, onHole }: { page: PageData; onHole: (hole: number) => void }) {
  const g = page.golf!;
  const holes = Array.from({ length: g.holes }, (_, i) => i + 1);
  const rounds = page.records.map((r) => playerRound(page, r));
  const sumPar = (from: number, to: number): number | null => {
    let n = 0;
    for (let h = from; h <= to; h++) { const p = parOf(g, h); if (p === null) return null; n += p; }
    return n;
  };
  const split = g.holes === 18;
  // A half is drawn only for a player who scored a hole in it: an empty back nine is blank, never a 0.
  const scoredIn = (r: PageRecord, from: number, to: number) => { for (let h = from; h <= to; h++) if (scoreOf(r, h) !== null) return true; return false; };
  const sumRow = (label: string, par: number | null, vals: (p: ReturnType<typeof playerRound>, i: number) => number | null) => (
    <tr className="sg-sum" key={label}>
      <th scope="row" className="sg-hole">{label}</th>
      <td>{par ?? ""}</td>
      {rounds.map((p, i) => { const v = vals(p, i); return <td key={page.records[i]!.id}>{v ?? ""}</td>; })}
    </tr>
  );
  return (
    <div className="score-grid-wrap">
      <table className="score-grid">
        <thead>
          <tr>
            <th scope="col" className="sg-hole">Hole</th>
            <th scope="col">Par</th>
            {page.records.map((r) => <th scope="col" key={r.id}><U><span className="sg-name">{playerName(r)}</span></U></th>)}
          </tr>
        </thead>
        <tbody>
          {holes.map((h) => (
            <Fragment key={h}>
              <tr>
                <th scope="row" className="sg-hole">{h}</th>
                <td>{parOf(g, h) ?? ""}</td>
                {page.records.map((r) => {
                  const s = scoreOf(r, h);
                  const par = parOf(g, h);
                  const cls = s === null ? "sg-empty" : par !== null && s < par ? "sg-mark sg-under" : par !== null && s > par ? "sg-mark sg-over" : "sg-mark";
                  return (
                    <td key={r.id}>
                      <button type="button" className="sg-btn" aria-label={`Edit Hole ${h}, ${playerName(r)}, ${s === null ? "No Score" : s}`} onClick={() => onHole(h)}>
                        <span className={cls}>{s ?? "–"}</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
              {split && h === 9 && sumRow("Out", sumPar(1, 9), (p, i) => (scoredIn(page.records[i]!, 1, 9) ? p.out : null))}
            </Fragment>
          ))}
          {split && sumRow("In", sumPar(10, 18), (p, i) => (scoredIn(page.records[i]!, 10, 18) ? p.in : null))}
          {sumRow("Total", sumPar(1, g.holes), (p) => (p.played ? p.gross : null))}
        </tbody>
      </table>
    </div>
  );
}

/** THE ROUND, TOLD. Per player: the numbers, then what the round was. Drawn once a round is finished, and before that when every
 *  card is full. A winner is named only when a full card makes one. */
export function RoundStoryCard({ page }: { page: PageData }) {
  const lines = roundStory(page);
  const win = winnerLine(page);
  return (
    <>
      <Head label="The Round" />
      <Card>
        {win && <Row plain label={<U>{win}</U>} />}
        {lines.map((l) => (
          <Row key={l.name} plain label={<U>{l.name}</U>} meta={<>{l.facts.map((f) => <span className="fact" key={f}>{f}</span>)}</>} />
        ))}
      </Card>
    </>
  );
}

export function ScorecardView({ page, onHole, onPlayer, onAddPlayer, onCourse, onHoles, onDate, onMatch, onFinish }: {
  page: PageData;
  onHole: (hole?: number) => void;
  onPlayer: (recordId: string) => void;
  onAddPlayer: () => void;
  onCourse: () => void;
  onHoles: (h: 9 | 18) => void;
  onDate: () => void;
  onMatch: (on: boolean) => void;
  onFinish: () => void;
}) {
  const g = page.golf!;
  const anyPlayed = page.records.some((r) => playerRound(page, r).played > 0);
  const allDone = page.records.length > 0 && page.records.every((r) => playerRound(page, r).played >= g.holes);
  const finished = isFinished(g);
  const m = matchState(page);
  const set = parsSet(g);
  return (
    <>
      <Head label="Scores" action={{ label: allDone ? "Review Holes" : anyPlayed ? "Keep Scoring" : "Start Hole 1", onClick: () => onHole() }} />
      <Card>
        {page.records.map((r) => (
          <Row key={r.id} label={<U>{playerName(r)}</U>} onClick={() => onPlayer(r.id)} chev meta={playerFacts(page, r)} />
        ))}
      </Card>
      {m && (
        <>
          <Head label="Match" />
          <Card><Row plain label={m.words.who ? <U>{m.words.who}</U> : "Match Play"} meta={<span className="fact">{m.words.what}</span>} /></Card>
        </>
      )}
      {anyPlayed && (
        <>
          <Head label="Scorecard" />
          <ScoreGrid page={page} onHole={(h) => onHole(h)} />
        </>
      )}
      {(finished || allDone) && <RoundStoryCard page={page} />}
      <Head label="Round" action={{ label: "Add Player", onClick: onAddPlayer }} />
      <Card>
        <Row label="Course" value={g.course ? <U>{g.course}</U> : undefined} onClick={onCourse} chev />
        <Row label="Pars" value={set >= g.holes ? "All Set" : set === 0 ? "Not Set" : `${set} of ${g.holes} Set`} onClick={onCourse} chev />
        <Menu label="Holes" value={String(g.holes)} options={[{ value: "9", label: "9 Holes" }, { value: "18", label: "18 Holes" }]} onPick={(v) => onHoles(v === "9" ? 9 : 18)} />
        <Row label="Date" value={g.date ? monthDay(g.date) : ""} onClick={onDate} chev />
        {page.records.length === 2 && (
          <Menu label="Match Play" value={g.match ? "on" : "off"} options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]} onPick={(v) => onMatch(v === "on")} />
        )}
      </Card>
      {anyPlayed && (
        <div className="pad-x exp-acts">
          <button type="button" className="btn btn-primary btn-block" onClick={onFinish}>{finished ? "Update Rounds" : "Finish Round"}</button>
        </div>
      )}
      {anyPlayed && <Foot>{finished ? "Kept in Rounds" : "Finishing Keeps the Round in Rounds"}</Foot>}
    </>
  );
}

/** One chip: tap it to set, tap it again to clear. Never a hue; the selected chip takes the app's one selected look. */
function Chip({ on, label, aria, onTap, par }: { on: boolean; label: string; aria: string; onTap: () => void; par?: boolean }) {
  return <button type="button" className={"score-chip" + (on ? " active" : "") + (par ? " is-par" : "")} aria-pressed={on} aria-label={aria} onClick={onTap}>{label}</button>;
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** ONE HOLE AT A TIME, BIG ENOUGH FOR A THUMB ON A COURSE. Par as four chips (kept with the course once the card is full), each
 *  player's strokes as big chips around par, and a Stats strip one tap deep: putts, fairway, penalties, sand. Green in regulation
 *  is worked out from the score and the putts, never asked. */
export function HoleEntry({ page, hole, onScore, onPar, onStat }: {
  page: PageData;
  hole: number;
  onScore: (recordId: string, score: number | null) => void;
  onPar: (par: number | null) => void;
  onStat: (recordId: string, key: string, value: string) => void;
}) {
  const g = page.golf!;
  const par = parOf(g, hole);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <Card>
        <Row label="Par" plain meta={par === null ? <span className="fact">Not Set</span> : undefined}>
          <div className="hole-chips">
            {range(3, 6).map((p) => <Chip key={p} on={par === p} label={String(p)} aria={`Par ${p} for Hole ${hole}`} onTap={() => onPar(par === p ? null : p)} />)}
          </div>
        </Row>
      </Card>
      {page.records.map((r) => {
        const name = playerName(r);
        const s = scoreOf(r, hole);
        const st = statsOf(r, hole);
        const p = playerRound(page, r);
        let base = par === null ? 2 : Math.max(1, par - 2);
        if (s !== null && s >= base + 8) base = s - 7;
        if (s !== null && s < base) base = Math.max(1, s);
        const gir = girOn(s, st.putts, par);
        const expanded = open === r.id;
        const recorded = [st.putts !== null && `${st.putts} Putts`, st.fairway && FAIRWAYS.find((f) => f.key === st.fairway)!.label, st.penalties > 0 && `${st.penalties} Pen`, st.sand && "Sand", gir !== null && (gir ? "Green" : "No Green")].filter(Boolean) as string[];
        return (
          <div key={r.id}>
            <Head label={name} />
            <Card>
              <Row plain label={s === null ? "Strokes" : par === null ? `${s} Strokes` : holeWord(s, par)}
                meta={s !== null || p.played ? <>
                  {p.played > 0 && <span className="fact"><b>{p.gross}</b></span>}
                  {p.toPar !== null && <span className="fact"><b>{toParLabel(p.toPar)}</b></span>}
                </> : undefined} />
              <div className="score-chips" role="group" aria-label={`Strokes for ${name}`}>
                {range(base, base + 7).map((n) => (
                  <Chip key={n} on={s === n} par={par === n} label={String(n)} aria={`Strokes ${n} for ${name}`} onTap={() => onScore(r.id, s === n ? null : n)} />
                ))}
              </div>
              <Row label="Stats" onClick={() => setOpen(expanded ? null : r.id)} chev
                meta={recorded.length ? <>{recorded.map((f) => <span className="fact" key={f}>{f}</span>)}</> : undefined} />
              {expanded && (
                <>
                  <Row plain label="Putts">
                    <div className="hole-chips">
                      {range(0, 4).map((n) => <Chip key={n} on={st.putts === n} label={String(n)} aria={`Putts ${n} for ${name}`} onTap={() => onStat(r.id, puttKey(hole), st.putts === n ? "" : String(n))} />)}
                    </div>
                  </Row>
                  {par !== 3 && (
                    <Row plain label="Fairway">
                      <div className="hole-chips">
                        {FAIRWAYS.map((f) => <Chip key={f.key} on={st.fairway === f.key} label={f.label} aria={`Fairway ${f.label} for ${name}`} onTap={() => onStat(r.id, fairKey(hole), st.fairway === f.key ? "" : f.key)} />)}
                      </div>
                    </Row>
                  )}
                  <Row plain label="Penalties">
                    <div className="hole-chips">
                      {range(1, 3).map((n) => <Chip key={n} on={st.penalties === n} label={String(n)} aria={`Penalties ${n} for ${name}`} onTap={() => onStat(r.id, penKey(hole), st.penalties === n ? "" : String(n))} />)}
                    </div>
                  </Row>
                  <Row plain label="Sand">
                    <div className="hole-chips">
                      <Chip on={st.sand} label="Bunker" aria={`Sand shot for ${name}`} onTap={() => onStat(r.id, sandKey(hole), st.sand ? "" : "1")} />
                    </div>
                  </Row>
                  {gir !== null && <Row plain label="Green in Regulation" value={gir ? "Yes" : "No"} />}
                </>
              )}
            </Card>
          </div>
        );
      })}
    </>
  );
}

/** A read-only page, for a snapshot: the records as they were, nothing to tap. */
export function ReadOnlyRecords({ page }: { page: PageData }) {
  if (page.kind === "scorecard") {
    return (
      <Card>
        {page.records.map((r) => {
          return <Row key={r.id} label={<U>{playerName(r)}</U>} meta={playerFacts(page, r)} />;
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
