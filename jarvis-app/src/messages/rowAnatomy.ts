// THE LEADING COLUMN, DECIDED IN ONE PLACE (EM3, Email Build Master, Dave's
// picks 2026-09-12; approved harness JARVIS_EMAIL_PREVIEW_2026_09_12.html).
//
// A thread row's left column used to be a three-branch expression inside
// threadRow: a checkbox in select mode, a bare rail for a machine, a face
// for a person. Two of those branches drew different SHAPES in the same
// 34px slot, and the rule for which one a row got (triage bucket, or the
// no-reply address rule) lived in JSX where no test could reach it. This is
// that decision as a pure function: a row in, the lead out. threadRow draws
// what it is handed.
//
// The rule itself is unchanged from 8A (2026-08-25): a machine keeps the
// rail, a person gets a face, and the rail lights only for a DEADLINE the
// sender stated, never for mere unreadness -- six unread promos wearing six
// lit rails was a status column down the whole All tab, which is L1's exact
// sin. The harness keeps the rail centred in the same reserved slot the face
// occupies, so a list that mixes people and machines still shares one text
// edge (the Custom Ink / GitHub stagger of 2026-08-25 stays fixed).

import { isMachineAddress } from "./noReply";
import { railToneForDeadline } from "./rows";

// 8A: a stable warm colour per sender, drawn from the category fills so the
// on-colour contrast is already held at 4.5:1 by a law test. Red is absent
// on purpose: red is a verb (L1), never an identity.
export const FACE_SLOTS = ["yellow", "sky", "green", "orange", "teal", "pink", "purple", "blue"] as const;
export type FaceHue = (typeof FACE_SLOTS)[number];

export function faceSlot(key: string): FaceHue {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return FACE_SLOTS[h % FACE_SLOTS.length]!;
}

export type RailTone = "warn" | "default";

export type Lead =
  | { kind: "avatar"; face: FaceHue; initial: string }
  | { kind: "rail"; face: FaceHue; railTone: RailTone };

export interface LeadInput {
  from: string;
  fromEmail: string;
  /** The triage bucket, when the row has been sorted. */
  bucket?: string;
  /** The sender's stated deadline, when triage found one. */
  by?: string;
  /** The display name, already derived by the caller (names.ts). */
  displayName: string;
}

/**
 * What the left column shows. A machine (noise bucket, or a no-reply
 * address) is a rail; anyone else is a face. Both carry the sender's hue so
 * the column keeps one identity per sender whichever shape it draws.
 */
export function leadFor(r: LeadInput, now = new Date()): Lead {
  const face = faceSlot(r.fromEmail || r.from);
  const machine = r.bucket === "noise" || isMachineAddress(r.fromEmail);
  if (machine) {
    return { kind: "rail", face, railTone: railToneForDeadline(r.by, now) ? "warn" : "default" };
  }
  return { kind: "avatar", face, initial: (r.displayName[0] || "?").toUpperCase() };
}
