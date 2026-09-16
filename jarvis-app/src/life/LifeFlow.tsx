import { useEffect, useState } from "react";
import TasksFlow from "../tasks/TasksFlow";
import BiggerPictureFlow from "../bigger/BiggerPictureFlow";
import LifeSegments, { type LifeSegment } from "./LifeSegments";
import RemindersFlow from "../tasks/screens/RemindersFlow";
import AreasTab from "./tabs/AreasTab";

// LIFE (ruled 2026-09-01): Tasks and Your Life, one tab. This flow owns only
// the segment; each lens keeps its own flow, sheets, deep links and data, so
// nothing that worked on either page had to move to make them one page.
//
// The segment is remembered within the session and reset on launch. A deep
// link (a task, a project, a goal) picks the segment it needs and wins over
// the memory, once.
// AREAS TAB (2026-09-16): the default landing segment, per the approved
// handoff -- browsing what an area holds is the more common reason to open
// Life than any one lens is.
let lastSegment: LifeSegment = "areas";

export default function LifeFlow({
  segment, segmentNav, taskOpenId, taskNonce, onTaskOpened, taskFilter, filterNonce, onFilterApplied, projectOpenId, projectNonce, onProjectOpened, goalOpenId, goalNonce, onGoalOpened, onOpenNote, onWhatNow, onOpenDecision, onGoEmail, onOpenEntity, onOpenCategory,
}: {
  /** Push E: the Reminders segment's door to any linked record. */
  onOpenEntity?: (kind: string, id: string) => void;
  /** Areas tab: opens a category's own detail page (Brain's CategoryDetail,
   *  the same page BrainFlow already renders for a category deep link). */
  onOpenCategory?: (id: string) => void;
  segment?: LifeSegment;
  /** Bumped by the shell on every deep link, so a link to the lens already
   *  remembered still moves a page that has since changed lens. */
  segmentNav?: number;
  taskOpenId?: string; taskFilter?: string;
  // SHELL-F-12 (2026-09-05): the nonce and the callback each lens flow needs
  // to consume its own one-shot. LifeFlow only forwards them.
  taskNonce?: number; onTaskOpened?: () => void;
  filterNonce?: number; onFilterApplied?: () => void;
  projectOpenId?: string; goalOpenId?: string;
  // LIFE-F-07 (2026-09-05): the shell's one-shot nonces, passed straight
  // through. A deep link to the lens you are already on has to look like a
  // change to the lens flow, or nothing happens (shell/intents.ts).
  projectNonce?: number; goalNonce?: number;
  // LIFE-F-08 (2026-09-05): each lens flow tells the shell its link is spent,
  // so a segment round trip is a round trip and not a replay.
  onProjectOpened?: () => void; onGoalOpened?: () => void;
  onOpenNote?: (id: string) => void;
  onWhatNow?: () => void;
  onOpenDecision?: (id: string) => void;
  // EMAIL-F-19: a conversation filed under a project opens in the Email tab.
  onGoEmail?: (threadId: string) => void;
}) {
  const [seg, setSeg] = useState<LifeSegment>(segment ?? lastSegment);
  const pick = (s: LifeSegment) => { lastSegment = s; setSeg(s); };
  // A deep link that arrives while this flow is mounted (What Now's Just
  // This One from the Goals lens, say) still wins, once.
  useEffect(() => { if (segment) pick(segment); }, [segment, segmentNav]);
  const segments = <LifeSegments value={seg} onPick={pick} />;
  if (seg === "areas") {
    return <AreasTab segments={segments} onOpenCategory={onOpenCategory ?? (() => {})} />;
  }
  if (seg === "reminders") {
    return <RemindersFlow chrome={{ segments }} onOpenEntity={onOpenEntity} />;
  }
  if (seg === "tasks") {
    return <TasksFlow title="Life" segments={segments} openId={taskOpenId} openNonce={taskNonce} onOpenConsumed={onTaskOpened} openFilter={taskFilter} filterNonce={filterNonce} onFilterApplied={onFilterApplied} onOpenNote={onOpenNote} onGoEmail={onGoEmail} onWhatNow={onWhatNow} />;
  }
  return (
    <BiggerPictureFlow
      key={seg}
      lens={seg}
      title="Life"
      segments={segments}
      openId={seg === "projects" ? projectOpenId : undefined}
      openNonce={projectNonce}
      onOpenConsumed={onProjectOpened}
      openGoalId={seg === "goals" ? goalOpenId : undefined}
      goalNonce={goalNonce}
      onGoalConsumed={onGoalOpened}
      onOpenNote={onOpenNote}
      onOpenDecision={onOpenDecision}
      onGoEmail={onGoEmail}
    />
  );
}
