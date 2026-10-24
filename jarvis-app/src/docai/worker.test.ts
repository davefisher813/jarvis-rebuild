import { describe, expect, it } from "vitest";
import { runDocOnce, type ClaimedDoc, type DocWorkerDeps, type FileRow } from "./worker";
import type { AICall, AIResult } from "./extract";
import type { DocText } from "./types";
import { makePdf, makeScanPdf } from "./testPdf";

// A fake database that obeys the same outcomes as the real functions (migration 0073), recording the order of every call.
const BILL_LINES = ["GEICO Auto Insurance", "Account ZX-991 statement for October", "Amount due: $1,234.50", "Pay by October 24, 2026", "Please remit payment to the address on the back of this statement."];
const OWNER = "o1", FILE = "f1";

interface Sim {
  log: string[];
  patches: Record<string, unknown>[];
  finish: { outcome?: string; code?: string; reason?: string } | null;
  proposals: { fingerprint: string; body: { fileId: string } }[];
  puts: number;
  maxAttempts: number;
  dismissed: Set<string>;
}

function setup(over: { pdf?: Uint8Array | null; mime?: string; text?: DocText | null; stage?: "read" | "extract"; ai?: (n: number) => AIResult; attempt?: number; maxAttempts?: number; dismissed?: string[] } = {}) {
  const sim: Sim = { log: [], patches: [], finish: null, proposals: [], puts: 0, maxAttempts: over.maxAttempts ?? 3, dismissed: new Set(over.dismissed ?? []) };
  const job: ClaimedDoc = { job_id: "j1", owner_id: OWNER, file_id: FILE, stage: over.stage ?? "extract", requested: false, claim_token: "t1", attempt: over.attempt ?? 1, max_attempts: sim.maxAttempts };
  let claimed = false;
  let aiCalls = 0;
  const rpc: DocWorkerDeps["rpc"] = async (fn, args = {}) => {
    sim.log.push(fn);
    switch (fn) {
      case "doc_claim": if (claimed) return { data: null, error: null }; claimed = true; return { data: job, error: null };
      case "doc_patch_file": sim.patches.push(args.p_doc as Record<string, unknown>); return { data: true, error: null };
      case "doc_put_text": return { data: true, error: null };
      case "doc_mark_dispatched": return { data: true, error: null };
      case "doc_extend": return { data: true, error: null };
      case "doc_finish": {
        sim.finish = { outcome: args.p_outcome as string, code: (args.p_code as string) ?? undefined, reason: (args.p_reason as string) ?? undefined };
        const st = args.p_outcome === "retry" ? (job.attempt >= job.max_attempts ? "failed" : "pending") : args.p_outcome === "wait" ? "pending" : args.p_outcome === "done" ? "done" : args.p_outcome === "unknown" ? "outcome_unknown" : "failed";
        return { data: { state: st }, error: null };
      }
      case "doc_put_proposal": {
        sim.puts++;
        const fp = args.p_fingerprint as string;
        if (sim.dismissed.has(fp)) return { data: { proposal_id: "p0", status: "dismissed", suppressed: true, created: false }, error: null };
        sim.proposals.push({ fingerprint: fp, body: args.p_body as { fileId: string } });
        return { data: { proposal_id: "p1", status: "open", suppressed: false, created: true }, error: null };
      }
      default: return { data: null, error: { message: "unexpected " + fn } };
    }
  };
  const file: FileRow = { name: "power.pdf", mime: over.mime ?? "application/pdf", path: "o1/f1/power.pdf", bytes: 100 };
  const defaultAi = (n: number): AIResult => n === 0
    ? { ok: true, json: { kind: "bill", actionable: true, title: "GEICO Auto" }, truncated: false }
    : { ok: true, json: { items: [{ group: "bill", fields: [
        { key: "payee", value: "GEICO", quote: "GEICO Auto Insurance", page: 1, basis: "stated" },
        { key: "amount", value: "1234.50", quote: "Amount due: $1,234.50", page: 1, basis: "stated" },
        { key: "dueDate", value: "2026-10-24", quote: "Pay by October 24, 2026", page: 1, basis: "stated" },
      ] }] }, truncated: false };
  const deps: DocWorkerDeps = {
    rpc, worker: "test",
    loadFile: async () => file,
    loadText: async () => over.text ?? null,
    downloadBytes: async () => (over.pdf === undefined ? makePdf([BILL_LINES]) : over.pdf),
    makeCall: (): AICall => async () => { sim.log.push("AI"); const r = (over.ai ?? defaultAi)(aiCalls); aiCalls++; return r; },
    today: () => new Date(2026, 9, 23),
  };
  return { deps, sim };
}

describe("the document worker: order of things", () => {
  it("claims, reads, stamps BEFORE the first AI call, proposes, finishes done", async () => {
    const { deps, sim } = setup();
    const r = await runDocOnce(deps);
    expect(r).toMatchObject({ handled: true, outcome: "done", state: "proposed" });
    const i = (name: string) => sim.log.indexOf(name);
    expect(i("doc_claim")).toBe(0);
    expect(i("doc_put_text")).toBeGreaterThan(i("doc_claim"));
    expect(i("doc_mark_dispatched")).toBeGreaterThan(i("doc_put_text"));
    expect(i("doc_mark_dispatched")).toBeLessThan(i("AI"));
    expect(sim.log.filter((x) => x === "doc_mark_dispatched")).toHaveLength(1);
    expect(sim.log.filter((x) => x === "doc_extend")).toHaveLength(1);
    expect(sim.log.at(-1)).toBe("doc_finish");
    expect(sim.proposals).toHaveLength(1);
    expect(sim.patches.at(-1)).toMatchObject({ state: "proposed", kind: "bill", proposalId: "p1" });
  });

  it("answers handled:false when there is nothing to do", async () => {
    const { deps } = setup();
    await runDocOnce(deps);
    expect(await runDocOnce(deps)).toEqual({ handled: false });
  });

  it("never writes a record: it only calls the queue, the text, the proposal and the file's own lifecycle block", async () => {
    const { deps, sim } = setup();
    await runDocOnce(deps);
    expect(new Set(sim.log)).toEqual(new Set(["doc_claim", "doc_patch_file", "doc_put_text", "doc_mark_dispatched", "doc_extend", "AI", "doc_put_proposal", "doc_finish"]));
  });
});

describe("law 3: reading is not an AI call", () => {
  it("stage read reads the PDF and never stamps or asks the door", async () => {
    const { deps, sim } = setup({ stage: "read" });
    const r = await runDocOnce(deps);
    expect(r).toMatchObject({ outcome: "done", state: "read" });
    expect(sim.log).not.toContain("AI");
    expect(sim.log).not.toContain("doc_mark_dispatched");
    expect(sim.patches.some((p) => p.state === "read" && typeof p.words === "number" && (p.words as number) > 5)).toBe(true);
  });

  it("AI Off: the document is read, marked not reviewed, nothing is proposed, and it is not a failure", async () => {
    const { deps, sim } = setup({ ai: () => ({ ok: false, code: "OFF" }) });
    const r = await runDocOnce(deps);
    expect(r).toMatchObject({ outcome: "done", state: "read" });
    expect(sim.patches.at(-1)).toMatchObject({ state: "read", notReviewed: true });
    expect(sim.proposals).toHaveLength(0);
    expect(sim.finish?.outcome).toBe("done");
  });

  it("reuses text the phone already read and does not fetch the file", async () => {
    let fetched = 0;
    const text: DocText = { text: BILL_LINES.join("\n"), pages: [{ page: 1, start: 0, end: BILL_LINES.join("\n").length }], words: 20, lane: "device-ocr", failedPages: [] };
    const { deps, sim } = setup({ text });
    deps.downloadBytes = async () => { fetched++; return null; };
    await runDocOnce(deps);
    expect(fetched).toBe(0);
    expect(sim.log).not.toContain("doc_put_text");
    expect(sim.proposals).toHaveLength(1);
  });
});

describe("what cannot be read is said, not faked", () => {
  it("a scan with no text layer is unreadable (no AI, no proposal) until the AI read exists", async () => {
    const { deps, sim } = setup({ pdf: makeScanPdf(2) });
    const r = await runDocOnce(deps);
    expect(r).toMatchObject({ outcome: "done", state: "unreadable" });
    expect(sim.patches.at(-1)).toMatchObject({ state: "unreadable", errorCode: "NO_TEXT", pages: 2 });
    expect(sim.log).not.toContain("AI");
  });

  it("a file that is not a PDF fails with the parser code and a manual retry", async () => {
    const { deps, sim } = setup({ pdf: new TextEncoder().encode("not a pdf at all") });
    const r = await runDocOnce(deps);
    expect(r).toMatchObject({ outcome: "failed" });
    expect(sim.patches.at(-1)).toMatchObject({ state: "unreadable", errorCode: "PARSER" });
  });

  it("a photo waits for the phone's own reading", async () => {
    const { deps, sim } = setup({ mime: "image/jpeg" });
    const r = await runDocOnce(deps);
    expect(r).toMatchObject({ outcome: "done", state: "stored" });
    expect(sim.patches.at(-1)).toMatchObject({ state: "stored", errorCode: "NO_TEXT" });
    expect(sim.log).not.toContain("AI");
  });

  it("a missing download is retried, and fails after the last attempt", async () => {
    const a = setup({ pdf: null });
    expect(await runDocOnce(a.deps)).toMatchObject({ outcome: "retry" });
    const b = setup({ pdf: null, attempt: 3 });
    expect(await runDocOnce(b.deps)).toMatchObject({ outcome: "failed" });
    expect(b.sim.patches.at(-1)).toMatchObject({ state: "failed", errorCode: "STORAGE" });
  });
});

describe("the outbox rules", () => {
  it("credit exhausted is a named state: read, saved, finished as failed (a tap retries)", async () => {
    const { deps, sim } = setup({ ai: () => ({ ok: false, code: "CREDIT" }) });
    const r = await runDocOnce(deps);
    expect(r).toMatchObject({ outcome: "failed", state: "read" });
    expect(sim.patches.at(-1)).toMatchObject({ state: "read", errorCode: "CREDIT" });
    expect(sim.finish).toMatchObject({ outcome: "failed", code: "CREDIT" });
  });

  it("a cap or budget refusal returns to pending and uses no attempt", async () => {
    const { deps, sim } = setup({ ai: () => ({ ok: false, code: "BUSY" }) });
    const r = await runDocOnce(deps);
    expect(r).toMatchObject({ outcome: "wait" });
    expect(sim.patches.at(-1)).toMatchObject({ waiting: true });
    expect(sim.finish).toMatchObject({ outcome: "wait" });
  });

  it("a call that may have left is OUTCOME UNKNOWN and is never retried by code", async () => {
    const { deps, sim } = setup({ ai: () => ({ ok: false, code: "UNKNOWN" }) });
    const r = await runDocOnce(deps);
    expect(r).toMatchObject({ outcome: "unknown", state: "failed" });
    expect(sim.patches.at(-1)).toMatchObject({ state: "failed", errorCode: "OUTCOME_UNKNOWN" });
    expect(sim.finish?.outcome).toBe("unknown");
  });

  it("a door that throws is treated as unknown, not as a retry", async () => {
    const { deps, sim } = setup();
    deps.makeCall = () => async () => { throw new Error("network"); };
    const r = await runDocOnce(deps);
    expect(r).toMatchObject({ outcome: "unknown" });
    expect(sim.log.filter((x) => x === "doc_mark_dispatched")).toHaveLength(1);
  });

  it("a reply that fails the schema is retried with backoff, then failed with its code", async () => {
    const first = setup({ ai: () => ({ ok: false, code: "SCHEMA" }) });
    expect(await runDocOnce(first.deps)).toMatchObject({ outcome: "retry" });
    const last = setup({ ai: () => ({ ok: false, code: "SCHEMA" }), attempt: 3 });
    expect(await runDocOnce(last.deps)).toMatchObject({ outcome: "failed" });
    expect(last.sim.patches.at(-1)).toMatchObject({ state: "failed", errorCode: "SCHEMA" });
  });

  it("a lost stamp stops the job before any AI call", async () => {
    const { deps, sim } = setup();
    const inner = deps.rpc;
    deps.rpc = async (fn, args) => (fn === "doc_mark_dispatched" ? { data: false, error: null } : inner(fn, args));
    const r = await runDocOnce(deps);
    expect(r).toMatchObject({ outcome: "lease_lost" });
    expect(sim.log).not.toContain("AI");
    expect(sim.finish).toBeNull();
  });
});

describe("law 1 and the dismissal memory", () => {
  it("nothing actionable: the document stays read, nothing is proposed", async () => {
    const { deps, sim } = setup({ ai: () => ({ ok: true, json: { kind: "letter", actionable: false, title: "Hello" }, truncated: false }) });
    const r = await runDocOnce(deps);
    expect(r).toMatchObject({ outcome: "done", state: "read" });
    expect(sim.puts).toBe(0);
    expect(sim.patches.at(-1)).toMatchObject({ state: "read" });
  });

  it("the same facts dismissed before are not proposed again", async () => {
    const first = setup();
    await runDocOnce(first.deps);
    const fp = first.sim.proposals[0]!.fingerprint;
    const again = setup({ dismissed: [fp] });
    const r = await runDocOnce(again.deps);
    expect(r).toMatchObject({ outcome: "done", state: "read" });
    expect(again.sim.proposals).toHaveLength(0);
    expect(again.sim.patches.at(-1)).toMatchObject({ state: "read" });
    expect(again.sim.patches.at(-1)).not.toHaveProperty("proposalId");
  });

  it("a long document the run could not finish names the missing pages and reads as partial", async () => {
    const { deps, sim } = setup({ ai: (n) => (n === 0 ? { ok: true, json: { kind: "bill", actionable: true }, truncated: false } : { ok: true, truncated: true, json: { items: [{ group: "bill", fields: [{ key: "payee", value: "GEICO", quote: "GEICO Auto Insurance", page: 1, basis: "stated" }] }] } }) });
    await runDocOnce(deps);
    expect(sim.patches.at(-1)).toMatchObject({ state: "proposed", missingPages: [1] });
  });
});
