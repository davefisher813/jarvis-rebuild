// EMAIL ON TODAY, RESTRAINED (docs/jarvis-unified, slice 08;
// IMPLEMENTATION-SPEC.md 08 E15, 09 T1, 12). Inside the Today page's own
// mail band: one generic line, "N Email Items to Review", counted per card
// on the server and carrying no title and no amount; then committed
// email-origin records that are due, at most five rows in all, nothing
// padded, nothing for tomorrow, each destination once and never one Today
// already shows on its own. Bills stay with Money's own Today line. A tap
// opens Email narrowed to its cards, or the record's own module.

import { useEffect, useState } from "react";
import { rowDoor } from "../shared/rowDoor";
import { Calendar, CheckSquare, Hourglass, Mail } from "../shared/icons";
import type { RpcClient } from "../substrate/commands/errors";
import type { TasksService } from "../tasks/TasksService";
import type { ScheduleService } from "../schedule/ScheduleService";
import type { WaitingService } from "../substrate/waiting/WaitingService";
import { emailTodayRows, reviewCount, type EmailFocus, type TodayEmailRow } from "../email/waiting";

export default function EmailToday({ client, tasks, schedule, waiting, today, excludeIds = [], refreshKey = 0, onOpenEmail, onOpenEntity, onEmptyChange }: {
  client: RpcClient | null;
  tasks: TasksService | null;
  schedule: ScheduleService | null;
  waiting: WaitingService | null;
  today: string;
  /** Items Today already shows on its own (the dealt task): left to it. */
  excludeIds?: readonly string[];
  refreshKey?: number;
  onOpenEmail: (focus?: EmailFocus) => void;
  onOpenEntity: (kind: "task" | "event", id: string) => void;
  onEmptyChange?: (empty: boolean) => void;
}) {
  const [rows, setRows] = useState<TodayEmailRow[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [count, t, e, w] = await Promise.all([
        client ? reviewCount(client).then((r) => (r.ok ? r.value.count : 0)).catch(() => 0) : Promise.resolve(0),
        tasks ? tasks.listTasks().catch(() => []) : Promise.resolve([]),
        schedule ? schedule.eventsOn(today).catch(() => []) : Promise.resolve([]),
        waiting ? waiting.list().catch(() => []) : Promise.resolve([]),
      ]);
      if (!alive) return;
      setRows(emailTodayRows({ count, tasks: t, events: e, waiting: w, today, excludeIds: new Set(excludeIds) }));
    })();
    return () => { alive = false; };
    // excludeIds is a fresh array each render; its content is what matters.
  }, [client, tasks, schedule, waiting, today, refreshKey, excludeIds.join("|")]);
  useEffect(() => { onEmptyChange?.(rows.length === 0); }, [rows.length, onEmptyChange]);

  if (rows.length === 0) return null;
  const open = (r: TodayEmailRow) => {
    if (r.kind === "review") onOpenEmail({ kind: "candidates" });
    else if (r.kind === "waiting") onOpenEmail({ kind: "waiting", id: r.id });
    else onOpenEntity(r.kind, r.id);
  };
  const Icon = (k: TodayEmailRow["kind"]) => k === "review" ? Mail : k === "task" ? CheckSquare : k === "event" ? Calendar : Hourglass;
  return (
    <div className="card list-card-ruled email-today-band" data-email-today={rows.length}>
      {rows.map((r) => {
        const I = Icon(r.kind);
        return (
          <div className="row" key={r.kind + ":" + r.id} {...rowDoor(() => open(r))} data-email-row={r.kind}>
            <I className="email-today-ic" />
            <div className="row-grow">
              <div className="conn-name truncate">{r.title}</div>
              <div className="facts"><span className="fact">{r.line}</span></div>
            </div>
            <div className="chev"></div>
          </div>
        );
      })}
    </div>
  );
}
