// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StartScreen from "./StartScreen";
import { startAction, type StartTarget } from "../startAction";
import { START_KEY, loadSession, saveSession } from "../startStore";

const target: StartTarget = {
  kind: "task", id: "t1", title: "Send team practice details",
  data: { text: "Send team practice details", category: "life", done: false },
};

const grounded = startAction(target, {
  grounding: {
    lines: ["Hi everyone,", "Practice is Saturday at 2:00 PM."],
    sources: [{ kind: "event", id: "e1", label: "Source: Saturday practice" }],
    missing: ["Location still needed"],
  },
});

const noop = async () => null;

beforeEach(() => { localStorage.removeItem(START_KEY); });

describe("StartScreen: one tap lands on something workable", () => {
  it("puts the prepared draft on screen, names its hole, and says what Save will not do", () => {
    render(<StartScreen target={target} action={grounded} onDraftChange={() => {}} onPrimary={noop}
      onBack={() => {}} onInTheWay={() => {}} />);
    expect(screen.getByText("Send team practice details")).toBeInTheDocument();
    expect(screen.getByText("Review a prepared message")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("Hi everyone,\n\nPractice is Saturday at 2:00 PM.");
    // The hole is named, not filled.
    expect(screen.getByText("Location still needed")).toBeInTheDocument();
    // The one primary says exactly what it does, and the line under it says
    // what it does not.
    expect(screen.getByText("Save Draft")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent here/)).toBeInTheDocument();
  });

  it("never starts a clock: the timer is a row you have to press", () => {
    const onStartTimer = vi.fn();
    const { container } = render(<StartScreen target={target} action={grounded} onDraftChange={() => {}}
      onPrimary={noop} onBack={() => {}} onInTheWay={() => {}} onStartTimer={onStartTimer} />);
    expect(onStartTimer).not.toHaveBeenCalled();
    // Nothing counts down anywhere in the screen's own chrome. The draft is
    // excluded because a practice time is the MESSAGE saying 2:00 PM, which
    // is the opposite of the app putting a clock on him.
    const chrome = [...container.querySelectorAll("*")]
      .filter((el) => el.tagName !== "TEXTAREA" && !el.querySelector("*"))
      .map((el) => el.textContent ?? "").join(" ");
    expect(chrome).not.toMatch(/\d+:\d\d/);
    expect(chrome).not.toMatch(/remaining|left\b|counting/i);
    fireEvent.click(screen.getByText("Start It"));
    expect(onStartTimer).toHaveBeenCalledTimes(1);
  });

  it("finishing is a separate act, and saving is not it", async () => {
    const onFinish = vi.fn();
    const onPrimary = vi.fn(async () => "Saved to this task · Not sent");
    render(<StartScreen target={target} action={grounded} onDraftChange={() => {}} onPrimary={onPrimary}
      onBack={() => {}} onInTheWay={() => {}} onFinish={onFinish} />);
    fireEvent.click(screen.getByText("Save Draft"));
    await waitFor(() => expect(onPrimary).toHaveBeenCalled());
    expect(onFinish, "saving a draft never finishes the task").not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Finish"));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("a failed save keeps his words on screen", async () => {
    render(<StartScreen target={target} action={grounded} onDraftChange={() => {}}
      onPrimary={async () => null} onBack={() => {}} onInTheWay={() => {}} />);
    fireEvent.click(screen.getByText("Save Draft"));
    await waitFor(() => expect(screen.getByText("Save Draft")).toBeEnabled());
    expect(screen.getByRole("textbox")).toHaveValue("Hi everyone,\n\nPractice is Saturday at 2:00 PM.");
  });

  it("a late re-resolve never overwrites words already being typed", () => {
    const { rerender } = render(<StartScreen target={target} action={grounded} onDraftChange={() => {}}
      onPrimary={noop} onBack={() => {}} onInTheWay={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "My own words" } });
    // The AI enhancement lands a beat later with a different seed.
    const late = { ...grounded, seed: "A model wrote this instead" };
    rerender(<StartScreen target={target} action={late} onDraftChange={() => {}}
      onPrimary={noop} onBack={() => {}} onInTheWay={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveValue("My own words");
  });

  it("leaving keeps the place and never demands a note first", () => {
    const onBack = vi.fn();
    render(<StartScreen target={target} action={grounded} onDraftChange={() => {}} onPrimary={noop}
      onBack={onBack} onInTheWay={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hi everyone,\n\nWe moved to the north field" } });
    fireEvent.click(screen.getByText("All Tasks"));
    // It leaves on one tap, carrying a stopping point suggested from the
    // real last line rather than asked for.
    expect(onBack).toHaveBeenCalledWith("We moved to the north field");
  });
});

describe("StartScreen: the ways out are subordinate", () => {
  it("Make this smaller simplifies the action, and stops rather than looping", () => {
    render(<StartScreen target={target} action={grounded} onDraftChange={() => {}} onPrimary={noop}
      onBack={() => {}} onInTheWay={() => {}} />);
    fireEvent.click(screen.getByText("Make this smaller"));
    // The named hole becomes the whole ask, and the task is untouched.
    expect(screen.getByText("One detail first")).toBeInTheDocument();
    expect(screen.getByText("Send team practice details")).toBeInTheDocument();
    // It does not loop forever into ever tinier instructions.
    let guard = 0;
    while (screen.queryByText("Make this smaller") && guard < 6) {
      fireEvent.click(screen.getByText("Make this smaller"));
      guard += 1;
    }
    expect(guard).toBeLessThan(6);
    expect(screen.queryByText("Make this smaller")).toBeNull();
  });

  it("Something's in the way offers four answers, not a questionnaire", () => {
    const onInTheWay = vi.fn();
    render(<StartScreen target={target} action={grounded} onDraftChange={() => {}} onPrimary={noop}
      onBack={() => {}} onInTheWay={onInTheWay} />);
    fireEvent.click(screen.getByText("Something’s in the way"));
    for (const o of ["Too Big", "Missing Information", "Different Task", "Stop Here"]) {
      expect(screen.getByText(o)).toBeInTheDocument();
    }
    // Nothing asks for mood, energy, difficulty or a duration.
    expect(document.body.textContent).not.toMatch(/energy|mood|difficulty|how long|how hard/i);
    fireEvent.click(screen.getByText("Missing Information"));
    expect(onInTheWay).toHaveBeenCalledWith("Missing Information", expect.any(String));
  });

  it("a physical move shows the move and offers no text box to fill", () => {
    const physical: StartTarget = { kind: "task", id: "t2", title: "Pack for practice",
      data: { text: "Pack for practice", category: "life", done: false } };
    render(<StartScreen target={physical} action={startAction(physical)} onDraftChange={() => {}}
      onPrimary={noop} onBack={() => {}} onInTheWay={() => {}} />);
    expect(screen.getByText("Put what you need for practice within reach")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Mark It Done")).toBeInTheDocument();
    expect(screen.getByText(/The task stays open/)).toBeInTheDocument();
  });

  it("a resource opens the real record instead of describing it", () => {
    const onOpen = vi.fn();
    const a = startAction(target, { resource: { kind: "note", id: "n1", label: "Practice note" } });
    render(<StartScreen target={target} action={a} onDraftChange={() => {}} onPrimary={noop}
      onOpenDestination={onOpen} onBack={() => {}} onInTheWay={() => {}} />);
    fireEvent.click(screen.getByText("Open Note"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("StartScreen: repeated Start makes no second workspace", () => {
  it("one seat per task, however many times it is opened", () => {
    const save = (text: string) => saveSession("t1", { kind: "prepare_draft", draft: text });
    const { unmount } = render(<StartScreen target={target} action={grounded}
      onDraftChange={save} onPrimary={noop} onBack={() => {}} onInTheWay={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "first pass" } });
    unmount();

    // Opened again: the same seat, and what he typed is what comes back.
    const resumed = startAction(target, { saved: loadSession("t1") });
    render(<StartScreen target={target} action={resumed} onDraftChange={save} onPrimary={noop}
      onBack={() => {}} onInTheWay={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveValue("first pass");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "second pass" } });
    const all = JSON.parse(localStorage.getItem(START_KEY) || "{}") as Record<string, unknown>;
    expect(Object.keys(all)).toEqual(["t1"]);
    expect(loadSession("t1")?.draft).toBe("second pass");
  });
});
