// S3-Q15 (2026-09-04): "A backup restores eleven of thirty-odd types." There
// was never one canonical list of entity types anywhere in the app -- each
// feature module declares its own ENTITY_* constant, and BackupService kept a
// separate, hand-typed 11-entry KNOWN_TYPES that quietly fell behind every
// time a new feature shipped a new entity. This file is the fix: the ONE
// place that imports every ENTITY_* constant and re-exports them as a single
// list, so BackupService (and anything else that needs "every entity type
// this build knows about") has exactly one honest source instead of a copy
// someone has to remember to update.
//
// ADDING A NEW ENTITY TYPE? Add its import and its constant to ALL_ENTITY_TYPES
// below. Nothing else needs to change for backup/restore to pick it up.
//
// Note: data/CachedAdapter.ts has its own separate KNOWN_TYPES, used only to
// decide which write-through preload caches to patch on a local write. That
// list is unrelated to this one (a type missing there just means a slower
// repaint, never lost data) and is out of scope for this fix.
import { ENTITY_ACCOUNT } from "../money/types";
import { ENTITY_PROJECT } from "../projects/types";
import { ENTITY_PROFILE } from "../profile/types";
import { ENTITY_ROUTINE } from "../routine/types";
import { ENTITY_MONTH_SEAL } from "../review/seal";
import { ENTITY_NOTE, ENTITY_TASK } from "../notes/types";
import { ENTITY_CATEGORY } from "../categories/types";
import { ENTITY_METRIC_DEF, ENTITY_METRIC_LOG } from "../gym/metrics";
import { ENTITY_PROGRAM, ENTITY_WORKOUT } from "../gym/types";
import { ENTITY_FILE } from "../files/types";
import { ENTITY_CHAT } from "../chat/types";
import { ENTITY_LEARNED_RULE } from "../rules/types";
import {
  ENTITY_HEALTH_CONSENT,
  ENTITY_LIGHTS_OUT,
  ENTITY_ATE_BEFORE,
  ENTITY_TOOK_IT,
  ENTITY_CALL_IT,
  ENTITY_POINT_AT_IT,
  ENTITY_MED_REFILL,
  ENTITY_BAG_CHECK,
  ENTITY_LOCKER_DOC,
  ENTITY_TRUSTED_ADULT,
  ENTITY_AGE_RULE_SHOWN,
} from "../health/types";
import { ENTITY_EVENT } from "../schedule/types";
import { ENTITY_STRAND } from "../brain/strands/types";
import { ENTITY_BRAIN_DOC } from "../brain/docs/types";
import { ENTITY_DECISION } from "../decisions/types";
import { ENTITY_AREA, ENTITY_GOAL } from "../life/types";
import { ENTITY_PERSON } from "../people/types";

export const ALL_ENTITY_TYPES: readonly string[] = [
  ENTITY_ACCOUNT,
  ENTITY_PROJECT,
  ENTITY_PROFILE,
  ENTITY_ROUTINE,
  ENTITY_MONTH_SEAL,
  ENTITY_NOTE,
  ENTITY_TASK,
  ENTITY_CATEGORY,
  ENTITY_METRIC_DEF,
  ENTITY_METRIC_LOG,
  ENTITY_PROGRAM,
  ENTITY_WORKOUT,
  ENTITY_FILE,
  ENTITY_CHAT,
  ENTITY_LEARNED_RULE,
  ENTITY_HEALTH_CONSENT,
  ENTITY_LIGHTS_OUT,
  ENTITY_ATE_BEFORE,
  ENTITY_TOOK_IT,
  ENTITY_CALL_IT,
  ENTITY_POINT_AT_IT,
  ENTITY_MED_REFILL,
  ENTITY_BAG_CHECK,
  ENTITY_LOCKER_DOC,
  ENTITY_TRUSTED_ADULT,
  ENTITY_AGE_RULE_SHOWN,
  ENTITY_EVENT,
  ENTITY_STRAND,
  ENTITY_BRAIN_DOC,
  ENTITY_DECISION,
  ENTITY_AREA,
  ENTITY_GOAL,
  ENTITY_PERSON,
];
