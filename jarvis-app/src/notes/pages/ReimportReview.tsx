import { useMemo, useState, type ReactNode } from "react";
import { Head, Card, Row, Foot, Menu } from "../../settings/kit";
import { type PageData, labelOf, recordName } from "./pageModel";
import { type ColumnMap, type Changes, reconcile, applyReconcile, conflictKey, changeCount } from "./importMap";
import { U } from "./PageViews";
import { templateDef } from "./templateDefs";

// A FILE THAT COMES BACK (issue #115: stable-id round trip with a changes
// preview). Matched by the id column; what it would add, change and remove is
// shown before anything moves; edits made on the page since the export are
// kept without asking; only a value changed on both sides is a question.

export default function Reimport({ page, body, map, columns, reported, notes, onApply, onShowColumns }: {
  page: PageData; body: string[][]; map: ColumnMap[]; columns: ReactNode; reported: string[]; notes: string[];
  onApply: (next: PageData, summary: string) => void;
  onShowColumns?: () => void;
}) {
  const changes: Changes = useMemo(() => reconcile(page, body, map, notes), [page, body, map, notes]);
  const [choose, setChoose] = useState<Record<string, "local" | "incoming">>({});
  const n = changeCount(changes);
  const word = templateDef(page.kind)?.noun ?? (page.kind === "outreach" ? "Contact" : "Player");
  const words = templateDef(page.kind)?.plural ?? word + "s";
  const plural = (k: number, w: string) => (k === 1 ? `1 ${w}` : `${k} ${w}s`);
  return (
    <>
      {columns}
      {changes.conflicts.length > 0 && (
        <>
          <Head label="Changed on Both Sides" count={changes.conflicts.length} />
          <Card>
            {changes.conflicts.map((c) => (
              <Menu key={conflictKey(c)} label={c.name || "Unnamed"}
                meta={c.key === "@removed"
                  ? <span className="fact warn">Removed in the File, Edited Here</span>
                  : <span className="fact warn">{c.label}</span>}
                value={choose[conflictKey(c)] ?? "local"}
                options={c.key === "@removed"
                  ? [{ value: "local", label: "Keep It" }, { value: "incoming", label: "Remove It" }]
                  : [{ value: "local", label: "Keep " + (c.local || "Empty") }, { value: "incoming", label: "Take " + (c.incoming || "Empty") }]}
                onPick={(v) => setChoose((x) => ({ ...x, [conflictKey(c)]: v as "local" | "incoming" }))} ariaLabel={"Which " + (c.label || "value") + " for " + (c.name || "this row")} />
            ))}
          </Card>
        </>
      )}
      {changes.changed.length > 0 && (
        <>
          <Head label="Changed" count={changes.changed.length} />
          <Card>
            {changes.changed.map((c) => (
              <Row key={c.id} label={<U>{c.name || "Unnamed"}</U>}
                meta={<>{c.fields.slice(0, 2).map((f) => <span key={f.key} className="fact">{f.label} <b><U>{f.to || "Empty"}</U></b></span>)}</>} />
            ))}
          </Card>
        </>
      )}
      {changes.added.length > 0 && (
        <>
          <Head label="New" count={changes.added.length} />
          <Card>{changes.added.map((r) => <Row key={r.id} label={<U>{recordName(page, r) || "Unnamed"}</U>} meta={r.flags ? <span className="fact warn">Check {labelOf(page, Object.keys(r.flags)[0]!)}</span> : undefined} />)}</Card>
        </>
      )}
      {changes.removed.length > 0 && (
        <>
          <Head label="Removed in the File" count={changes.removed.length} />
          <Card>{changes.removed.map((r) => <Row key={r.id} label={<U>{r.name || "Unnamed"}</U>} />)}</Card>
        </>
      )}
      {changes.keptLocal.length > 0 && (
        <>
          <Head label="Your Edits, Kept" count={changes.keptLocal.length} />
          <Card>
            {changes.keptLocal.map((c) => (
              <Row key={c.id} label={<U>{c.name || "Unnamed"}</U>}
                meta={<>{c.fields.slice(0, 2).map((f) => <span key={f.key} className="fact">{f.label} <b><U>{f.to || "Empty"}</U></b></span>)}</>} />
            ))}
          </Card>
        </>
      )}
      {changes.newFields.length > 0 && <Foot>New Fields: {changes.newFields.map((f) => f.label).join(", ")}</Foot>}
      {changes.dupes.length > 0 && <Foot>Listed Twice in the File, First Used: {changes.dupes.join(", ")}</Foot>}
      {n === 0 && changes.keptLocal.length === 0 && <Foot>Nothing in the File Differs from This Page</Foot>}
      {reported.map((l) => <Foot key={l}>{l}</Foot>)}
      {onShowColumns && <Head label="Columns" action={{ label: "Show Columns", onClick: onShowColumns }} />}
      <div className="pad-x exp-acts">
        <button type="button" className="btn btn-primary btn-block"
          onClick={() => onApply(applyReconcile(page, changes, choose, Date.now()), n === 0 ? "No Changes" : `${plural(n, "Change")} Applied`)}>
          {n === 0 ? "Done" : `Apply ${plural(n, "Change")}`}
        </button>
      </div>
      {/* The count of records the file speaks for, so "no duplicates" is something he can check. */}
      <Foot>{(() => { const k = page.records.length - changes.removed.length + changes.added.length; return k === 1 ? `1 ${word}` : `${k} ${words}`; })()} After This</Foot>
    </>
  );
}
