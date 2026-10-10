// THE SUBSTRATE'S FLAGS (IMPLEMENTATION-SPEC.md section 17: "small vertical
// slices behind flags"). Read from one public build variable so a slice can
// land on main inert and be switched on per deploy. Unset means every flagged
// surface is off and the app is exactly what it was.
//
// Phase 0 (2026-10-10): the roster and the parser moved to flagList.ts, which
// reads no environment, so a law or a script can know the flags without
// Vite. This file is the one env read plus the two readers the app uses.

import { FLAGS, parseFlags, type Flag } from "./flagList";

export { FLAGS, parseFlags, type Flag };

const BUILD_FLAGS = parseFlags(import.meta.env.VITE_JARVIS_FLAGS as string | undefined);

export function flagOn(flag: Flag, flags: ReadonlySet<Flag> = BUILD_FLAGS): boolean {
  return flags.has(flag);
}

/** The flags this build has on, for the Advanced screen. */
export function flagsOn(flags: ReadonlySet<Flag> = BUILD_FLAGS): Flag[] {
  return FLAGS.filter((f) => flags.has(f));
}
