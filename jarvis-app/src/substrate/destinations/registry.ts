import { CAPTURE_KINDS, type CaptureKind, type CapturePayload } from "../contracts";
import { billAdapter, receiptAdapter } from "./money";
import { taskAdapter } from "./tasks";
import { eventAdapter } from "./schedule";
import { waitingAdapter } from "./waiting";
import { DESTINATION_OF, MODULE_OF, type DestinationAdapter } from "./types";

// THE REGISTRY, AND WHETHER EACH DOOR IS OPEN.
//
// Readiness is asked before a Save is offered and answers "unavailable" for
// anything it cannot prove: the migration not applied (the readiness function
// does not exist yet), the registry not reachable, a kind not registered. It
// never answers ready on a guess, so a card can say "Money Isn't Ready · Your
// Bill Is Still Here" instead of a dead button.

type AdapterOf<K extends CaptureKind> = DestinationAdapter<Extract<CapturePayload, { kind: K }>>;

export const ADAPTERS: { [K in CaptureKind]: AdapterOf<K> } = {
  bill: billAdapter,
  receipt: receiptAdapter,
  task: taskAdapter,
  event: eventAdapter,
  waiting: waitingAdapter,
};

export function adapterFor<K extends CaptureKind>(kind: K): AdapterOf<K> {
  return ADAPTERS[kind];
}

export type ReadinessState = { state: "ready" } | { state: "unavailable"; reason: string };

export interface Readiness {
  /** applied: the readiness function answered. missing: it does not exist (0044 not run). unknown: could not ask. */
  migration: "applied" | "missing" | "unknown";
  kinds: Record<CaptureKind, ReadinessState>;
}

const NOUN: Record<CaptureKind, string> = { bill: "Bill", receipt: "Receipt", task: "Task", event: "Event", waiting: "Request" };

export function notReadyLine(kind: CaptureKind): string {
  return `${MODULE_OF[kind]} Isn't Ready · Your ${NOUN[kind]} Is Still Here`;
}

/** What the registry says, as the app reads it. null means the question could not be answered. */
export function readinessFrom(registered: ReadonlySet<string> | null, migration: Readiness["migration"] = registered ? "applied" : "unknown"): Readiness {
  const kinds = {} as Record<CaptureKind, ReadinessState>;
  for (const kind of CAPTURE_KINDS) {
    const adapter = ADAPTERS[kind];
    const open = migration === "applied" && !!registered && registered.has(DESTINATION_OF[kind]) && adapter.destinationKind === DESTINATION_OF[kind];
    kinds[kind] = open ? { state: "ready" } : { state: "unavailable", reason: notReadyLine(kind) };
  }
  return { migration, kinds };
}

export const READINESS_RPC = "substrate_readiness";

/** PostgREST's answer when the function does not exist in the database yet. */
function isMissingFunction(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const o = e as { code?: unknown; message?: unknown };
  if (o.code === "PGRST202" || o.code === "42883") return true;
  return typeof o.message === "string" && /could not find the function|does not exist/i.test(o.message);
}

export type Rpc = (fn: string) => PromiseLike<{ data: unknown; error: unknown }>;

/** Ask the database. A missing function reads as the migration not applied; any other failure as unknown. */
export async function fetchReadiness(rpc: Rpc): Promise<Readiness> {
  try {
    const { data, error } = await rpc(READINESS_RPC);
    if (error) return readinessFrom(null, isMissingFunction(error) ? "missing" : "unknown");
    const registered = (data as { registered?: unknown } | null)?.registered;
    if (!Array.isArray(registered)) return readinessFrom(null, "unknown");
    return readinessFrom(new Set(registered.filter((k): k is string => typeof k === "string")), "applied");
  } catch {
    return readinessFrom(null, "unknown");
  }
}
