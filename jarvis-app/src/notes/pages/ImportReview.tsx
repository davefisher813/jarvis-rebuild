import { useMemo, useState, type ReactNode } from "react";
import { Head, Card, Row, Foot, Menu } from "../../settings/kit";
import { FormSheet, Group, FieldRow, Row as SheetRow, Note } from "../../shared/FormSheet";
import {
  type PageData, type PageRecord, labelOf, recordName,
} from "./pageModel";
import {
  type ColumnMap, T_ID, T_EXTRA, T_SKIP,
  proposeMapping, mappingIsExact, planImport, applyImport,
} from "./importMap";
import Reimport from "./ReimportReview";
import { U } from "./PageViews";
import { templateDef } from "./templateDefs";
import BackPill from "../../shared/BackPill";

// THE CONFIRM STEP (issue #115: confirm-first, uncertain values visibly
// uncertain, nothing silently dropped). One screen for a first import and for
// a file that comes back. The columns are proposed and can be changed; a value
// the import is unsure of is listed in amber and fixed or kept in place; a
// column left out is named, and stays in the original. A reimport shows what
// it would add, change and remove, keeps edits made on the page since the
// export without asking, and asks only where both sides changed the same value.

const MAX_PREVIEW = 40;

export default function ImportReview({ page, sourceName, rows, notes, mode, onApply, onCancel }: {
  page: PageData;
  sourceName: string;
  /** The file's table, header first. */
  rows: string[][];
  notes: string[];
  mode: "import" | "reimport";
  onApply: (next: PageData, summary: string) => void;
  onCancel: () => void;
}) {
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const [map, setMap] = useState<ColumnMap[]>(() => proposeMapping(page, header));
  const exact = mode === "reimport" && mappingIsExact(page, map);
  const [showCols, setShowCols] = useState(!exact);
  const setTarget = (col: number, target: string) => setMap((m) => m.map((x) => {
    if (x.col === col) return { ...x, target, sure: true };
    // One column per field (a name split in two is the one exception, and it is proposed, not picked).
    if (target !== T_EXTRA && target !== T_SKIP && x.target === target) return { ...x, target: T_EXTRA };
    return x;
  }));
  const options = [
    ...page.fields.filter((f) => !/^h\d+$/.test(f.key) && f.key !== "player" && !f.extra).map((f) => ({ value: f.key, label: f.label })),
    { value: T_EXTRA, label: "Keep as Extra Field" },
    { value: T_ID, label: "Row ID" },
    { value: T_SKIP, label: "Leave Out" },
  ];
  const sample = (col: number) => body.map((r) => (r[col] ?? "").trim()).find(Boolean) ?? "";

  const columns = showCols && (
    <>
      <Head label="Columns" count={header.length} />
      <Card>
        {map.map((m) => (
          <Menu key={m.col} label={m.header || `Column ${m.col + 1}`} meta={sample(m.col) ? <U>{sample(m.col)}</U> : undefined}
            value={m.target} options={options} onPick={(v) => setTarget(m.col, v)} ariaLabel={"Bring in " + (m.header || "column") + " as"} />
        ))}
      </Card>
    </>
  );
  const leftOut = map.filter((m) => m.target === T_SKIP && m.header.trim()).map((m) => m.header.trim());
  const reported = [...notes, ...(leftOut.length ? [`Left Out: ${leftOut.join(", ")}; Still in the Original File`] : [])];

  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <BackPill label="Cancel" onClick={onCancel} />
        <span className="nav-title"></span>
        <span></span>
      </div>
      <div className="nav-large">{mode === "import" ? "Bring In Rows" : "Review Changes"}</div>
      <Foot><U>{sourceName}</U></Foot>
      {mode === "import"
        ? <FirstImport page={page} body={body} map={map} columns={columns} reported={reported} notes={notes} onApply={onApply} />
        : <Reimport page={page} body={body} map={map} columns={columns} reported={reported} notes={notes} onApply={onApply}
            onShowColumns={exact && !showCols ? () => setShowCols(true) : undefined} />}
      <div className="screen-foot" />
    </div>
  );
}

function FirstImport({ page, body, map, columns, reported, notes, onApply }: {
  page: PageData; body: string[][]; map: ColumnMap[]; columns: ReactNode; reported: string[]; notes: string[];
  onApply: (next: PageData, summary: string) => void;
}) {
  // Rebuilt only when the columns change, so ids stay put while values are corrected.
  const plan = useMemo(() => planImport(page, body, map, notes), [page, body, map, notes]);
  // A correction per record and field: a typed value, or null for "keep as it is".
  const [fixes, setFixes] = useState<Record<string, Record<string, string | null>>>({});
  const [fixing, setFixing] = useState<{ index: number; key: string } | null>(null);
  const records: PageRecord[] = plan.records.map((r, i) => {
    const f = fixes[i];
    if (!f) return r;
    const v = { ...r.v };
    const flags = { ...(r.flags ?? {}) };
    for (const [k, x] of Object.entries(f)) { if (x !== null) v[k] = x; delete flags[k]; }
    const out: PageRecord = { ...r, v };
    if (Object.keys(flags).length) out.flags = flags; else delete out.flags;
    return out;
  });
  const unsure = records.flatMap((r, index) => Object.entries(r.flags ?? {}).map(([key, why]) => ({ index, key, why, r })));
  const word = templateDef(page.kind)?.noun ?? (page.kind === "outreach" ? "Contact" : "Player");
  const words = templateDef(page.kind)?.plural ?? word + "s";
  const n = records.length;
  const current = fixing ? records[fixing.index] : null;
  return (
    <>
      {columns}
      {unsure.length > 0 && (
        <>
          <Head label="Check These" count={unsure.length} />
          <Card>
            {unsure.map((u) => (
              <Row key={u.index + u.key} label={<U>{recordName(page, u.r) || `Row ${u.index + 2}`}</U>} onClick={() => setFixing({ index: u.index, key: u.key })} chev
                meta={<><span className="fact warn">{u.why}</span>{(u.r.v[u.key] ?? "") && <span className="fact"><U>{u.r.v[u.key]}</U></span>}</>} />
            ))}
          </Card>
        </>
      )}
      <Head label={n === 1 ? `1 ${word}` : `${n} ${words}`} />
      {n > 0 && (
        <Card>
          {records.slice(0, MAX_PREVIEW).map((r, i) => {
            const num = (r.v.number ?? "").trim();
            const pos = (r.v.position ?? "").trim();
            return <Row key={i} label={<U>{recordName(page, r) || `Row ${i + 2}`}</U>}
              meta={num || pos ? <>{num && <span className="fact"><b><U>#{num}</U></b></span>}{pos && <span className="fact"><U>{pos}</U></span>}</> : undefined} />;
          })}
        </Card>
      )}
      {n > MAX_PREVIEW && <Foot>{n - MAX_PREVIEW} More Not Shown Here; All of Them Come In</Foot>}
      {plan.newFields.length > 0 && <Foot>New Fields: {plan.newFields.map((f) => f.label).join(", ")}</Foot>}
      {reported.map((l) => <Foot key={l}>{l}</Foot>)}
      <div className="pad-x exp-acts">
        <button type="button" className="btn btn-primary btn-block" disabled={n === 0}
          onClick={() => onApply(applyImport(page, { ...plan, records }, Date.now()), n === 1 ? `1 ${word} Brought In` : `${n} ${words} Brought In`)}>
          {n === 0 ? "Nothing to Bring In" : n === 1 ? `Bring In 1 ${word}` : `Bring In ${n} ${words}`}
        </button>
      </div>
      {fixing && current && (
        <FixSheet label={labelOf({ ...page, fields: [...page.fields, ...plan.newFields] }, fixing.key)} why={plan.records[fixing.index]?.flags?.[fixing.key] ?? ""}
          value={current.v[fixing.key] ?? ""}
          onSave={(v) => { setFixes((f) => ({ ...f, [fixing.index]: { ...(f[fixing.index] ?? {}), [fixing.key]: v } })); setFixing(null); }}
          onKeep={() => { setFixes((f) => ({ ...f, [fixing.index]: { ...(f[fixing.index] ?? {}), [fixing.key]: null } })); setFixing(null); }}
          onCancel={() => setFixing(null)} />
      )}
    </>
  );
}

function FixSheet({ label, why, value, onSave, onKeep, onCancel }: { label: string; why: string; value: string; onSave: (v: string) => void; onKeep: () => void; onCancel: () => void }) {
  const [v, setV] = useState(value);
  return (
    <FormSheet title={"Fix " + label} onCancel={onCancel} onSave={() => onSave(v)}>
      <Group label={why}>
        <FieldRow label={label} ariaLabel={label} value={v} onChange={setV} onEnter={() => onSave(v)} />
      </Group>
      <Group>
        <SheetRow label="Keep It as It Is" onClick={onKeep} />
      </Group>
      <Note>Nothing Is Brought In Until You Tap Bring In</Note>
    </FormSheet>
  );
}
