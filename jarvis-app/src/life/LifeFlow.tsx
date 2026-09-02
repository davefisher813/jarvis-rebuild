import { useEffect, useState } from "react";
import TasksFlow from "../tasks/TasksFlow";
import BiggerPictureFlow from "../bigger/BiggerPictureFlow";
import LifeSegments, { type LifeSegment } from "./LifeSegments";

// LIFE (ruled 2026-09-01): Tasks and Your Life, one tab. This flow owns only
// the segment; each lens keeps its own flow, sheets, deep links and data, so
// nothing that worked on either page had to move to make them one page.
//
// The segment is remembered within the session and reset on launch. A deep
// link (a task, a project, a goal) picks the segment it needs and wins over
// the memory, once.
let lastSegment: LifeSegment = "tasks";

export default function LifeFlow({
  segment, segmentNav, taskOpenId, taskFilter, projectOpenId, goalOpenId, onOpenNote, onWhatNow, onOpenDecision,
}: {
  segment?: LifeSegment;
  /** Bumped by the shell on every deep link, so a link to the lens already
   *  remembered still moves a page that has since changed lens. */
  segmentNav?: number;
  taskOpenId?: string; taskFilter?: string;
  projectOpenId?: string; goalOpenId?: string;
  onOpenNote?: (id: string) => void;
  onWhatNow?: () => void;
  onOpenDecision?: (id: string) => void;
}) {
  const [seg, setSeg] = useState<LifeSegment>(segment ?? lastSegment);
  const pick = (s: LifeSegment) => { lastSegment = s; setSeg(s); };
  // A deep link that arrives while this flow is mounted (What Now's Just
  // This One from the Goals lens, say) still wins, once.
  useEffect(() => { if (segment) pick(segment); }, [segment, segmentNav]);
  const segments = <LifeSegments value={seg} onPick={pick} />;
  if (seg === "tasks") {
    return <TasksFlow title="Life" segments={segments} openId={taskOpenId} openFilter={taskFilter} onOpenNote={onOpenNote} onWhatNow={onWhatNow} />;
  }
  return (
    <BiggerPictureFlow
      key={seg}
      lens={seg}
      title="Life"
      segments={segments}
      openId={seg === "projects" ? projectOpenId : undefined}
      openGoalId={seg === "goals" ? goalOpenId : undefined}
      onOpenNote={onOpenNote}
      onOpenDecision={onOpenDecision}
    />
  );
}
