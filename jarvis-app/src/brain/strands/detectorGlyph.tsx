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
