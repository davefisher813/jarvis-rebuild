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
export { Store } from "./core/store.js";
export type { StorePersistence } from "./core/store.js";
export { REQUIREMENTS, STEPS } from "./core/spec.js";
export type { Ctx, Requirement, Step, StepResult } from "./core/spec.js";
