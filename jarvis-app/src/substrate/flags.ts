// THE SUBSTRATE'S FLAGS (IMPLEMENTATION-SPEC.md section 17: "small vertical
// slices behind flags"). Read from one public build variable so a slice can
// land on main inert and be switched on per deploy. Unset means every flagged
// surface is off and the app is exactly what it was.

export const FLAGS = ["substrate_v1", "email_intake_v1", "verified_agent_adapters"] as const;
export type Flag = (typeof FLAGS)[number];

export function parseFlags(raw: string | undefined): ReadonlySet<Flag> {
  const on = new Set<Flag>();
  for (const part of (raw ?? "").split(",")) {
    const name = part.trim();
    if ((FLAGS as readonly string[]).includes(name)) on.add(name as Flag);
  }
  return on;
}

const BUILD_FLAGS = parseFlags(import.meta.env.VITE_JARVIS_FLAGS as string | undefined);

export function flagOn(flag: Flag, flags: ReadonlySet<Flag> = BUILD_FLAGS): boolean {
  return flags.has(flag);
}

/** The flags this build has on, for the Advanced screen. */
export function flagsOn(flags: ReadonlySet<Flag> = BUILD_FLAGS): Flag[] {
  return FLAGS.filter((f) => flags.has(f));
}
