// EMAIL ON TODAY, RESTRAINED (Email v1 spec section 7, V10; Dave 2026-10-12; issue 112, Dave 2026-10-13).
// Inside the Today page's own mail band, Email draws only what is Email's: the ONE combined paused-sends card,
// "2 Replies Need Your Review", only while a send stopped before it reached Gmail waits for a fresh review (never an
// ordinary draft, a held send, a sent message or an unknown outcome); then the open Waiting follow-ups that are due or
// overdue. At most five rows in all, nothing padded, nothing for tomorrow, each destination once.
//
// A task, an event or a bill that a capture made is NOT drawn here: Tasks, Schedule and Money show it on Today, once, as
// the ordinary task, event or bill it is (today/onceOnToday.ts). The band used to carry a second, email-flavoured copy of
// each; it has no task or schedule input any more, so it cannot. The generic proposal-review count is gone from Today
// too: it stays on the Email surface. A tap opens Email's recovery list or the Waiting record. Nothing here sends; there
// is no Send All.

import { useEffect, useState } from "react";
import { rowDoor } from "../shared/rowDoor";
import { Hourglass, Mail } from "../shared/icons";
import type { RpcClient } from "../substrate/commands/errors";
import type { WaitingService } from "../substrate/waiting/WaitingService";
import { emailTodayRows, pausedSends, type EmailFocus, type TodayEmailRow } from "../email/waiting";
import EmailFacts from "../email/EmailFacts";

export default function EmailToday({ client, waiting, today, refreshKey = 0, onOpenEmail, onEmptyChange }: {
  client: RpcClient | null;
  waiting: WaitingService | null;
  today: string;
  /** Bumped by the page whenever it reloads, so a Track This or a pause that landed since the band mounted is read. */
  refreshKey?: number;
  onOpenEmail: (focus?: EmailFocus) => void;
  onEmptyChange?: (empty: boolean) => void;
}) {
  const [rows, setRows] = useState<TodayEmailRow[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      // A database without migration 0068 has no paused_sends: the card is simply not drawn.
      const [paused, w] = await Promise.all([
        client ? pausedSends(client).then((r) => (r.ok ? { count: Number(r.value.count) || 0, replies: Number(r.value.replies) || 0 } : null)).catch(() => null) : Promise.resolve(null),
        waiting ? waiting.list().catch(() => []) : Promise.resolve([]),
      ]);
      if (!alive) return;
      setRows(emailTodayRows({ paused, waiting: w, today }));
    })();
    return () => { alive = false; };
  }, [client, waiting, today, refreshKey]);
  useEffect(() => { onEmptyChange?.(rows.length === 0); }, [rows.length, onEmptyChange]);

  if (rows.length === 0) return null;
  const open = (r: TodayEmailRow) => {
    if (r.kind === "paused") onOpenEmail({ kind: "paused" });
    else onOpenEmail({ kind: "waiting", id: r.id });
  };
  // A TYPE ICON CARRIES ITS TYPE'S COLOUR (Dave 2026-10-05: the envelope was flat black in light).
  // The tones are the ones the sheets already use for these types: Email teal, Waiting purple.
  const Icon = (k: TodayEmailRow["kind"]) => (k === "paused" ? Mail : Hourglass);
  const Tone = (k: TodayEmailRow["kind"]) => (k === "paused" ? "teal" : "purple");
  return (
    <div className="card list-card-ruled email-today-band" data-email-today={rows.length}>
      {rows.map((r) => {
        const I = Icon(r.kind);
        return (
          <div className="row" key={r.kind + ":" + r.id} {...rowDoor(() => open(r))} data-email-row={r.kind}>
            <I className={"email-today-ic cat-fg-" + Tone(r.kind)} />
            <div className="row-grow">
              <div className="conn-name truncate">{r.title}</div>
              <EmailFacts facts={r.facts} />
            </div>
            <div className="chev"></div>
          </div>
        );
      })}
    </div>
  );
}
