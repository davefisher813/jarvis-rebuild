// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReminderDetailSheet from "./ReminderDetailSheet";
import type { TaskItem } from "../TasksService";
import type { ReminderInfo } from "../../notes/types";

// REMINDER DETAILS (push E): the rows, the one filled action, the four
// answers, and More Actions at the foot.
const item = (r: ReminderInfo, text = "Bridge Planning", id = "r1"): TaskItem =>
  ({ id, data: { text, category: "", done: false, reminder: r } } as TaskItem);
const TUE = "2026-09-15";
const noop = () => {};
const base = { today: TUE, now: "09:30", onClose: noop, onComplete: noop, onSnooze: noop, onEdit: noop, onPause: noop, onSkip: noop, onKeepSchedule: noop, onDelete: noop };

describe("ReminderDetailSheet", () => {
  it("reads When, Repeat, Follow-up and Opens, leads with the linked verb, and never completes on open", () => {
    const onOpenLinked = vi.fn(); const onComplete = vi.fn();
    const link = { type: "task" as const, id: "t1", label: "Bridge Priorities" };
    render(<ReminderDetailSheet {...base} item={item({ time: "09:00", days: [1, 2, 3, 4, 5], linkedItem: link })} onOpenLinked={onOpenLinked} onComplete={onComplete} />);
    expect(screen.getByText("Today · 9:00 AM")).toBeInTheDocument();
    expect(screen.getByText("Weekdays")).toBeInTheDocument();
    expect(screen.getByText("Once After 15 Minutes")).toBeInTheDocument();
    expect(screen.getByText("Bridge Priorities")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open Task"));
    expect(onOpenLinked).toHaveBeenCalledWith(link);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("with no link the filled action is Mark Done; Snooze, Edit, Pause and Skip Today are the answers", () => {
    const onComplete = vi.fn(); const onSnooze = vi.fn(); const onEdit = vi.fn(); const onPause = vi.fn(); const onSkip = vi.fn();
    render(<ReminderDetailSheet {...base} item={item({ time: "21:00", onMiss: "let_go" })} onComplete={onComplete} onSnooze={onSnooze} onEdit={onEdit} onPause={onPause} onSkip={onSkip} />);
    fireEvent.click(screen.getByText("Mark Done"));
    expect(onComplete).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByText("Snooze"));
    expect(onSnooze).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByText("Edit"));
    expect(onEdit).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getAllByText("Pause")[0]!);
    expect(onPause).toHaveBeenCalledWith("r1", true);
    fireEvent.click(screen.getByText("Skip Today"));
    expect(onSkip).toHaveBeenCalledWith("r1", TUE);
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("More Actions holds Export and Delete; a paused reminder offers Resume; a done one Reopen", () => {
    const onExport = vi.fn(); const onDelete = vi.fn(); const onPause = vi.fn(); const onComplete = vi.fn();
    const r = render(<ReminderDetailSheet {...base} item={item({ time: "21:00" })} onExport={onExport} onDelete={onDelete} />);
    fireEvent.click(screen.getByText("Export to Calendar"));
    expect(onExport).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByText("Delete Reminder"));
    expect(onDelete).toHaveBeenCalledWith("r1");
    r.unmount();
    const p = render(<ReminderDetailSheet {...base} item={item({ time: "21:00", paused: true })} onPause={onPause} />);
    fireEvent.click(screen.getByText("Resume Reminder"));
    expect(onPause).toHaveBeenCalledWith("r1", false);
    expect(screen.queryByText("Mark Done")).toBeNull();
    p.unmount();
    render(<ReminderDetailSheet {...base} item={item({ time: "07:00", lastDone: TUE })} onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Reopen Occurrence"));
    expect(onComplete).toHaveBeenCalledWith("r1");
    expect(screen.getByText("Done Today")).toBeInTheDocument();
  });

  it("advice and history show when there is evidence", () => {
    const onKeep = vi.fn();
    const history = ["a", "b", "c"].map((at) => ({ at, kind: "snoozed" as const }));
    render(<ReminderDetailSheet {...base} item={item({ time: "21:00", history })} onKeepSchedule={onKeep} />);
    expect(screen.getByText("Snoozed the last 3 times · Choose a better time?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Keep Schedule"));
    expect(onKeep).toHaveBeenCalledWith("r1");
    expect(screen.getByText("History")).toBeInTheDocument();
  });
});
