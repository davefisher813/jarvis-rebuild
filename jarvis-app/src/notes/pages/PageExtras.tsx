import { useState } from "react";
import { Head, Card, Row, Foot } from "../../settings/kit";
import { Check } from "../../shared/icons";
import { monthDay } from "../../money/bills";
import { type PageData, type PageSnapshot, SNAPSHOT_WHY, recordName } from "./pageModel";
import { ReadOnlyRecords, U } from "./PageViews";

// Snapshots and the lineup builder: the two screens a template page pushes
// over itself. Same chassis as every pushed Notes screen (nav-bar, large
// title, quiet heads, ruled cards).

const when = (at: number) => {
  const d = new Date(at);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return { day: monthDay(iso), clock: `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}` };
};

/** Every dated snapshot of the page's records, newest first; one opens read-only, with Restore as its only action. */
export function SnapshotsScreen({ page, onBack, onRestore }: { page: PageData; onBack: () => void; onRestore: (at: number) => void }) {
  const [open, setOpen] = useState<PageSnapshot | null>(null);
  const list = [...(page.snapshots ?? [])].reverse();
  if (open) {
    const view: PageData = { ...page, fields: open.fields, records: open.records, ...(open.golf ? { golf: open.golf } : {}), ...(open.lineup ? { lineup: open.lineup } : {}) };
    const w = when(open.at);
    return (
      <div className="screen ruled">
        <div className="nav-bar">
          <button className="nav-back" onClick={() => setOpen(null)}>Snapshots</button>
          <span className="nav-title"></span>
          <span></span>
        </div>
        <div className="nav-large">{w.day}</div>
        <Head label={SNAPSHOT_WHY[open.why]} action={{ label: "Restore", onClick: () => { onRestore(open.at); setOpen(null); } }} />
        {view.records.length > 0 ? <ReadOnlyRecords page={view} /> : <Foot>No Rows Then</Foot>}
        <Foot>Read Only; Restore Keeps Today&rsquo;s Page as a Snapshot First</Foot>
        <div className="screen-foot" />
      </div>
    );
  }
  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" onClick={onBack}>Page</button>
        <span className="nav-title"></span>
        <span></span>
      </div>
      <div className="nav-large">Snapshots</div>
      {list.length === 0 ? (
        <Foot>A Snapshot Is Kept at Every Import and Export, and When You Save One</Foot>
      ) : (
        <>
          <Head label="Newest First" count={list.length} />
          <Card>
            {list.map((s) => {
              const w = when(s.at);
              return (
                <Row key={s.at} label={SNAPSHOT_WHY[s.why]} onClick={() => setOpen(s)} chev
                  meta={<><span className="fact date">{w.day}</span><span className="fact date">{w.clock}</span><span className="fact">{s.records.length === 1 ? "1 Row" : `${s.records.length} Rows`}</span></>} />
              );
            })}
          </Card>
        </>
      )}
      <div className="screen-foot" />
    </div>
  );
}

/** A LINEUP FROM THE ROSTER, NOTHING RETYPED. Tap players in batting order; each takes its roster position, changeable
 *  on the lineup after. */
export function LineupBuilder({ team, teamTitle, onMake, onCancel }: {
  team: PageData;
  teamTitle: string;
  onMake: (picks: string[]) => void;
  onCancel: () => void;
}) {
  const [picks, setPicks] = useState<string[]>([]);
  const toggle = (id: string) => setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" onClick={onCancel}>Cancel</button>
        <span className="nav-title"></span>
        <span></span>
      </div>
      <div className="nav-large">New Lineup</div>
      <Foot>Tap Players in Batting Order</Foot>
      <Head label={teamTitle} count={team.records.length} action={picks.length < team.records.length ? { label: "Everyone", onClick: () => setPicks((p) => [...p, ...team.records.map((r) => r.id).filter((id) => !p.includes(id))]) } : undefined} />
      <Card>
        {team.records.map((r) => {
          const order = picks.indexOf(r.id) + 1;
          const num = (r.v.number ?? "").trim();
          const pos = (r.v.position ?? "").trim();
          return (
            <Row key={r.id} onClick={() => toggle(r.id)}
              lead={<div className="task-check-tap"><span className={"sel-box" + (order ? " on" : "")} role="checkbox" aria-checked={!!order} aria-label={(order ? "Take out " : "Add ") + (recordName(team, r) || "player")}>{order ? <Check className="ic" /> : null}</span></div>}
              label={<><U>{recordName(team, r) || "Unnamed Player"}</U></>}
              value={order ? <b>{order}</b> : undefined}
              meta={num || pos ? <>{num && <span className="fact"><b><U>#{num}</U></b></span>}{pos && <span className="fact"><U>{pos}</U></span>}</> : undefined} />
          );
        })}
      </Card>
      <div className="pad-x exp-acts">
        <button type="button" className="btn btn-primary btn-block" disabled={picks.length === 0} onClick={() => onMake(picks)}>
          {picks.length === 0 ? "Pick Players" : picks.length === 1 ? "Make Lineup of 1" : `Make Lineup of ${picks.length}`}
        </button>
      </div>
      <div className="screen-foot" />
    </div>
  );
}
