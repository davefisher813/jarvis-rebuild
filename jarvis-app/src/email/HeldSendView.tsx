// The held send's screen, with its clock and its questions to the server (Email v1 spec section 9). A component of its own
// because the hook must live under the screen that is showing, not inside EmailFlow's conditional returns.

import HeldSendScreen from "./HeldSendScreen";
import { useHeldSend } from "./useHeldSend";
import type { HoldStatus } from "./drafts";
import type { HeldSend } from "./sendHold";
import type { RpcClient } from "../substrate/commands/errors";

export default function HeldSendView({ client, actionId, held, receivedAt, offline, subject, from, recipients, onEnd, onBack }: {
  client: RpcClient;
  actionId: string;
  held: HeldSend;
  receivedAt: number;
  offline: boolean;
  subject: string;
  from: string;
  recipients: readonly string[];
  onEnd: (phase: "settled" | "returned", status: HoldStatus) => void;
  onBack: () => void;
}) {
  const state = useHeldSend({ client, actionId, held, receivedAt, offline, onEnd });
  return <HeldSendScreen held={state} subject={subject} from={from} recipients={recipients} onUndo={state.undo} onBack={onBack} />;
}
