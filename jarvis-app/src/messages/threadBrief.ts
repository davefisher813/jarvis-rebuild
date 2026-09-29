import type { AIMessage } from "../ai/AIService";
import {
  BRIEF_SYSTEM, briefFor, briefPrompt, isCurrentBrief, loadBriefs, parseBrief, saveBrief,
  type Brief, type BriefContext,
} from "./brief";
import {
  cyrb53, planChunks, renderChunk, revisionOf, shownMessages, sourceMessages,
  type Chunk, type SourceInput, type SourceMessage,
} from "./briefSource";
import { singleFlight } from "./inboxRefresh";
import { BRIEF_SCHEMA_VERSION, type MeetingCandidate, type PromptLink, type ReplyRequirement } from "./mailContracts";
import { mailMessageKey, type MailScope } from "./mailIdentity";
import { deviceZone, isValidZone, wallInZone, weekdayOfIso } from "./zoneTime";

// ONE READING PER THREAD REVISION (2026-09-29).
//
// Opening a thread, tapping Reply and the Today notification pass all want the
// same thing: what this conversation says, in the one AI call the brief
// already makes. Before this each caller built its own prompt from its own
// slice of the thread, and "the same thread" could be read twice in a second.
//
// ensureThreadBrief is the one door. Its answer is cached by ACCOUNT + CONTENT
// REVISION (the latest message id) + SCHEMA VERSION, and a second caller that
// arrives while the first is still reading is handed the first's promise:
// openThread and startReply on the same thread cost one call between them, and
// startReply after openThread costs none.
//
// Laws:
//   - A CACHE HIT COSTS NOTHING, and a v3 entry is not a hit for a v4 question:
//     it still DISPLAYS (briefFor reads it as a fallback) but the thread is read
//     again, once, on the open that finds it, and the v4 entry replaces it.
//   - LONG THREADS ARE CHUNKED, NEVER SILENTLY CUT. The read is bounded (at most
//     MAX_CHUNKS calls, newest text first) and anything unread that matters to
//     the reply checklist sets completeSource false. Partial is never complete.
//   - A CHUNK THAT FAILED IS NOT A CHUNK THAT WAS SKIPPED. A failed older chunk
//     returns what was read, marked incomplete, and is NOT cached, so the next
//     open retries only that chunk (the ones that landed are cached too).
//   - NOTHING HERE WRITES ANYWHERE. It reads a thread and returns a shape.

export type ThreadBriefAI = {
  available: boolean;
  complete: (messages: AIMessage[], system?: string) => Promise<string>;
};

export interface ThreadBriefArgs {
  ai: ThreadBriefAI;
  scope: MailScope;
  threadId: string;
  subject?: string;
  messages: readonly SourceInput[];
  /** Every address the reader sends from, so "you" is decided by code. */
  selfEmails: readonly string[];
  /** The zone the timestamps are read in. Defaults to the device's. */
  zone?: string;
  /** Supplied by the notification pass. Undefined means notifications are not asked about. */
  links?: readonly PromptLink[];
}

export interface ThreadBriefResult {
  brief: Brief | null;
  /** cache: no call. model: read just now. none: nothing to read with (no AI, no messages, or the read failed). */
  source: "cache" | "model" | "none";
  /** Model calls this invocation made. Zero for a cache hit and for a caller that joined another's read. */
  calls: number;
  /** The content revision the answer belongs to. A late answer for another revision is ignored by the caller. */
  revision: string;
  error?: unknown;
}

const CHUNK_KEY = "jarvis.mail.briefchunk.v4";
const CHUNK_CAP = 30;

interface ChunkEntry { brief: Brief }
type ChunkMap = Record<string, ChunkEntry>;

function readChunks(): ChunkMap {
  try {
    const raw = JSON.parse(localStorage.getItem(CHUNK_KEY) || "{}") as unknown;
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as ChunkMap) : {};
  } catch { return {}; }
}
function writeChunk(key: string, brief: Brief): void {
  const all = readChunks();
  delete all[key];
  all[key] = { brief };
  const keys = Object.keys(all).slice(-CHUNK_CAP);
  const out: ChunkMap = {};
  for (const k of keys) out[k] = all[k]!;
  try { localStorage.setItem(CHUNK_KEY, JSON.stringify(out)); } catch { /* private mode */ }
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Mon 2026-09-21 14:05 America/New_York": the header line's time, in the zone the message is read in. */
function stamp(ms: number, zone: string): string {
  const w = wallInZone(ms, zone);
  return `${DAY[weekdayOfIso(w.date)]} ${w.date} ${w.time} ${zone}`;
}

function chunkKey(scope: MailScope, threadId: string, chunk: Chunk, links: readonly PromptLink[] | undefined): string {
  const body = chunk.segments.map((s) => s.msg.id + ":" + s.part + ":" + s.msg.role + ":" + s.text).join("␞");
  const l = links === undefined ? "-" : links.map((x) => x.id + x.host + x.text).join("|");
  return mailMessageKey(scope, threadId) + ":c:" + BRIEF_SCHEMA_VERSION + ":" + cyrb53(body).toString(36) + cyrb53(l, 3).toString(36);
}

function mergeById<T extends { id: string }>(lists: (readonly T[] | undefined)[]): T[] | undefined {
  if (lists.every((l) => l === undefined)) return undefined;
  const seen = new Set<string>();
  const out: T[] = [];
  for (const l of lists) for (const item of l ?? []) if (!seen.has(item.id)) { seen.add(item.id); out.push(item); }
  return out;
}

async function readChunk(
  args: ThreadBriefArgs, zone: string, revision: string, chunk: Chunk, plan: { completeSource: boolean },
  counter: { calls: number },
): Promise<Brief | null> {
  const key = chunkKey(args.scope, args.threadId, chunk, args.links);
  const hit = readChunks()[key];
  if (hit && hit.brief && hit.brief.schema === BRIEF_SCHEMA_VERSION) return hit.brief;
  const shown: SourceMessage[] = shownMessages(chunk);
  const ctx: BriefContext = {
    account: args.scope.account,
    threadId: args.threadId,
    ...(args.subject ? { subject: args.subject } : {}),
    messages: shown,
    zone,
    sourceRevision: revision,
    completeSource: plan.completeSource,
    ...(args.links !== undefined ? { links: args.links } : {}),
  };
  const convo = renderChunk(chunk, zone, stamp);
  counter.calls++;
  const raw = await args.ai.complete(
    [{ role: "user", content: briefPrompt(convo, "", args.links, { zone, v4: true }) }],
    BRIEF_SYSTEM,
  );
  const brief = parseBrief(raw, ctx);
  if (brief) writeChunk(key, brief);
  return brief;
}

async function readThread(args: ThreadBriefArgs, zone: string, revision: string): Promise<ThreadBriefResult> {
  const src = sourceMessages(args.messages, args.selfEmails);
  const plan = planChunks(src);
  if (plan.chunks.length === 0) return { brief: null, source: "none", calls: 0, revision };
  const counter = { calls: 0 };
  const briefs: Brief[] = [];
  let failed = false;
  let firstError: unknown;
  for (const chunk of plan.chunks) {
    let b: Brief | null = null;
    try {
      b = await readChunk(args, zone, revision, chunk, plan, counter);
    } catch (e) {
      // The newest chunk carries the summary, the chips and the state card.
      // Without it there is nothing to show, and a budget or sign-in refusal
      // applies to the rest as well.
      if (chunk.index === 0) return { brief: null, source: "none", calls: counter.calls, revision, error: e };
      failed = true;
      firstError ??= e;
      break;
    }
    // An answer that was not JSON is a failed read, not an empty one.
    if (!b) {
      if (chunk.index === 0) return { brief: null, source: "none", calls: counter.calls, revision };
      failed = true;
      break;
    }
    briefs.push(b);
  }
  const base = briefs[0]!;
  // Oldest first, so an appointment is listed in the order it was made.
  const ordered = [...briefs].reverse();
  const reqLists = ordered.map((b) => b.replyRequirements?.items as readonly ReplyRequirement[] | undefined);
  const items = mergeById<ReplyRequirement>(reqLists);
  const meetings = mergeById<MeetingCandidate>(ordered.map((b) => b.meetingCandidates));
  // Complete only when every chunk that was planned was read AND answered the
  // requirements question, and nothing relevant was left over by the plan.
  const everyAnswered = briefs.length === plan.chunks.length && briefs.every((b) => !!b.replyRequirements);
  const complete = plan.completeSource && !failed && everyAnswered;
  const merged: Brief = {
    ...base,
    schema: BRIEF_SCHEMA_VERSION,
    ...(args.links !== undefined ? { linksSeen: true } : {}),
    ...(meetings !== undefined ? { meetingCandidates: meetings } : {}),
    ...(items !== undefined
      ? { replyRequirements: { items, completeSource: complete, sourceRevision: revision } }
      : {}),
  };
  // A failed older chunk is not cached: the next open re-reads only it.
  if (!failed) saveBrief(revision, merged, args.scope);
  return { brief: merged, source: "model", calls: counter.calls, revision, ...(failed ? { error: firstError } : {}) };
}

/**
 * The one reading of a thread. Cached by account, latest message id and schema
 * version; single-flight, so concurrent callers share one read. Never throws:
 * a failure is `source: "none"` with the error, and the caller keeps whatever
 * it was already showing.
 */
export function ensureThreadBrief(args: ThreadBriefArgs): Promise<ThreadBriefResult> {
  const revision = revisionOf(args.messages, args.threadId);
  const zone = isValidZone(args.zone) ? args.zone : deviceZone();
  const cached = briefFor(revision, loadBriefs(), args.scope);
  // A v3 entry is shown by whoever asked for it; it is not an answer to this
  // question. A v4 entry that was made without a link list is not an answer
  // to a caller that has one.
  if (isCurrentBrief(cached) && (args.links === undefined || cached.linksSeen)) {
    return Promise.resolve({ brief: cached, source: "cache", calls: 0, revision });
  }
  if (!args.ai.available || args.messages.length === 0) {
    return Promise.resolve({ brief: cached, source: cached ? "cache" : "none", calls: 0, revision });
  }
  const key = mailMessageKey(args.scope, revision) + ":brief:v" + BRIEF_SCHEMA_VERSION + (args.links !== undefined ? ":links" : "");
  let mine = false;
  const flight = singleFlight(key, async () => {
    mine = true;
    // Never throws: an unexpected failure is a failed read, not an error the
    // caller has to catch (openThread would have called it "Could not open").
    try { return await readThread(args, zone, revision); }
    catch (error) { return { brief: null, source: "none", calls: 0, revision, error } as ThreadBriefResult; }
  });
  // A caller that joined a flight already running made no call of its own.
  return flight.then((r) => (mine ? r : { ...r, calls: 0 }));
}
