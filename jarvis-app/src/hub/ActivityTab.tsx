// H3 ACTIVITY (IMPLEMENTATION-SPEC.md 07.4, 09). All, Actions, Reads,
// Drafts; dated receipts with their exact verb; the suggestions a changed
// dependency raised. The feed is the server's global scope: no provisional
// Email row ever reaches it, only the count and a door into Email.

import { useEffect, useState } from "react";
import { pressable } from "../shared/pressable";
import { Foot } from "../settings/kit";
import { activityFeed, statusLine, type FeedRow } from "../substrate/commands/receipts";
import { COMMAND_LINES } from "../substrate/commands/errors";
import { EMPTY_ACTIVITY, FILTERS, emailItemsLine, type ActivityFilter } from "./copy";
import { text, type HubOverview, type HubProposal, type RpcClient } from "./hubClient";
import { dayLabel, timeOf } from "./format";
import HubFacts from "./HubFacts";

// 2026-10-05 (catalog gate): a receipt row's line is the actor (its one
// grey), the time (a neutral time, small caps) and, when the assistant only
// REPORTED the action, "Not Verified" in amber (a caution the person needs).
// The suggestion row says what it touches and nothing else: "Review X" stated
// the action the row already is, "Suggestion" repeated its section head, and
// "Nothing Was Rewritten" was a baked-dot reassurance that the decision page
// already gives. The Email row's second line ("Inside Email · No Preview
// Here") explained the row; a row with nothing to say shows nothing.

const Chev = () => <div className="chev" />;
const READ_KINDS = new Set(["read_context", "export_context"]);
const DRAFT_KINDS = new Set(["draft"]);

export function rowMatches(r: FeedRow, f: ActivityFilter): boolean {
  if (f === "all") return true;
  if (f === "reads") return READ_KINDS.has(r.kind);
  if (f === "drafts") return DRAFT_KINDS.has(r.kind);
  return !READ_KINDS.has(r.kind) && !DRAFT_KINDS.has(r.kind);
}

export default function ActivityTab({ client, overview, refreshKey, filter, onFilter, onOpenReceipt, onOpenDecision, onOpenEmail, onOpenReview }: {
  client: RpcClient;
  overview: HubOverview;
  /** Changes when a command landed, so the feed reloads. */
  refreshKey: number;
  filter: ActivityFilter;
  onFilter: (f: ActivityFilter) => void;
  onOpenReceipt: (actionId: string) => void;
  onOpenDecision: (itemId: string) => void;
  onOpenEmail?: () => void;
  onOpenReview: () => void;
}) {
  const [rows, setRows] = useState<FeedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    const r = await activityFeed(client, "global", { limit: 100 });
    if (r.ok) { setRows(r.value.rows); setError(null); } else setError(COMMAND_LINES[r.code]);
  };
  useEffect(() => { void load();
  }, [client, refreshKey]);

  const suggestions: HubProposal[] = overview.proposals.filter((p) => p.type === "constraint_change");
  const shown = (rows ?? []).filter((r) => rowMatches(r, filter));
  const byDay: Array<{ day: string; rows: FeedRow[] }> = [];
  for (const r of shown) {
    const day = dayLabel(r.occurred_at);
    const last = byDay[byDay.length - 1];
    if (last && last.day === day) last.rows.push(r); else byDay.push({ day, rows: [r] });
  }
  const emailLine = emailItemsLine(overview.email_review_count);
  const empty = rows !== null && !error && shown.length === 0 && suggestions.length === 0;

  return (
    <>
      <div className="chip-row" role="tablist" aria-label="Activity filter">
        {FILTERS.map((f) => (
          <button key={f.key} role="tab" aria-selected={filter === f.key} className={"chip" + (filter === f.key ? " active" : "")} onClick={() => onFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      {suggestions.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">To Review</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {suggestions.map((s) => {
              const itemId = text(s, "decision_item_id");
              return (
                <div {...pressable(() => onOpenDecision(itemId))} className="row" key={s.id}>
                  <div className="row-grow">
                    <div className="conn-name">{`${text(s, "item_title") || "A Record"} ${text(s, "change") === "missing" ? "Was Removed" : "Changed"}`}</div>
                    <HubFacts facts={[text(s, "decision_title") && { text: `Affects ${text(s, "decision_title")}` }]} />
                  </div>
                  <Chev />
                </div>
              );
            })}
          </div></div>
        </>
      )}

      {rows === null && !error && <Foot>Loading…</Foot>}
      {error && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="row"><div className="conn-name">{error}</div></div>
          <button className="row row-act hub-quiet" onClick={() => void load()}>Retry</button>
        </div></div>
      )}

      {empty && (
        <div className="empty-state">
          <div className="empty-title">{EMPTY_ACTIVITY.title}</div>
          <div className="empty-sub">{EMPTY_ACTIVITY.sub}</div>
          <button className="btn btn-primary" onClick={onOpenReview}>{EMPTY_ACTIVITY.action}</button>
        </div>
      )}

      {byDay.map((g) => (
        <div key={g.day}>
          <div className="sh2 sh2-quiet"><span className="t">{g.day}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {g.rows.map((r) => (
              <div {...pressable(() => onOpenReceipt(r.action_id))} className="row" key={r.receipt_id}>
                <div className="row-grow">
                  <div className="conn-name">{r.exact_verb}</div>
                  <HubFacts facts={[{ text: r.actor_display }, { text: timeOf(r.occurred_at), tone: "date" }, r.assurance === "reported_external" && { text: "Not Verified", tone: "warn" }]} />
                </div>
                {r.state !== "confirmed" && <span className={"hub-cap" + (r.state === "failed" ? " hub-cap-error" : r.state === "outcome_unknown" ? " hub-cap-waiting" : "")}>{statusLine(r.state)}</span>}
                <Chev />
              </div>
            ))}
          </div></div>
        </div>
      ))}

      {emailLine && onOpenEmail && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div {...pressable(onOpenEmail)} className="row">
            <div className="row-grow"><div className="conn-name">{emailLine}</div></div>
            <Chev />
          </div>
        </div></div>
      )}
    </>
  );
}
