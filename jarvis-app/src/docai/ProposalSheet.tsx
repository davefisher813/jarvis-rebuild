import { useMemo, useState } from "react";
import { FormSheet, Group, Row, FieldRow, ErrorLine } from "../shared/FormSheet";
import { FileText, Tag, Quote } from "../shared/icons";
import { titleCase } from "../shared/casing";
import { passageFor } from "./passage";
import {
  approveAllSolid, decide, editField, readyToFile, resolveConflict, solidPending, uncertainPending,
  type DocProposal, type ProposalField,
} from "./proposal";
import type { DocText } from "./types";

// THE PROPOSAL SHEET (build order, Phase 1). What JARVIS took from a document, held for Dave. Nothing on it is filed until File It, and File It
// only writes what he kept. Solid fields can be approved together; an uncertain one is never in that batch, says so in words, and shows the
// sentence it came from. A conflict shows both values and keeps neither until he picks. Dismiss keeps the document and ends the suggestion.

const pagesLabel = (pages: number[]): string => (pages.length === 1 ? `Page ${pages[0]}` : pages.length <= 4 ? `Pages ${pages.join(", ")}` : `${pages.length} Pages`);

/** A reason is written as a sentence in the checks; on a row it reads as a Title Case line with no full stop. */
export const reasonLine = (r: string): string => titleCase(r.replace(/\.$/, ""));

const tagFor = (f: ProposalField) => {
  if (f.decision === "keep") return <span className="fact good">{f.byUser ? "Your Edit" : "Kept"}</span>;
  if (f.decision === "drop") return <span className="fact">Left Out</span>;
  if (f.tier === "uncertain") return <span className="fact warn">Uncertain</span>;
  return null;
};

export default function ProposalSheet({ initial, text, onFile, onDismiss, onClose }: {
  initial: DocProposal;
  /** What was read from the document, for the passage under each field. Null when it cannot be loaded. */
  text: DocText | null;
  onFile: (p: DocProposal) => Promise<{ ok: true } | { ok: false; reason: string }>;
  onDismiss: (p: DocProposal) => Promise<boolean>;
  onClose: () => void;
}) {
  const [p, setP] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const solid = solidPending(p);
  const uncertain = uncertainPending(p);
  const openField = open ? p.groups.flatMap((g) => g.fields).find((f) => f.id === open) ?? null : null;

  const file = () => {
    if (busy || !readyToFile(p)) return;
    setBusy(true);
    setError(null);
    void onFile(p).then((r) => { if (!r.ok) { setError(r.reason); setBusy(false); } }, () => { setError("That Didn't File"); setBusy(false); });
  };
  const dismiss = () => {
    if (busy) return;
    setBusy(true);
    void onDismiss(p).then((ok) => { if (!ok) setBusy(false); }, () => setBusy(false));
  };

  return (
    <>
      <FormSheet title="Review" onCancel={onClose} onSave={file} saveDisabled={!readyToFile(p) || busy} saveLabel={busy ? "Filing" : "File It"}>
        <Group label={p.kindWords}>
          <Row tone="indigo" glyph={<FileText className="ic" />} label="Goes To" meta={<span className="fact">{p.destinationWords}</span>} />
          {p.missingPages.length > 0 && (
            <Row tone="orange" glyph={<Tag className="ic" />} label="Pages Not Read" meta={<span className="fact warn">{pagesLabel(p.missingPages)}</span>} />
          )}
        </Group>

        {solid > 0 && (
          <Group className="xs-actions">
            {/* The count on the button is the batch, so it is never a surprise; the uncertain ones are named as staying behind. */}
            <Row label="Approve All" meta={<><span className="fact">{solid} Checked Against the Document</span>{uncertain > 0 && <span className="fact warn">{uncertain} Uncertain Stay for You</span>}</>}
              onClick={() => setP(approveAllSolid(p))} />
          </Group>
        )}

        {p.conflicts.map((c) => (
          <Group key={c.id} label={`${c.label} Needs Your Choice`}>
            {c.candidates.map((k, i) => (
              <Row key={i} label={k.value}
                meta={<>{k.page ? <span className="fact">{`Page ${k.page}`}</span> : null}{c.chosen === i && <span className="fact good">Chosen</span>}</>}
                onClick={() => setP(resolveConflict(p, c.id, i))} />
            ))}
            <Row label="Leave It Out" meta={c.dropped ? <span className="fact good">Left Out</span> : undefined} onClick={() => setP(resolveConflict(p, c.id, "drop"))} />
          </Group>
        ))}

        {p.groups.filter((g) => g.fields.length > 0).map((g) => (
          <Group key={g.id} label={g.label}>
            {g.fields.map((f) => (
              <Row key={f.id} label={f.value} meta={<><span className="fact">{f.label}</span>{tagFor(f)}</>} chev onClick={() => setOpen(f.id)} />
            ))}
          </Group>
        ))}

        <ErrorLine text={error} />
        <Group className="xs-actions">
          <Row label="Dismiss" meta={<span className="fact">Won't Suggest This Again</span>} onClick={dismiss} />
        </Group>
      </FormSheet>

      {openField && (
        <FieldSheet field={openField} text={text}
          onKeep={(value) => { setP(decide(value !== openField.value ? editField(p, openField.id, value) : p, openField.id, "keep")); setOpen(null); }}
          onLeaveOut={() => { setP(decide(p, openField.id, "drop")); setOpen(null); }}
          onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function FieldSheet({ field, text, onKeep, onLeaveOut, onClose }: {
  field: ProposalField; text: DocText | null; onKeep: (value: string) => void; onLeaveOut: () => void; onClose: () => void;
}) {
  const [value, setValue] = useState(field.value);
  const passage = useMemo(() => (text ? passageFor(text, field.quote, field.offsets) : null), [text, field]);
  const where = passage?.located ? (passage.page ? `From Page ${passage.page}` : "From the Document") : "What the Document Said";
  return (
    <FormSheet title={field.label} onCancel={onClose} onSave={() => onKeep(value)} saveDisabled={!value.trim()} saveLabel="Keep">
      <Group>
        <FieldRow tone="red" glyph={<Tag className="ic" />} label={field.label} ariaLabel={field.label} value={value} onChange={setValue} />
      </Group>
      {field.tier === "uncertain" && field.reasons.length > 0 && (
        <Group label="Why It's Uncertain">
          {field.reasons.map((r, i) => <Row key={i} tone="orange" glyph={<Quote className="ic" />} label={reasonLine(r)} />)}
        </Group>
      )}
      <Group label={where}>
        <div className="doc-passage" tabIndex={0}>
          {passage?.cutBefore && <span className="doc-cut">…</span>}
          {passage?.before}
          <mark className="doc-mark">{passage ? passage.mark : field.quote}</mark>
          {passage?.after}
          {passage?.cutAfter && <span className="doc-cut">…</span>}
        </div>
      </Group>
      <Group className="xs-actions"><Row label="Leave It Out" onClick={onLeaveOut} /></Group>
    </FormSheet>
  );
}
