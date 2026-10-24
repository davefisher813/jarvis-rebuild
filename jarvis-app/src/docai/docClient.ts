import { supabase } from "../auth/supabaseClient";
import type { DocProposal } from "./proposal";
import type { DecisionRecord } from "./record";
import type { DocText } from "./types";

// THE APP'S SIDE OF THE DOCUMENT QUEUE. Every call is one of the three functions the browser is allowed (doc_enqueue, doc_put_text_user,
// doc_proposal_decide) or a read of rows the owner may see (migration 0073). The browser never writes the queue, a proposal's body or a
// text row directly. With no backend (sandbox, tests) every call answers "not available" and the screens say so; nothing throws.

export type ClientResult<T> = { ok: true; value: T } | { ok: false; reason: "OFFLINE" | "FAILED" };

const off = { ok: false, reason: "OFFLINE" } as const;

export async function enqueueDoc(fileId: string, opts: { retry?: boolean; requested?: boolean } = {}): Promise<ClientResult<{ enqueued: boolean }>> {
  if (!supabase) return off;
  const { data, error } = await supabase.rpc("doc_enqueue", { p_file: fileId, p_retry: !!opts.retry, p_requested: !!opts.requested });
  if (error || !data || (data as { error?: string }).error) return { ok: false, reason: "FAILED" };
  return { ok: true, value: { enqueued: (data as { enqueued?: boolean }).enqueued === true } };
}

/** The newest proposal still waiting for a decision on this file, as the sheet shows it. */
export async function openProposal(fileId: string): Promise<ClientResult<{ id: string; body: DocProposal } | null>> {
  if (!supabase) return off;
  const { data, error } = await supabase.from("doc_proposal").select("id, body").eq("file_id", fileId).eq("status", "open").order("created_at", { ascending: false }).limit(1);
  if (error) return { ok: false, reason: "FAILED" };
  const row = (data as { id: string; body: DocProposal }[] | null)?.[0];
  return { ok: true, value: row ? { id: row.id, body: row.body } : null };
}

/** What was read, for the "Where This Came From" passage. */
export async function readDocText(fileId: string): Promise<ClientResult<DocText | null>> {
  if (!supabase) return off;
  const { data, error } = await supabase.from("doc_text").select("text, pages, words, lane, failed_pages").eq("file_id", fileId).limit(1);
  if (error) return { ok: false, reason: "FAILED" };
  const r = (data as { text: string; pages: DocText["pages"]; words: number; lane: DocText["lane"]; failed_pages: number[] }[] | null)?.[0];
  return { ok: true, value: r ? { text: r.text, pages: r.pages, words: r.words, lane: r.lane, failedPages: r.failed_pages ?? [] } : null };
}

/** Dave filed it or dismissed it. The decision record rides along as the proof of who decided what. */
export async function decideProposal(id: string, status: "filed" | "dismissed", record: DecisionRecord, filedTo?: string): Promise<ClientResult<{ changed: boolean }>> {
  if (!supabase) return off;
  const { data, error } = await supabase.rpc("doc_proposal_decide", { p_id: id, p_status: status, p_decisions: record, p_filed_to: filedTo ?? null });
  if (error || !data || (data as { error?: string }).error) return { ok: false, reason: "FAILED" };
  return { ok: true, value: { changed: (data as { changed?: boolean }).changed === true } };
}

/** The phone's own reading of a photo (Lane 1, device OCR). The server fixes the lane; the phone cannot claim another. */
export async function putDeviceText(fileId: string, text: string, pages: DocText["pages"], words: number): Promise<ClientResult<true>> {
  if (!supabase) return off;
  const { data, error } = await supabase.rpc("doc_put_text_user", { p_file: fileId, p_text: text, p_pages: pages, p_words: words });
  if (error || !data || (data as { error?: string }).error) return { ok: false, reason: "FAILED" };
  return { ok: true, value: true };
}

// ---- the double-filing guard ----
// Filing writes ordinary records FIRST and the decision SECOND. If the second call cannot reach the server, the proposal is still open there, and
// a second File It would write the same records again. This device remembers which proposals it has already filed, so the next open of one
// finishes the decision instead of filing twice. Best effort by nature (storage can be blocked), and a bill is also caught by Money's own duplicate check.
const FILED_KEY = "jarvis.doc.filed.v1";

export function markFiledHere(proposalId: string, wordsFiled: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(FILED_KEY) || "{}") as Record<string, string>;
    all[proposalId] = wordsFiled;
    localStorage.setItem(FILED_KEY, JSON.stringify(all));
  } catch { /* storage blocked: Money's duplicate check is the net for bills */ }
}

export function filedHere(proposalId: string): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(FILED_KEY) || "{}") as Record<string, string>;
    return all[proposalId] ?? null;
  } catch { return null; }
}
