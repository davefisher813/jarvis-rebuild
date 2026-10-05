import type { ReactNode } from "react";
import { Clock, ArrowsClockwise, Target, Hourglass, Barbell, EnvelopeSimple, UsersThree, UserMinus, Eye } from "@phosphor-icons/react";
import type { DerivationKey } from "./types";

// THE DETECTOR'S OWN GLYPH (Dave 2026-10-05, the review: "a generic amber question mark that reads as a placeholder or an
// error glyph"). A detector JARVIS is still counting for is a thing with a subject, so its disc carries that subject:
// the clock for when tasks get done, the barbell for training, the envelope for email, the people for the person you
// write to. The filled weight, the same one every disc in a list wears (ICON LAW 2026-08-22).
const P = { weight: "fill" as const, className: "ic" };

export function detectorGlyph(key: DerivationKey): ReactNode {
  switch (key) {
    case "completion_window": case "completion_no_band": return <Clock {...P} />;
    case "slip_category": case "slip_no_leader": return <ArrowsClockwise {...P} />;
    case "plan_rate": return <Target {...P} />;
    case "task_timing": return <Hourglass {...P} />;
    case "training_window": return <Barbell {...P} />;
    case "email_window": return <EnvelopeSimple {...P} />;
    case "people_rhythm": return <UsersThree {...P} />;
    case "gone_quiet": return <UserMinus {...P} />;
    default: return <Eye {...P} />;
  }
}

/** The tone a detector's glyph wears: its SUBJECT's, so the same thing is the same colour on every screen (D5). A task's
 *  detectors are Task red, training is Health green, email is Email teal, a person's is the people's teal. Never a grey disc. */
export function detectorTone(key: DerivationKey): string {
  switch (key) {
    case "completion_window": case "completion_no_band": case "slip_category": case "slip_no_leader":
    case "plan_rate": case "task_timing": return "cat-fg-red";
    case "training_window": return "cat-fg-green";
    case "email_window": case "people_rhythm": case "gone_quiet": return "cat-fg-teal";
    default: return "cat-fg-purple";
  }
}
