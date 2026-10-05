// ACCOUNTS (docs/jarvis-unified, slice 05; IMPLEMENTATION-SPEC.md 08 E21, 09
// M9). Each connected mailbox with its state and its last successful sync,
// what a disconnect keeps (every saved message and every approved record),
// and the one place connecting happens: Settings, Connections, where the
// sign-in has always lived (api/google.ts). Nothing here holds a token.

import PageHeader from "../shared/PageHeader";
import ListFloor from "../shared/ListFloor";
import { rowDoor } from "../shared/rowDoor";
import { ACCOUNTS_TITLE, ADD_GMAIL, DRAFTS_AND_SENT, EMAIL_TITLE, EMPTY_ACCOUNTS, NOT_SYNCED, RECONNECT, RETENTION_NOTE, STATE_WORD, messagesWord } from "./copy";
import EmailFacts from "./EmailFacts";
import { updatedFacts, type EmailFact } from "./format";
import type { EmailAccount } from "./emailClient";
import EmptyState from "./EmptyState";

export default function AccountsScreen({ accounts, onBack, onOpenConnections, onOpenDrafts }: {
  accounts: EmailAccount[];
  onBack: () => void;
  onOpenConnections: () => void;
  /** Drafts and what was sent from JARVIS (slice 07), reached from the mailbox picker as section 09 says. */
  onOpenDrafts?: () => void;
}) {
  const needsReauth = accounts.some((a) => a.state === "reauth");
  return (
    <div className="screen ruled">
      <PageHeader title={ACCOUNTS_TITLE} back={EMAIL_TITLE} onBack={onBack} />
      {accounts.length === 0 ? (
        <EmptyState copy={EMPTY_ACCOUNTS} onAction={onOpenConnections} />
      ) : (
        <div className="pad-x">
          {onOpenDrafts && (
            <div className="card list-card-ruled email-drafts-door">
              <div className="row" {...rowDoor(onOpenDrafts)}><div className="row-grow"><div className="conn-name">{DRAFTS_AND_SENT}</div></div><div className="chev"></div></div>
            </div>
          )}
          <div className="card list-card-ruled">
            {accounts.map((a) => {
              // 2026-10-05: ONE facts line per mailbox (it was four stacked grey lines). The state wears its key colour
              // (connected green, needs reconnecting amber), the sync time is the grey plus small caps, the saved count
              // is a white number with no state. A sync error is its own amber line, only when there is one.
              const line: EmailFact[] = [
                { text: STATE_WORD[a.state], ...(a.state === "connected" ? { tone: "good" as const } : a.state === "reauth" ? { tone: "warn" as const } : {}) },
                ...(a.state === "disconnected" ? [] : a.last_sync_at ? updatedFacts(a.last_sync_at) : [{ text: NOT_SYNCED }]),
                { text: `${messagesWord(a.cached)} Saved`, strong: true },
              ];
              return (
                <div className="row" key={a.id} {...rowDoor(onOpenConnections)}>
                  <div className="row-grow">
                    <div className="conn-name truncate">{a.address}</div>
                    <EmailFacts wrap facts={line} />
                    {a.sync_error && a.state !== "disconnected" && <EmailFacts wrap facts={[{ text: a.sync_error, tone: "warn" }]} />}
                  </div>
                </div>
              );
            })}
            <button className="row row-act" onClick={onOpenConnections}>{needsReauth ? RECONNECT : ADD_GMAIL}</button>
          </div>
          <div className="email-note quiet"><span>{RETENTION_NOTE}</span></div>
          <ListFloor />
        </div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
