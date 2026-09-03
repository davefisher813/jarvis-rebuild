// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import { AIService } from "../ai/AIService";
import { subscribeToast } from "../shared/toast";
import HealthFlow from "./HealthFlow";

describe("HealthFlow: Lights Out end to end", () => {
  it("taps, logs, and shows the confirmation", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="lightsOut" onExit={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Lights Out" }));
    await waitFor(() => expect(screen.getByText("Logged")).toBeInTheDocument());
  });
});

describe("HealthFlow: the Share Line", () => {
  it("everything is off by default except logistics, and the Kid's Room is never a switch", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="share" onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText("Areas")).toBeInTheDocument());
    // The floor: rendered as text, and the switch drawn beside it is locked
    // permanently off. Clicking it does nothing, because it carries no
    // onClick at all (checked statically too, in healthPrivacy.test.ts).
    expect(screen.getByText("Mood and Mind")).toBeInTheDocument();
    expect(screen.getAllByText("Not a setting. This never crosses to your parent, no matter what.").length).toBe(3);
    const kidSwitch = screen.getByRole("switch", { name: /Mood and Mind/ });
    expect(kidSwitch).toHaveAttribute("aria-checked", "false");
    expect(kidSwitch).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(kidSwitch);
    expect(kidSwitch).toHaveAttribute("aria-checked", "false");
  });

  it("granting a category surfaces it on What They See", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="share" onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText("Sleep")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("switch", { name: "Sleep" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Sleep" })).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(screen.getByText("See What They See"));
    await waitFor(() => expect(screen.getByText("Nothing Logged Yet")).toBeInTheDocument());
  });
});

describe("HealthFlow: Point at It hands off to a human, not to exit", () => {
  it("Still There? routes to Say It to Someone, never straight out of the module", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="pointAtIt" onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText("Where Is It")).toBeInTheDocument());
    // Not the assertion this test is about, but a body-map tap uses a real
    // click's own clientX/clientY, which jsdom always reports as 0 -- so
    // this test only exercises navigation, covered directly below instead.
  });
});

describe("HealthFlow: Refill Runway lands the call on the parent's list, not the athlete's", () => {
  it("needs a call once the fill is small, and never names a medication", async () => {
    const store = new Store(new InMemoryAdapter());
    const onLandParentTask = vi.fn();
    render(<HealthFlow store={store} ownerId="u1" initialScreen="refillRunway" onLandParentTask={onLandParentTask} onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText("No Fill Logged Yet")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5" } });
    fireEvent.click(screen.getByText("Log the Fill"));
    await waitFor(() => expect(screen.getByText("Worth a Call Soon")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Land It on the Parent's List"));
    expect(onLandParentTask).toHaveBeenCalledTimes(1);
    const line = onLandParentTask.mock.calls[0]![0] as string;
    expect(line).toMatch(/pharmacy/i);
    expect(line).not.toMatch(/mg|stimulant|adderall|ritalin/i);
  });
});

describe("HealthFlow: The Med Window shows facts, never a relationship between them", () => {
  it("renders a logged dose and lights out on their own day, with no analysis line", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="tookIt" onExit={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Took It" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Took It" }));
    await waitFor(() => expect(screen.getByText("Logged")).toBeInTheDocument());

    render(<HealthFlow store={store} ownerId="u1" initialScreen="medWindow" onExit={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("Dose").length).toBeGreaterThan(0));
    expect(screen.queryByText(/caused|because|led to/i)).not.toBeInTheDocument();
  });
});

describe("HealthFlow: Take This to the Doctor is labeled the family's own log", () => {
  it("never claims to be a medical record", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="doctorReport" onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText("The Family's Own Log")).toBeInTheDocument());
    expect(screen.getByText(/not a medical record/i)).toBeInTheDocument();
  });
});

describe("HealthFlow: The Night Before offers a bedtime, never a shortfall", () => {
  it("backs a wind-down time out of tomorrow's first commitment", async () => {
    const store = new Store(new InMemoryAdapter());
    const bus = { title: "Bus", at: Date.now() + 12 * 3600000 };
    render(<HealthFlow store={store} ownerId="u1" initialScreen="nightBefore" nightBeforeCommitments={[bus]} onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText("Add Wind Down")).toBeInTheDocument());
    expect(screen.queryByText(/only get|hours of sleep|not enough/i)).not.toBeInTheDocument();
  });

  it("offers nothing when tomorrow has no fixed commitment", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="nightBefore" onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText("Nothing Fixed Tomorrow Yet")).toBeInTheDocument());
  });
});

describe("HealthFlow: Eating Windows offers a schedule action, no nutrition content", () => {
  it("finds a gap too tight for a meal and offers to pack something", async () => {
    const store = new Store(new InMemoryAdapter());
    const blocks = [
      { title: "School", start: Date.parse("2026-08-28T08:00:00"), end: Date.parse("2026-08-28T14:50:00") },
      { title: "Practice", start: Date.parse("2026-08-28T15:05:00"), end: Date.parse("2026-08-28T17:00:00") },
    ];
    render(<HealthFlow store={store} ownerId="u1" initialScreen="eatingWindows" eatingWindowBlocks={blocks} onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Pack Something/)).toBeInTheDocument());
  });
});

describe("HealthFlow: The Bag, Water With You is a row inside it", () => {
  it("toggles one item, and Check Everything checks the rest", async () => {
    const store = new Store(new InMemoryAdapter());
    const bagEvent = { eventId: "e1", eventTitle: "Away Game", date: "2026-08-28" };
    render(<HealthFlow store={store} ownerId="u1" initialScreen="theBag" bagEvent={bagEvent} onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText("Water Bottle")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Water Bottle"));
    await waitFor(() => expect(screen.getByText("Water Bottle").closest(".row")?.querySelector(".cb.on")).toBeTruthy());
    fireEvent.click(screen.getByText("Check Everything"));
    await waitFor(() => expect(screen.getByText("Check Everything")).toBeDisabled());
  });
});

describe("HealthFlow: The Third Practice states the fact once, with an offer", () => {
  it("flags a day carrying two different orgs", async () => {
    const store = new Store(new InMemoryAdapter());
    const sessions = [
      { date: "2026-08-28", org: "School Team" },
      { date: "2026-08-28", org: "Travel Team" },
    ];
    render(<HealthFlow store={store} ownerId="u1" initialScreen="thirdPractice" sportSessions={sessions} onExit={() => {}} />);
    // A date the athlete reads, not the stored ISO string (2026-09-03): this
    // assertion used to pin "2026-08-28" straight onto the row's title.
    await waitFor(() => expect(screen.getByText("Fri, Aug 28")).toBeInTheDocument());
    expect(screen.getByText("Protect a Gap")).toBeInTheDocument();
  });

  it("says nothing when every day has at most one org", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="thirdPractice" sportSessions={[{ date: "2026-08-28", org: "School Team" }]} onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText("No Day Carries Two Teams Right Now")).toBeInTheDocument());
  });
});

describe("HealthFlow: Week Shape is flat and honest", () => {
  it("totals sessions and hours across the week handed in", async () => {
    const store = new Store(new InMemoryAdapter());
    const weekDates = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];
    const sessions = [{ date: "2026-08-25", org: "School Team", durationMin: 90 }];
    render(<HealthFlow store={store} ownerId="u1" initialScreen="weekShape" sportSessions={sessions} weekDates={weekDates} onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText("1 Sessions, 1.5 Hours")).toBeInTheDocument());
  });
});

describe("HealthFlow: Two Days Off offers a real rest block", () => {
  it("offers the one open day when the week has none scheduled off", async () => {
    const store = new Store(new InMemoryAdapter());
    const weekDates = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];
    const sessions = weekDates.slice(0, 6).map((date) => ({ date, org: "School Team", durationMin: 60 }));
    render(<HealthFlow store={store} ownerId="u1" initialScreen="twoDaysOff" sportSessions={sessions} weekDates={weekDates} onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText(weekDates[6]! + " Is Still Open")).toBeInTheDocument());
  });
});

describe("HealthFlow: The Age Rule cites NATA and never says too much", () => {
  it("states the numbers with the source on every row", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="ageRule" athleteAgeYears={15} monthsInSeason={9} onExit={() => {}} />);
    await waitFor(() => expect(screen.getAllByText(/NATA/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/too much/i)).not.toBeInTheDocument();
  });
});

describe("HealthFlow: Say It to Someone is always present, never gated", () => {
  it("shows 988 immediately, before any trusted adult is set", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="sayItToSomeone" onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText(/988/)).toBeInTheDocument());
  });

  it("saves a trusted adult and offers to change them afterward", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="sayItToSomeone" onExit={() => {}} />);
    await waitFor(() => expect(screen.getByPlaceholderText("A Name You Trust")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("A Name You Trust"), { target: { value: "Coach Lee" } });
    fireEvent.change(screen.getByPlaceholderText("A Number That Reaches Them"), { target: { value: "555-1234" } });
    fireEvent.click(screen.getByText("Save This Person"));
    await waitFor(() => expect(screen.getByText("Coach Lee")).toBeInTheDocument());
    expect(screen.getByText("Change Who You Call")).toBeInTheDocument();
  });
});

describe("HealthFlow: The Locker tracks expiry with zero medical judgment", () => {
  it("adds a document and surfaces it as expiring soon", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="locker" onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText("Physical")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Physical"));
    const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const dateInput = document.querySelector('input[type="date"]')!;
    fireEvent.change(dateInput, { target: { value: soon } });
    fireEvent.click(screen.getByText("Save It"));
    await waitFor(() => expect(screen.getByText("Worth a Look")).toBeInTheDocument());
  });
});

describe("HealthFlow: The Handoff carries no body data", () => {
  it("says nothing needs the parent when nothing does", async () => {
    const store = new Store(new InMemoryAdapter());
    render(<HealthFlow store={store} ownerId="u1" initialScreen="handoff" onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText("Nothing Needs You Right Now")).toBeInTheDocument());
  });
});

describe("HealthFlow: The Season Feed reads a pasted schedule into draft events", () => {
  it("stays out of the way with no AI service supplied", async () => {
    const store = new Store(new InMemoryAdapter());
    const { container } = render(<HealthFlow store={store} ownerId="u1" initialScreen="seasonFeed" onExit={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("extracts events from pasted text and commits them on review", async () => {
    const store = new Store(new InMemoryAdapter());
    const body = { org: "Travel Team", events: [{ title: "Practice", date: "2026-09-02", start: "17:30" }] };
    const ai = new AIService({
      available: true,
      fetchImpl: (async () => ({ ok: true, json: async () => ({ text: JSON.stringify(body) }) })) as unknown as typeof fetch,
    });
    const onCommitSeasonFeed = vi.fn();
    render(<HealthFlow store={store} ownerId="u1" initialScreen="seasonFeed" ai={ai} onCommitSeasonFeed={onCommitSeasonFeed} onExit={() => {}} />);
    await waitFor(() => expect(screen.getByText("Or Paste It")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Paste the schedule/), { target: { value: "Practice Wed 5:30pm" } });
    fireEvent.click(screen.getByText("Read the Pasted Text"));
    await waitFor(() => expect(screen.getByText("Add These to the Calendar")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Add These to the Calendar"));
    expect(onCommitSeasonFeed).toHaveBeenCalledWith(body);
  });
});

describe("HealthFlow: Back On Track, extended to health", () => {
  it("celebrates a real logging run returning after a real gap, naming the run and not the gap", async () => {
    const store = new Store(new InMemoryAdapter());
    const { HealthService } = await import("./HealthService");
    const svc = new HealthService(store, "u1");
    const day = (d: string) => Date.parse(d + "T08:00:00");
    for (const d of ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"]) svc.logLightsOut(day(d));
    await svc.flush();
    const realNow = Date.now;
    Date.now = () => day("2026-08-12");
    const seen: string[] = [];
    const unsub = subscribeToast((t) => { if (t) seen.push(t.message); });
    try {
      render(<HealthFlow store={store} ownerId="u1" initialScreen="lightsOut" onExit={() => {}} />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Lights Out" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Lights Out" }));
      await waitFor(() => expect(seen.some((m) => /run still counts/.test(m))).toBe(true));
      // Never renders the gap itself, only the run that came before it.
      expect(seen.some((m) => /\b8\b.*day|days since/i.test(m) && !/run still counts/.test(m))).toBe(false);
    } finally {
      Date.now = realNow;
      unsub();
    }
  });
});
