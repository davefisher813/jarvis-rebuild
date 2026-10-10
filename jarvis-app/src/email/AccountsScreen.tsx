// ACCOUNTS (docs/jarvis-unified, slice 05; IMPLEMENTATION-SPEC.md 08 E21, 09
// M9). Each connected mailbox with its state and its last successful sync,
// what a disconnect keeps (every saved message and every approved record),
// and the one place connecting happens: Settings, Connections, where the
// sign-in has always lived (api/google.ts). Nothing here holds a token.

import { useState } from "react";
import PageHeader from "../shared/PageHeader";
import ListFloor from "../shared/ListFloor";
import { rowDoor } from "../shared/rowDoor";
import RowActionSheet from "../shared/RowActionSheet";
import RowMenuButton from "../shared/RowMenuButton";
import { ACCOUNTS_TITLE, ADD_GMAIL, DRAFTS_AND_SENT, EDIT_SIGNATURE, EMAIL_TITLE, EMPTY_ACCOUNTS, MAILBOXES, NOT_SYNCED, RECONNECT, RETENTION_NOTE, STATE_WORD, messagesWord } from "./copy";
import EmailFacts from "./EmailFacts";
import { updatedFacts, type EmailFact } from "./format";
import type { EmailAccount } from "./emailClient";
import type { ClientView } from "../connections/connectionStatus";
import type { RpcClient } from "../substrate/commands/errors";
import EmptyState from "./EmptyState";
import SignatureSheet from "./SignatureSheet";

export default function AccountsScreen({ accounts, views, client, userId, onBack, onOpenConnections, onOpenDrafts, onSignatureSaved }: {
  accounts: EmailAccount[];
  /** The proven status of each mailbox (Foundation Fix Spec 1), keyed by lowercase address. When there is one it speaks for the mailbox; the cache row's own state is only the answer until the first proof arrives. */
  views?: ReadonlyMap<string, ClientView>;
  /** The session's client, for the signature editor's one RPC. No client, no menu: a row with no working door to open is not offered one. */
  client?: RpcClient | null;
  userId?: string;
  onBack: () => void;
  onOpenConnections: () => void;
  /** Drafts and what was sent from JARVIS (slice 07), reached from the mailbox picker as section 09 says. */
  onOpenDrafts?: () => void;
  /** The saved signature changed (Email v1 spec L3), so the caller's own copy of this account can be updated without a full reload. */
  onSignatureSaved?: (accountId: string, text: string, revision: number) => void;
}) {
  const [menuFor, setMenuFor] = useState<EmailAccount | null>(null);
  const [editing, setEditing] = useState<EmailAccount | null>(null);
  const needsReauth = views && views.size > 0 ? [...views.values()].some((v) => v.offerReconnect) : accounts.some((a) => a.state === "reauth");
  return (
    <div className="screen ruled">
      <PageHeader title={ACCOUNTS_TITLE} back={EMAIL_TITLE} onBack={onBack} />
      {accounts.length === 0 ? (
        <EmptyState copy={EMPTY_ACCOUNTS} onAction={onOpenConnections} />
      ) : (
        <>
          {onOpenDrafts && (
            <div className="pad-x">
              <div className="card list-card-ruled email-drafts-door">
                <div className="row" {...rowDoor(onOpenDrafts)}><div className="row-grow"><div className="conn-name">{DRAFTS_AND_SENT}</div></div><div className="chev"></div></div>
              </div>
            </div>
          )}
          {/* 2026-10-05 (Dave, locked): the add is on the section head, never inside the card and never at the foot of the list.
              Reconnecting is the same door, so it is the same capsule with the other word. The head sits outside the padded
              column, as every section head does, so its title lines up with the card's edge. */}
          <div className="sh2 sh2-quiet">
            <span className="t">{MAILBOXES}</span><span className="n">{accounts.length}</span>
            <button className="see-all pill-action" onClick={onOpenConnections}>{needsReauth ? RECONNECT : ADD_GMAIL}</button>
          </div>
          <div className="pad-x">
            <div className="card list-card-ruled">
              {accounts.map((a) => {
                // 2026-10-05: ONE facts line per mailbox (it was four stacked grey lines). The state wears its key colour
                // (connected green, needs reconnecting amber), the sync time is the grey plus small caps, the saved count
                // is a white number with no state. A sync error is its own amber line, only when there is one.
                const proven = a.state === "disconnected" ? undefined : views?.get(a.address.toLowerCase());
                const line: EmailFact[] = [
                  proven
                    ? { text: proven.headline, ...(proven.state === "connected" ? { tone: "good" as const } : { tone: "warn" as const }) }
                    : { text: STATE_WORD[a.state], ...(a.state === "connected" ? { tone: "good" as const } : a.state === "reauth" ? { tone: "warn" as const } : {}) },
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
                    {/* 2026-10-10: a quiet trailing door, never the row's own tap target (that still opens
                        Connections). No client, no menu: a row with nothing that can work is not offered one. */}
                    {client && <RowMenuButton what={a.address} onMenu={() => setMenuFor(a)} />}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="email-note quiet"><span>{RETENTION_NOTE}</span></div>
          <div className="pad-x"><ListFloor /></div>
        </>
      )}
      <div className="screen-foot" />
      {menuFor && (
        <RowActionSheet title={menuFor.address} actions={[{ label: EDIT_SIGNATURE, onPick: () => setEditing(menuFor) }]} onCancel={() => setMenuFor(null)} />
      )}
      {editing && client && (
        <SignatureSheet client={client} userId={userId ?? ""} account={editing} onClose={() => { setEditing(null); setMenuFor(null); }}
          onSaved={(accountId, text, revision) => onSignatureSaved?.(accountId, text, revision)} />
      )}
    </div>
  );
}
