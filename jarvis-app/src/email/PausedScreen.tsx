// THE PAUSED SENDS (Email v1 spec section 7, V10; Dave 2026-10-12). Today's one combined card ("2 Replies Need Your
// Review") opens this: every send that stopped before it reached Gmail (a failed preflight, a dispatch window that
// closed, a mailbox that needed reconnecting), read from the server (paused_sends, migration 0068). Each row opens
// that draft exactly as it stands; from there it is reviewed and approved on its own, with its own 30-second hold.
// There is no Send All here, and nothing on this screen sends.
import PageHeader from "../shared/PageHeader";
import SkeletonRows from "../shared/SkeletonRows";
import ListFloor from "../shared/ListFloor";
import { rowDoor } from "../shared/rowDoor";
import { lineFor, type CommandFailure } from "../substrate/commands/errors";
import EmptyState from "./EmptyState";
import EmailFacts from "./EmailFacts";
import { EMAIL_TITLE, EMPTY_PAUSED, NO_SUBJECT, PAUSED_DEFAULT, PAUSED_REASON, PAUSED_TITLE, RETRY } from "./copy";
import { whenFacts } from "./format";
import type { PausedSends } from "./waiting";
import type { DraftRow } from "./drafts";

export default function PausedScreen({ paused, failure, onBack, onRetry, onOpen }: {
  paused: PausedSends | null;
  failure: CommandFailure | null;
  onBack: () => void;
  onRetry: () => void;
  onOpen: (d: DraftRow) => void;
}) {
  const drafts = paused?.drafts ?? [];
  return (
    <div className="screen ruled">
      <PageHeader title={PAUSED_TITLE} back={EMAIL_TITLE} onBack={onBack} />
      {!paused && !failure && <SkeletonRows rows={2} />}
      {failure && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="row"><div className="row-grow"><div className="conn-name">{lineFor(failure)}</div></div></div>
          <button className="row row-act" onClick={onRetry}>{RETRY}</button>
        </div></div>
      )}
      {paused && drafts.length === 0 && <EmptyState copy={EMPTY_PAUSED} onAction={onBack} />}
      {drafts.length > 0 && (
        <div className="pad-x">
          <div className="card list-card-ruled">
            {drafts.map((d) => (
              // One fact line: why it stopped (amber, it needs you), when, and to whom (the one grey, last).
              <div className="row" key={d.id} data-paused={d.id} {...rowDoor(() => onOpen(d))}>
                <div className="row-grow">
                  <div className="conn-name truncate">{d.subject.trim() || NO_SUBJECT}</div>
                  <EmailFacts wrap facts={[{ text: PAUSED_REASON[d.paused_reason] ?? PAUSED_DEFAULT, tone: "warn" }, ...whenFacts(d.updated_at), ...(d.to_addresses.length ? [{ text: d.to_addresses.length === 1 ? d.to_addresses[0]! : `${d.to_addresses[0]} and ${d.to_addresses.length - 1} More` }] : [])]} />
                </div>
                <div className="chev"></div>
              </div>
            ))}
          </div>
          <ListFloor />
        </div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
