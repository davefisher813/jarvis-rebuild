// JARVIS Core Data Model: the data engine every feature sits on.
export type {
  ApplyResult,
  Item,
  ItemData,
  Json,
  QueuedCreate,
  QueuedDelete,
  QueuedOp,
  QueuedUpdate,
  ServerTime,
} from "./core/types.js";
export type { DataAdapter } from "./core/adapter.js";
export { InMemoryAdapter } from "./core/inMemoryAdapter.js";
export { SupabaseAdapter, createSupabaseAdapter } from "./core/supabaseAdapter.js";
export { Store, UUID_RE, isNetworkError } from "./core/store.js";
export type { StorePersistence, SyncState } from "./core/store.js";
export { mergePatch, stripNulls, toWire } from "./core/patch.js";
export { REQUIREMENTS, STEPS } from "./core/spec.js";
export type { Ctx, Requirement, Step, StepResult } from "./core/spec.js";
export type { SubscriptionTier } from "./core/subscriptionTier.js";
export {
  DEFAULT_TIER,
  isValidTier,
  isTierPaid,
  isTierUnlimited,
  tierDisplayName,
} from "./core/subscriptionTier.js";
