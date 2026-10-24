import type { DocErrorCode, DocText } from "./types";
import { assembleDocText, readPdfText, thinTextLayer } from "./readText";
import { extractDocument, type AICall } from "./extract";
import { buildProposal, hasContent } from "./proposal";

// THE DOCUMENT WORKER, as a pure core (the outbox pattern, src/substrate/outbox/worker.ts). api/_docWorker.ts wires it to the database,
// storage and the AI door; this file holds the order of things, so the order can be tested without any of them.
//
// The order, and why:
//   1. CLAIM before work. A lease on every claim. Nothing is read or spent without one.
//   2. READ (law 3: reading is not an AI call). The text layer of a PDF, or the text the phone already read, lands in doc_text. This
//      happens at AI level Off and before any gate is asked about.
//   3. STAMP in flight BEFORE the first model call. A tick that dies after the stamp is OUTCOME UNKNOWN and is never retried by code.
//   4. EXTRACT through `call`, which is the one AI door (gate, caps, budget, token log). The worker never reaches a model itself.
//   5. PROPOSE, never file (law 1). The proposal waits for Dave. A fingerprint he dismissed is never proposed again.
//   6. FINISH with one of the outbox outcomes: done, wait, retry, failed, unknown.

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

export interface ClaimedDoc {
  job_id: string;
  owner_id: string;
  file_id: string;
  stage: "read" | "extract";
  requested: boolean;
  claim_token: string;
  attempt: number;
  max_attempts: number;
}

export interface FileRow { name: string; mime: string; path: string; bytes: number }

export interface DocWorkerDeps {
  rpc: Rpc;
  worker: string;
  loadFile(owner: string, fileId: string): Promise<FileRow | null>;
  /** What doc_text already holds for the file (a phone's own OCR, or an earlier read). */
  loadText(owner: string, fileId: string): Promise<DocText | null>;
  downloadBytes(path: string): Promise<Uint8Array | null>;
  /** The AI door for this job. `seq` numbers its calls so every request id is unique and a repeat is a replay, never a second spend. */
  makeCall(job: ClaimedDoc): AICall;
  today?: () => Date;
}

export type DocRunResult =
  | { handled: false }
  | { handled: true; job_id: string; outcome: "done" | "wait" | "retry" | "failed" | "unknown" | "lease_lost"; state: string };

// Postgres interval literals (hh:mm:ss): a lease the claim holds, and the longer one a call in flight holds.
const LEASE = "00:02:00";
const CALL_LEASE = "00:03:00";

async function rpcData(deps: DocWorkerDeps, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await deps.rpc(fn, args);
  if (error) throw new Error(`${fn} failed`);
  return data;
}

export async function runDocOnce(deps: DocWorkerDeps): Promise<DocRunResult> {
  const claimed = (await rpcData(deps, "doc_claim", { p_worker: deps.worker, p_lease: LEASE })) as ClaimedDoc | null;
  if (!claimed || !claimed.job_id) return { handled: false };
  const job = claimed;
  const done = (outcome: Extract<DocRunResult, { handled: true }>["outcome"], state: string): DocRunResult => ({ handled: true, job_id: job.job_id, outcome, state });

  const patch = (doc: Record<string, unknown>) =>
    rpcData(deps, "doc_patch_file", { p_owner: job.owner_id, p_file: job.file_id, p_doc: doc, p_allow_back: false }).catch(() => undefined);
  const finish = async (outcome: "done" | "wait" | "retry" | "failed" | "unknown", code?: string, text?: string, reason?: string): Promise<string> => {
    const r = (await rpcData(deps, "doc_finish", {
      p_job: job.job_id, p_token: job.claim_token, p_outcome: outcome, p_code: code ?? null, p_text: text ?? null, p_reason: reason ?? null,
    }).catch(() => null)) as { state?: string; error?: string } | null;
    return r?.state ?? r?.error ?? "unknown";
  };

  let stamped = false;
  try {
    const file = await deps.loadFile(job.owner_id, job.file_id);
    if (!file) { await finish("failed", "STORAGE", "The file row is gone"); return done("failed", "failed"); }

    // ---- 2. READ ----
    let doc = await deps.loadText(job.owner_id, job.file_id);
    if (!doc) {
      await patch({ state: "reading" });
      if (file.mime !== "application/pdf") {
        // A photo is read on the phone first (device OCR, Lane 1). Until the phone has put its text, there is nothing to read here.
        await patch({ state: "stored", errorCode: "NO_TEXT" satisfies DocErrorCode });
        await finish("done");
        return done("done", "stored");
      }
      const bytes = await deps.downloadBytes(file.path);
      if (!bytes) {
        const s = await finish("retry", "STORAGE", "The file could not be fetched");
        if (s === "failed") await patch({ state: "failed", errorCode: "STORAGE" satisfies DocErrorCode });
        return done(s === "failed" ? "failed" : "retry", s);
      }
      let read;
      try {
        read = await readPdfText(bytes);
      } catch {
        await patch({ state: "unreadable", errorCode: "PARSER" satisfies DocErrorCode });
        await finish("failed", "PARSER", "Not a readable PDF");
        return done("failed", "unreadable");
      }
      if (read.encrypted) {
        await patch({ state: "unreadable", errorCode: "ENCRYPTED" satisfies DocErrorCode });
        await finish("failed", "ENCRYPTED", "Password protected");
        return done("failed", "unreadable");
      }
      if (thinTextLayer(read.pages, read.totalPages)) {
        // A scan or a photo saved as PDF. The AI read of scans is Lane 2; until it exists the document is kept and the row says why.
        await patch({ state: "unreadable", errorCode: "NO_TEXT" satisfies DocErrorCode, pages: read.totalPages });
        await finish("done");
        return done("done", "unreadable");
      }
      const missing = [...new Set([...read.failedPages, ...read.skippedPages])].sort((a, b) => a - b);
      doc = assembleDocText(read.pages, "text-layer", missing);
      const ok = await rpcData(deps, "doc_put_text", {
        p_owner: job.owner_id, p_file: job.file_id, p_lane: doc.lane, p_text: doc.text, p_pages: doc.pages, p_total: read.totalPages,
        p_failed: read.failedPages, p_skipped: read.skippedPages, p_words: doc.words,
      });
      if (ok !== true) { await finish("failed", "STORAGE", "The text could not be saved"); return done("failed", "failed"); }
      await patch({ pages: read.totalPages });
    }

    const missingRead = doc.failedPages;
    const readBlock: Record<string, unknown> = {
      state: missingRead.length ? "read-partial" : "read", words: doc.words, missingPages: missingRead.length ? missingRead : null,
    };
    await patch({ ...readBlock, errorCode: null, waiting: null });

    if (job.stage === "read") { await finish("done"); return done("done", "read"); }

    // ---- 3 and 4. STAMP, THEN ASK THE ONE DOOR ----
    // Every call is metered by the door; the stamp makes a death after this point an unknown, never a silent second spend.
    const door = deps.makeCall(job);
    const call: AICall = async (req) => {
      if (!stamped) {
        const ok = await rpcData(deps, "doc_mark_dispatched", { p_job: job.job_id, p_token: job.claim_token, p_request: `doc-${job.job_id}-${job.attempt}`, p_lease: CALL_LEASE });
        if (ok !== true) throw new Error("LEASE_LOST");
        stamped = true;
      } else {
        await rpcData(deps, "doc_extend", { p_job: job.job_id, p_token: job.claim_token, p_lease: CALL_LEASE });
      }
      try {
        return await door(req);
      } catch {
        // The request may or may not have left. That is the one answer nobody retries.
        return { ok: false, code: "UNKNOWN" };
      }
    };

    await patch({ state: "extracting" });
    const out = await extractDocument(doc, call, (deps.today ?? (() => new Date()))());

    if (!out.ok) {
      switch (out.code) {
        case "OFF":
          // AI is Off, or On Request and nobody asked: the document was read, and it says it was not reviewed. Not a failure.
          await patch({ ...readBlock, notReviewed: true });
          await finish("done");
          return done("done", "read");
        case "CREDIT":
          await patch({ ...readBlock, errorCode: "CREDIT" satisfies DocErrorCode });
          await finish("failed", "CREDIT", "The AI account needs credit");
          return done("failed", "read");
        case "BUSY":
          await patch({ ...readBlock, waiting: true });
          await finish("wait", "BUSY", undefined, "busy");
          return done("wait", "read");
        case "UNKNOWN":
          await patch({ state: "failed", errorCode: "OUTCOME_UNKNOWN" satisfies DocErrorCode });
          await finish("unknown", "OUTCOME_UNKNOWN", "The call may have been made");
          return done("unknown", "failed");
        default: {
          const s = await finish("retry", out.code, "The reply could not be used");
          if (s === "failed") await patch({ state: "failed", errorCode: (out.code === "SCHEMA" ? "SCHEMA" : "UPSTREAM") satisfies DocErrorCode });
          else await patch({ ...readBlock });
          return done(s === "failed" ? "failed" : "retry", s);
        }
      }
    }

    // ---- 5. PROPOSE, NEVER FILE ----
    const proposal = buildProposal({ fileId: job.file_id, fileName: file.name, title: out.title || file.name, extraction: out.result });
    const missing = [...new Set([...missingRead, ...out.result.missingPages])].sort((a, b) => a - b);
    const block = { ...readBlock, kind: out.result.kind, state: missing.length ? "read-partial" : "read", missingPages: missing.length ? missing : null };
    if (!hasContent(proposal)) {
      // Nothing to do here is a success, not a failure.
      await patch(block);
      await finish("done");
      return done("done", "read");
    }
    const put = (await rpcData(deps, "doc_put_proposal", {
      p_owner: job.owner_id, p_file: job.file_id, p_fingerprint: proposal.fingerprint, p_kind: proposal.kind, p_body: proposal,
    })) as { proposal_id?: string; suppressed?: boolean; status?: string } | null;
    const offered = !!put?.proposal_id && !put.suppressed;
    if (offered) {
      await patch({ ...block, state: "proposed", proposalId: put!.proposal_id });
    } else {
      // The same facts were decided before. A dismissal holds: the document stays, read, and is not proposed again.
      await patch(block);
    }
    await finish("done");
    return done("done", offered ? "proposed" : "read");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "LEASE_LOST") return done("lease_lost", "lease_lost");
    // After the stamp, an error of ours is not the model's: finish it as a failure that only a tap retries (never an automatic second spend).
    if (stamped) { await finish("failed", "WORKER", "The worker failed after the call"); await patch({ state: "failed", errorCode: "WORKER" satisfies DocErrorCode }); return done("failed", "failed"); }
    const s = await finish("retry", "WORKER", "The worker failed before the call");
    if (s === "failed") await patch({ state: "failed", errorCode: "WORKER" satisfies DocErrorCode });
    return done(s === "failed" ? "failed" : "retry", s);
  }
}
