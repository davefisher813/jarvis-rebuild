// ONE WAITING RECORD (docs/jarvis-unified, slice 08; IMPLEMENTATION-SPEC.md
// 08 E12 to E14, 09 M4, 12, 13 "New incoming reply"). Who, since when, the
// follow-up date (a local reminder on the record, never a task or an event),
// the excerpt it was tracked from with the source's own state, the thread's
// newest message as New Reply with Review Reply (the person decides; nothing
// closes on its own), Resolve with an optional note, Reopen, and Draft
// Follow-Up, which opens the composer to a real address from the thread or
// asks which one, never a guess. Every write is one record and one receipt.

import { useEffect, useState } from "react";
import PageHeader from "../shared/PageHeader";
import RowActionSheet from "../shared/RowActionSheet";
import { rowDoor } from "../shared/rowDoor";
import { FieldRow, TextRow } from "../shared/FormSheet";
import { showToast } from "../shared/toast";
import { openExternal } from "../messages/openExternal";
import { lineFor, newRequestId, type CommandFailure, type RpcClient } from "../substrate/commands/errors";
import type { WaitingData, WaitingItem } from "../substrate/waiting/types";
import { monthDay } from "../money/bills";
import {
  ACCOUNT_LABEL, CLEAR_DATE, DRAFT_FOLLOW_UP, EMAIL_TITLE, FOLLOW_UP_DATE, FOR_LABEL, NEW_REPLY, NO_RECIPIENT, OPEN_GMAIL_EXACT, OPEN_GMAIL_GENERIC, PICK_RECIPIENT, REOPEN,
  RESOLUTION_NOTE, RESOLUTION_NOTE_LABEL, RESOLVE, RESOLVED_WORD, REVIEW_REPLY, SINCE, SOURCE_DELETED, SOURCE_DISCONNECTED, SOURCE_MESSAGE, TRACKED_FROM, WAITED, WAITING_ON, WAITING_TITLE,
} from "./copy";
import EmailFacts from "./EmailFacts";
import { whenFacts, whenWords } from "./format";
import { gmailLink } from "./emailClient";
import { followUpWord } from "./WaitingList";
import { ageWord, followUpRecipients, newReply, readEvidence, reopenWaiting, resolveWaiting, setFollowUp, threadMessages, type Evidence, type LatestInThread, type ThreadMessage } from "./waiting";

export interface FollowUpStart { to: string; message: ThreadMessage | null }

export default function WaitingDetail({ client, item, own, today, zone, offline, latest, onBack, onChanged, onOpenMessage, onDraftFollowUp }: {
  client: RpcClient;
  item: WaitingItem;
  own: readonly string[];
  today: string;
  zone: string;
  offline: boolean;
  latest: LatestInThread | undefined;
  onBack: () => void;
  /** The record changed on the server: its new data. */
  onChanged: (data: WaitingData) => void;
  onOpenMessage: (messageId: string) => void;
  /** Open the composer to this address, threaded under the message when there is one. */
  onDraftFollowUp: (start: FollowUpStart) => void;
}) {
  const d = item.data;
  const [thread, setThread] = useState<ThreadMessage[] | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [note, setNote] = useState("");
  const [noting, setNoting] = useState(false);
  const [date, setDate] = useState(d.followUpOn ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [picking, setPicking] = useState<string[] | null>(null);
  const requestIds = useState<Record<string, string>>({})[0];

  useEffect(() => {
    let alive = true;
    if (d.threadId) void threadMessages(client, d.threadId).then((r) => { if (alive && r.ok) setThread(r.value); });
    if (d.sourceEvidenceId) void readEvidence(client, d.sourceEvidenceId).then((r) => { if (alive && r.ok) setEvidence(r.value); });
    return () => { alive = false; };
  }, [client, d.threadId, d.sourceEvidenceId]);
  useEffect(() => { setDate(d.followUpOn ?? ""); }, [d.followUpOn]);

  const once = (key: string) => (requestIds[key] ??= newRequestId());
  const say = (f: CommandFailure | string | null) => setLine(f === null ? null : typeof f === "string" ? f : lineFor(f));

  const write = async (key: string, run: (requestId: string) => ReturnType<typeof resolveWaiting>) => {
    if (busy) return;
    if (offline) { say({ ok: false, code: "OFFLINE", data: {} }); return; }
    setBusy(key);
    say(null);
    const r = await run(once(key));
    setBusy(null);
    if (!r.ok) { say(r); return; }
    delete requestIds[key];
    onChanged(r.value.data);
    if (!r.value.replay && r.value.safe_message) showToast({ message: r.value.safe_message });
  };
  const resolve = () => write("resolve", (id) => resolveWaiting(client, item.id, note.trim() || null, id));
  const reopen = () => write("reopen", (id) => reopenWaiting(client, item.id, id));
  const saveDate = (v: string) => { setDate(v); if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) void write("date:" + v, (id) => setFollowUp(client, item.id, v, id)); };
  const clearDate = () => { setDate(""); void write("date:clear", (id) => setFollowUp(client, item.id, null, id)); };

  const reply = newReply(d, latest, own);
  const source = thread?.find((m) => evidence?.message_id ? m.id === evidence.message_id : true) ?? null;
  const link = gmailLink(d.account ?? "", d.threadId ?? null);
  const fu = followUpWord(d.followUpOn, today);
  const age = ageWord(d.startedAt, today, zone);

  const draftFollowUp = () => {
    const to = followUpRecipients(thread ?? [], own);
    const newest = thread?.[0] ?? null;
    if (to.length === 1) { onDraftFollowUp({ to: to[0]!, message: newest }); return; }
    if (to.length > 1) { setPicking(to); return; }
    showToast({ message: NO_RECIPIENT });
    onDraftFollowUp({ to: "", message: newest });
  };

  return (
    <div className="screen ruled email-waiting">
      <PageHeader title={WAITING_TITLE} back={EMAIL_TITLE} onBack={onBack} />
      <div className="pad-x"><div className="card email-waiting-card">
        {/* 2026-10-05: what the card states is a key/value table (small-caps label, the value in white), not three
            grey lines joined by middle dots. The badges are fills with caps, and the follow-up one wears its key
            colour: late red, due amber, later neutral. New Reply is the banner below, once, with its action. */}
        <div className="email-waiting-badges">
          <span className="email-badge">{d.status === "open" ? "Open" : RESOLVED_WORD}</span>
          {fu && d.status === "open" && <span className={"email-badge " + fu.tone}>{fu.word}</span>}
        </div>
        <div className="email-waiting-title">{d.title}</div>
        <dl className="email-review-facts">
          <dt>{WAITING_ON}</dt><dd>{d.counterpartyDisplay || "Someone"}</dd>
          {d.waitingFor && <><dt>{FOR_LABEL}</dt><dd>{d.waitingFor}</dd></>}
          <dt>{SINCE}</dt><dd>{monthDay(d.startedAt.slice(0, 10))}</dd>
          {d.status === "open" && age !== "Today" && <><dt>{WAITED}</dt><dd>{age}</dd></>}
          {d.account && <><dt>{ACCOUNT_LABEL}</dt><dd>{d.account}</dd></>}
          {d.status === "resolved" && d.resolvedAt && <><dt>{RESOLVED_WORD}</dt><dd>{whenWords(d.resolvedAt)}</dd></>}
          {d.status === "resolved" && d.resolutionNote && <><dt>{RESOLUTION_NOTE_LABEL}</dt><dd>{d.resolutionNote}</dd></>}
        </dl>
      </div></div>

      {reply && (
        <div className="email-note quiet">
          <EmailFacts wrap facts={[{ text: NEW_REPLY, tone: "warn" }, { text: reply.from_name || reply.from_address }, ...whenFacts(reply.internal_date)]} />
          <button className="quiet-action" onClick={() => onOpenMessage(reply.message_id)}>{REVIEW_REPLY}</button>
        </div>
      )}

      {d.status === "open" && (
        <div className="pad-x"><div className="card xs-group xs email-compose">
          <FieldRow label={FOLLOW_UP_DATE} value={date} onChange={saveDate} type="date" ariaLabel={FOLLOW_UP_DATE} />
          {d.followUpOn && <div className="email-card-acts"><button type="button" className="quiet-action" onClick={clearDate} disabled={busy !== null}>{CLEAR_DATE}</button></div>}
        </div></div>
      )}

      <div className="pad-x"><div className="card list-card-ruled">
        <div className="eyebrow email-eyebrow">{TRACKED_FROM}</div>
        {evidence && <div className="email-quote">{evidence.excerpt}</div>}
        {evidence?.availability === "deleted" && <div className="email-note quiet"><span>{SOURCE_DELETED}</span></div>}
        {evidence?.availability === "disconnected" && <div className="email-note quiet"><span>{SOURCE_DISCONNECTED}</span></div>}
        {source && !source.deleted && <div className="row" {...rowDoor(() => onOpenMessage(source.id))}><div className="row-grow"><div className="conn-name">{SOURCE_MESSAGE}</div></div><div className="chev"></div></div>}
        {d.threadId && d.account && <div className="row" {...rowDoor(() => openExternal(link.href))}><div className="row-grow"><div className="conn-name">{link.exact ? OPEN_GMAIL_EXACT : OPEN_GMAIL_GENERIC}</div></div><div className="chev"></div></div>}
      </div></div>

      {d.status === "open" && noting && (
        <div className="pad-x"><div className="card xs-group xs email-compose">
          <TextRow value={note} onChange={setNote} placeholder={RESOLUTION_NOTE_LABEL} ariaLabel={RESOLUTION_NOTE_LABEL} rows={2} />
        </div></div>
      )}
      {line && <div className="pad-x"><div className="input-error" role="alert">{line}</div></div>}
      <div className="email-sheet-acts email-compose-acts">
        <button className="btn btn-primary" onClick={() => void (d.status === "open" ? resolve() : reopen())} disabled={busy !== null || offline}>{d.status === "open" ? RESOLVE : REOPEN}</button>
        {d.status === "open" && !noting && <button className="quiet-action" onClick={() => setNoting(true)}>{RESOLUTION_NOTE}</button>}
        <button className="quiet-action" onClick={draftFollowUp} disabled={offline || thread === null && !!d.threadId}>{DRAFT_FOLLOW_UP}</button>
      </div>
      {picking && <RowActionSheet title={PICK_RECIPIENT} actions={picking.map((to) => ({ label: to, onPick: () => { setPicking(null); onDraftFollowUp({ to, message: thread?.[0] ?? null }); } }))} onCancel={() => setPicking(null)} />}
      <div className="screen-foot" />
    </div>
  );
}
