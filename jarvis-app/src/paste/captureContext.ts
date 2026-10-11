// The contacts a capture matches against (UP-CORE-01), in one place so Quick
// Capture and Chat read the same list. Phase 0 D11: aliases ride along behind
// memory_v1, so "Mom" matches Linda.
import type { Person } from "../people/types";
import { flagOn } from "../substrate/flags";

export function capturePeople(list: Person[]): { id: string; name: string; aliases?: string[] }[] {
  return list.map((p) => ({
    id: p.id,
    name: p.data.name,
    ...(flagOn("memory_v1") && p.data.aliases?.length ? { aliases: p.data.aliases } : {}),
  }));
}
