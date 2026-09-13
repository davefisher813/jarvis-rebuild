// A CLIENT ID FOR A QUEUED WRITE (Health Push F, H-51, Build Master
// 2026-09-12 section 4.8). Every health log and every finished workout is
// stamped once, on the phone, the moment it is queued. A flush whose answer
// was lost to the network replays the same entry with the same id, and the
// adapters (jarvis-core inMemoryAdapter and supabaseAdapter, plus the unique
// index migration 0039) treat the second arrival as the first: one row.
//
// uuid v4, the same shape jarvis-core's own row ids take, so the fallback
// below is uuid-shaped too and random rather than time-based.
export function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  let s = "";
  for (let i = 0; i < 32; i++) s += i === 12 ? "4" : i === 16 ? (8 + Math.floor(Math.random() * 4)).toString(16) : hex();
  return s.slice(0, 8) + "-" + s.slice(8, 12) + "-" + s.slice(12, 16) + "-" + s.slice(16, 20) + "-" + s.slice(20);
}
