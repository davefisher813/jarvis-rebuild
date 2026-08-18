// THE FILLED GLYPH SET (Catalog V4, Dave 2026-08-18; quality pass same day:
// "make sure all red icons are improved"). Nav lists wear filled brand-red
// glyphs the way Apple Music's Library does. The shapes come from Phosphor's
// professionally drawn FILL weight, never from pouring fill into stroke
// icons (the compass-blob bug, banned by law). Outline icons stay the
// content-row state; a surface never mixes states.

import type { ReactNode } from "react";
import {
  Brain, Note, Target, EnvelopeSimple, BellSimple, Wallet, Sparkle, GearSix,
  House, CheckSquare, CalendarBlank, UsersThree, GitFork, Compass, PenNib,
  Flag, Clock, UserCircle, Palette, Tag, SquaresFour, LinkSimple, Lightbulb,
  CloudArrowUp, SlidersHorizontal, Info, Circle,
} from "@phosphor-icons/react";

const P = { weight: "fill" as const, className: "ic" };

export const FILLED: Record<string, ReactNode> = {
  // ---- Brain hub rows ----
  contacts: <UsersThree {...P} />,
  decisions: <GitFork {...P} />,
  philosophy: <Compass {...P} />,
  writing: <PenNib {...P} />,
  values: <Flag {...P} />,
  routine: <Clock {...P} />,

  // ---- More rows (destination keys) ----
  today: <House {...P} />,
  tasks: <CheckSquare {...P} />,
  schedule: <CalendarBlank {...P} />,
  brain: <Brain {...P} />,
  notes: <Note {...P} />,
  bigger: <Target {...P} />,
  messages: <EnvelopeSimple {...P} />,
  notifications: <BellSimple {...P} />,
  money: <Wallet {...P} />,
  chat: <Sparkle {...P} />,
  settings: <GearSix {...P} />,
};

// ---- Settings hub rows (Dave 2026-08-18: "settings in all red too") ----
export const FILLED_SETTINGS: Record<string, ReactNode> = {
  account: <UserCircle {...P} />,
  notifsettings: <BellSimple {...P} />,
  appearance: <Palette {...P} />,
  categories: <Tag {...P} />,
  edittabs: <SquaresFour {...P} />,
  connections: <LinkSimple {...P} />,
  aicontrol: <Sparkle {...P} />,
  learned: <Lightbulb {...P} />,
  backup: <CloudArrowUp {...P} />,
  advanced: <SlidersHorizontal {...P} />,
  about: <Info {...P} />,
};

// A nav destination with no drawn filled glyph yet falls back to a filled
// disc so the wash stays uniform (and the gap is obvious in review).
export const FILLED_FALLBACK: ReactNode = <Circle {...P} />;

export function filledIcon(key: string): ReactNode {
  return FILLED[key] ?? FILLED_FALLBACK;
}

export function filledSettingsIcon(route: string): ReactNode {
  return FILLED_SETTINGS[route] ?? FILLED_FALLBACK;
}
