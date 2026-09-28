// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StrandsPage, { receiptLine } from "./StrandsPage";
import BrainFlow from "../BrainFlow";
import { NotesProvider } from "../../data/NotesProvider";
import type { Strand } from "./types";
import "@testing-library/jest-dom";

// THE RECURRING LESSON (three times in this codebase): a tested function
// proves nothing about whether a screen reaches it. These render the real
// components through the real provider.

const strand = (over: Partial<Strand["data"]> = {}, id = "s1"): Strand => ({
  id,
  data: {
    text: "Gets things done mid morning", category: "energy", source: "watched",
    strength: "influence", status: "active", createdAt: "2026-08-01",
    lastConfirmed: "2026-08-20", derivation: "completion_window",
    evidence: [{ day: "2026-08-19", a: 9 }],
    ...over,
  },
});

const svc = {
  list: vi.fn(async () => [] as Strand[]),
  active: vi.fn(async () => [] as Strand[]),
  add: vi.fn(async () => "new"),
  accept: vi.fn(async () => "new"),
  edit: vi.fn(async () => {}),
  setStatus: vi.fn(async () => {}),
  setStrength: vi.fn(async () => {}),
  recategorize: vi.fn(async () => true),
  remove: vi.fn(async () => {}),
  confirm: vi.fn(async () => {}),
  setType: vi.fn(async () => {}),
};

// PICK 29 (2026-08-24): the Noticed offer moved off Today and onto this
// page, so this tree now reaches the services that offer feeds on. The mock
// listing only useStrands stopped describing the component the moment the
// page grew; these are the real hooks TodaySuggestions calls, stubbed to the
// quiet answer so the offer renders nothing and these tests keep testing
// strands. The AI is unavailable in the stub, which is the state Dave's
// device is in whenever the key is missing, and the correct one to test.
const quiet = {
  get: async () => null,
  save: async () => {},
  list: async () => [],
  listTasks: async () => [],
  listEvents: async () => [],
  setDue: async () => {},
};
vi.mock("../../data/NotesProvider", async (orig) => {
  const actual = await orig<typeof import("../../data/NotesProvider")>();
  // One object, not one per call: TodaySuggestions keys its load effect on
  // the service identities, as the real provider gives it stable ones. A
  // stub that minted a new routine service every render re-ran that effect
  // on every render, which was invisible while the offer had nothing to set
  // and became an infinite loop the first time a faded strand gave it a card.
  // Built on first call, because this factory is hoisted above `quiet`.
  let routine: (Omit<typeof quiet, "get"> & { get: () => Promise<{ protectedBlocks: never[] }> }) | null = null;
  return {
    ...actual,
    useStrands: () => svc,
    useOptionalStrands: () => svc,
    useTasks: () => quiet,
    useProfile: () => quiet,
    useBrainDocs: () => quiet,
    useSchedule: () => quiet,
    useRoutine: () => (routine ??= { ...quiet, get: async () => ({ protectedBlocks: [] }) }),
  };
});
vi.mock("../../ai/useAI", () => ({ useAI: () => ({ available: false, complete: async () => "" }) }));
// The detectors, as BrainTop.test stubs them: set `rows` for one test to put a
// watched fact past twice its gate; null leaves the real read in place.
let rows: import("../readiness").Readiness[] | null = null;
vi.mock("../readiness", async (orig) => {
  const actual = await orig<typeof import("../readiness")>();
  return { ...actual, readiness: (...a: Parameters<typeof actual.readiness>) => rows ?? actual.readiness(...a) };
});
// useAIContext reaches for the whole identity (people, profile, schedule,
// routine, money). It is only ever CALLED behind an ai.available gate, but
// the hook runs at the top of the component, so it is stubbed at the module
// rather than service by service.
vi.mock("../../ai/useAIContext", () => ({
  useAIContext: () => async () => ({}),
  todayISO: (d?: Date) => (d ?? new Date("2026-08-24T12:00:00")).toISOString().slice(0, 10),
}));

describe("StrandsPage renders the genome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.list.mockResolvedValue([]);
    rows = null;
  });

  // §AK one grey, pinned for the High row (the pass-off, 2026-09-26): a
  // watched fact past twice its gate reads LEARNED, a green High, and then
  // exactly one plain grey, its category. The count is the Learning Lab's.
  it("a Learned + High row carries one plain grey fact, the category", async () => {
    rows = [{ key: "completion_window", label: "When Tasks Get Done", have: 156, need: 10, unit: "completions", state: "known" }];
    svc.list.mockResolvedValue([strand()]);
    const { container } = render(<StrandsPage onBack={() => {}} />);
    await screen.findByText("Gets things done mid morning");
    const row = container.querySelector(".strand-row")!;
    await waitFor(() => expect(row.querySelector(".fact.good")).toHaveTextContent("High"));
    expect(row.querySelector(".fact.st")).toHaveTextContent("Learned");
    expect([...row.querySelectorAll(".fact:not(.st):not(.good):not(.warn):not(.red)")].map((e) => e.textContent)).toEqual(["Energy"]);
  });

  it("says something honest when there is nothing yet, and never fakes a fact", async () => {
    // The wording changed on 2026-09-20 and the intent did not. This used to
    // match /Nothing yet/, which was the opening of a three-sentence paragraph
    // written as raw JSX text -- invisible to the short-copy law, which reads
    // string literals -- and it also told him to use a control that is already
    // on the screen and says so itself. Title and sub now, as fragments.
    // What the test is for is unchanged: the screen admits it knows nothing,
    // and the way to teach it one thing is right there.
    render(<StrandsPage onBack={() => {}} />);
    await screen.findByText("Nothing Noticed Yet");
    expect(screen.getByText("Add One Thing")).toBeInTheDocument();
  });

  // C-40 (Astra, 2026-09-12): the state word says who said it, the bucket
  // says where it lives. "Energy · Watched" became LEARNED · Energy.
  it("shows each strand with its state word and its bucket", async () => {
    svc.list.mockResolvedValue([strand(), strand({ text: "Never schedule calls before 10", category: "work_style", source: "told", derivation: undefined }, "s2")]);
    const { container } = render(<StrandsPage onBack={() => {}} />);
    await screen.findByText("Gets things done mid morning");
    const rows = [...container.querySelectorAll(".strand-row")];
    expect(rows[0]?.querySelector(".fact.st")?.textContent).toBe("Learned");
    expect(rows[0]?.textContent).toContain("Energy");
    expect(rows[1]?.querySelector(".fact.st")?.textContent).toBe("Known");
    expect(rows[1]?.textContent).toContain("Work Style");
    // C-50: every strand row leads with the star, hollow until linked.
    expect(rows.every((r) => r.firstElementChild?.classList.contains("row-star"))).toBe(true);
    expect(container.querySelectorAll(".row-star.on").length).toBe(0);
  });

  it("the filter chips are choosers, and Needs Confirmation gathers what is fading (C-40, C-47)", async () => {
    svc.list.mockResolvedValue([strand(), strand({ text: "Admin happens Friday afternoons", category: "routine", lastConfirmed: "2026-05-01" }, "s2")]);
    const { container } = render(<StrandsPage onBack={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".strand-row").length).toBe(2));
    const fading = [...container.querySelectorAll(".strand-row")].find((r) => r.textContent?.includes("Admin happens"));
    expect(fading?.querySelector(".fact.st")?.textContent).toBe("Fading");
    // §AK one grey (2026-09-26): the bucket is the row's one plain grey. The
    // days unconfirmed were a second; Fading already says it, and the sheet
    // gives the day it was last confirmed.
    expect([...fading!.querySelectorAll(".fact:not(.st)")].map((e) => e.textContent)).toEqual(["Routine"]);
    expect(fading?.querySelector(".pill-act")?.textContent).toBe("Still True");
    fireEvent.click(screen.getByText("Needs Confirmation"));
    // TodaySuggestions offers the same faded fact as a card above the list,
    // so the list is read through its rows.
    const rowTexts = () => [...container.querySelectorAll(".strand-row")].map((r) => r.textContent ?? "");
    expect(rowTexts().some((t) => t.includes("Gets things done mid morning"))).toBe(false);
    expect(rowTexts().some((t) => t.includes("Admin happens Friday afternoons"))).toBe(true);
    fireEvent.click(container.querySelector(".strand-row .pill-act")!);
    await waitFor(() => expect(svc.confirm).toHaveBeenCalled());
  });

  it("the sheet says where the fact is used (C-43)", async () => {
    svc.list.mockResolvedValue([strand()]);
    render(<StrandsPage onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Gets things done mid morning"));
    await screen.findByText("Used By");
    // One fact with the list in it (§AK), not a plain grey per surface.
    expect(screen.getByText("Schedule, Plan My Day, Your Move")).toHaveClass("fact");
  });

  it("What Kind is a chooser on the sheet, and reaches the service only when chosen (C-42)", async () => {
    render(<StrandsPage onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Add One Thing"));
    fireEvent.change(await screen.findByPlaceholderText(/Brainstorms best at night/), { target: { value: "Family dinner is fixed" } });
    fireEvent.click(screen.getByText("Constraint"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(svc.add).toHaveBeenCalledWith("Family dinner is fixed", "work_style", expect.any(String), "influence", "constraint"));
  });

  it("opens the receipts, so a claim can always be checked", async () => {
    svc.list.mockResolvedValue([strand()]);
    render(<StrandsPage onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Gets things done mid morning"));
    await screen.findByText("Finished in the 9 AM Window");
    expect(screen.getByText("Aug 19")).toBeInTheDocument();
  });

  it("gives wrongness an exit on every strand", async () => {
    svc.list.mockResolvedValue([strand()]);
    render(<StrandsPage onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Gets things done mid morning"));
    await screen.findByText("Edit");
    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("delete actually calls the service, not just a dialog that closes", async () => {
    svc.list.mockResolvedValue([strand()]);
    render(<StrandsPage onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Gets things done mid morning"));
    fireEvent.click(await screen.findByText("Delete"));
    await waitFor(() => expect(svc.remove).toHaveBeenCalled());
  });

  it("a typed strand reaches the service with its category", async () => {
    render(<StrandsPage onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Add One Thing"));
    fireEvent.change(await screen.findByPlaceholderText(/Brainstorms best at night/), { target: { value: "Writes best at night" } });
    fireEvent.click(screen.getByText("Values"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(svc.add).toHaveBeenCalledWith("Writes best at night", "values", expect.any(String)));
  });

  it("a paused strand stays visible rather than disappearing", async () => {
    svc.list.mockResolvedValue([strand({ status: "paused" })]);
    const { container } = render(<StrandsPage onBack={() => {}} />);
    await screen.findByText("Gets things done mid morning");
    expect(container.querySelector(".strand-row.paused")).toBeTruthy();
  });
});

// S6-Q35 (2026-09-04): "Recent Captures rows do nothing." A fact tapped on
// that strip deep-links here via openId, the same async-safe shape
// PeopleFlow/DecisionsFlow already use: the target Strand is DERIVED from
// the loaded list every render, so it resolves correctly however the list's
// own async load and the deep link race.
describe("StrandsPage: openId deep-links straight to one strand (S6-Q35)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the matching strand's detail sheet once the list arrives", async () => {
    svc.list.mockResolvedValue([
      strand({ text: "Never schedule calls before 10", category: "work_style", source: "told", derivation: undefined }, "s2"),
      strand(),
    ]);
    const { container } = render(<StrandsPage openId="s2" onBack={() => {}} />);
    // Not present before the list resolves; appears once it does -- proves
    // the open is derived from live data, not captured once at mount.
    await waitFor(() => expect(container.querySelector(".strand-head")).toBeTruthy());
    expect(container.querySelector(".strand-head")?.textContent).toBe("Never schedule calls before 10");
    expect(screen.getByText("Edit")).toBeInTheDocument();
    // The OTHER strand's own row is on the list behind it, not the one open.
    expect(screen.getByText("Gets things done mid morning")).toBeInTheDocument();
  });

  it("an id that matches nothing opens nothing: the list renders, no dead sheet", async () => {
    svc.list.mockResolvedValue([strand()]);
    render(<StrandsPage openId="no-such-strand" onBack={() => {}} />);
    await screen.findByText("Gets things done mid morning");
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });
});

// S4-Q24 (2026-09-04): "a rule and a preference carry the same weight."
// add() has always accepted a strength argument; nothing on this page ever
// passed anything but its default, and edit had no way to change it either.
describe("Make It a Rule (S4-Q24)", () => {
  beforeEach(() => { vi.clearAllMocks(); svc.list.mockResolvedValue([]); });

  it("off by default: an ordinary fact reaches add() exactly as it always did, with no fourth argument", async () => {
    render(<StrandsPage onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Add One Thing"));
    fireEvent.change(await screen.findByPlaceholderText(/Brainstorms best at night/), { target: { value: "Writes best at night" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(svc.add).toHaveBeenCalledWith("Writes best at night", "work_style", expect.any(String)));
  });

  it("toggled on: a new fact is added as a rule", async () => {
    render(<StrandsPage onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Add One Thing"));
    fireEvent.change(await screen.findByPlaceholderText(/Brainstorms best at night/), { target: { value: "Family dinner is non-negotiable" } });
    fireEvent.click(screen.getByRole("switch", { name: "Make It a Rule" }));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(svc.add).toHaveBeenCalledWith("Family dinner is non-negotiable", "work_style", expect.any(String), "rule"));
  });

  it("shows Rule on the row and in the detail sheet for a strand already marked one", async () => {
    svc.list.mockResolvedValue([strand({ strength: "rule" })]);
    render(<StrandsPage onBack={() => {}} />);
    // On the row it is the RULE state word (C-40); the sheet keeps its eyebrow.
    await screen.findByText("Rule");
    fireEvent.click(screen.getByText("Gets things done mid morning"));
    // The eyebrow's separators are drawn by CSS (§AM F3), so the words are
    // three facts rather than one string with the dots typed in.
    await waitFor(() => expect([...document.querySelectorAll(".sheet-scrim .eyebrow .fact")].map((e) => e.textContent))
      .toEqual(["Energy", "Watched", "Rule"]));
    expect(document.querySelector(".sheet-scrim .eyebrow")?.textContent).not.toContain("·");
  });

  it("turning the toggle on for an existing fact and saving calls setStrength, once, with the strand", async () => {
    const s = strand({ strength: "influence" });
    svc.list.mockResolvedValue([s]);
    render(<StrandsPage onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Gets things done mid morning"));
    fireEvent.click(await screen.findByText("Edit"));
    fireEvent.click(screen.getByRole("switch", { name: "Make It a Rule" }));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(svc.setStrength).toHaveBeenCalledWith(s, "rule"));
  });

  it("turning the toggle off for a rule and saving reverts it to influence", async () => {
    const s = strand({ strength: "rule" });
    svc.list.mockResolvedValue([s]);
    render(<StrandsPage onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Gets things done mid morning"));
    fireEvent.click(await screen.findByText("Edit"));
    fireEvent.click(screen.getByRole("switch", { name: "Make It a Rule" }));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(svc.setStrength).toHaveBeenCalledWith(s, "influence"));
  });

  it("saving an edit with the toggle untouched never calls setStrength", async () => {
    const s = strand({ strength: "influence" });
    svc.list.mockResolvedValue([s]);
    render(<StrandsPage onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Gets things done mid morning"));
    fireEvent.click(await screen.findByText("Edit"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(svc.edit).toHaveBeenCalled());
    expect(svc.setStrength).not.toHaveBeenCalled();
  });
});

describe("the Brain hub actually reaches the page", () => {
  beforeEach(() => { vi.clearAllMocks(); svc.list.mockResolvedValue([]); });

  it("What JARVIS Knows opens the strands screen", async () => {
    render(
      <NotesProvider userId="u1">
        <BrainFlow />
      </NotesProvider>,
    );
    fireEvent.click(await screen.findByText("What JARVIS Knows"));
    // The row and the screen title share their words, so the proof the row
    // went somewhere is the page's own furniture.
    await screen.findByText("Add One Thing");
  });
});

// AMENDED 2026-09-26 (pass-off): a receipt is a grey sub line, so it is
// Title Case through lineCase ("45 Min", never "45 min").
describe("receiptLine speaks each derivation's own numbers", () => {
  it("renders a completion hour", () => {
    expect(receiptLine("completion_window", { day: "d", a: 14 })).toBe("Finished in the 2 PM Window");
  });
  it("renders a plan-rate day", () => {
    expect(receiptLine("plan_rate", { day: "d", a: 3, b: 4 })).toBe("3 of 4 Picks Done");
  });
  it("renders a timing overrun and an early finish", () => {
    expect(receiptLine("task_timing", { day: "d", a: 30 })).toBe("Ran 30 Min Past the Estimate");
    expect(receiptLine("task_timing", { day: "d", a: -15 })).toBe("Wrapped 15 Min Early");
  });
  // B5 (2026-09-04): these two fell through to "Seen" on every row, because
  // no case named them despite derive.ts writing the band hour the same way
  // completion_window does.
  it("renders the training and email band hours, not \"Seen\"", () => {
    expect(receiptLine("training_window", { day: "d", a: 18 })).toBe("Trained in the 6 PM Window");
    expect(receiptLine("email_window", { day: "d", a: 9 })).toBe("Handled Email in the 9 AM Window");
  });
  it("never invents a receipt it cannot render", () => {
    expect(receiptLine(undefined, { day: "d" })).toBe("Seen");
    expect(receiptLine("plan_rate", { day: "d" })).toBe("Seen");
  });
});

// BRAIN-F-12 (2026-09-05): "Add One Thing" stuck on "Saving..." after a
// dropped connection. The write had no guard, so a throw skipped the reset
// and the only exit was leaving the page, which loses what was typed.
import { WRITE_FAILED_MESSAGE } from "../../shared/guard";
import { subscribeToast, resetToasts } from "../../shared/toast";

describe("StrandsPage write guard (BRAIN-F-12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // SHARED-F-09 (2026-09-05): a toast carrying an action is no longer evicted
    // by a plain one, it holds the slot until its timer or its action. The
    // Forget case above leaves exactly such a toast ("Forgotten" with Undo) in
    // flight, so without this reset the failure message these two cases are
    // waiting for is correctly QUEUED rather than shown, and they time out
    // against the previous test's receipt. resetToasts exists for this.
    resetToasts();
    svc.list.mockResolvedValue([]);
  });

  it("a failed add says so and gives the button back, with the typing still there", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    try {
      svc.add.mockRejectedValueOnce(new Error("offline"));
      render(<StrandsPage onBack={() => {}} />);
      fireEvent.click(await screen.findByText("Add One Thing"));
      fireEvent.change(await screen.findByPlaceholderText(/Brainstorms best at night/), { target: { value: "Writes best at night" } });
      fireEvent.click(screen.getByText("Save"));
      await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
      await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());
      expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
      expect(screen.getByDisplayValue("Writes best at night")).toBeInTheDocument();
    } finally {
      stop();
    }
  });

  it("a failed pause says so and does not close over a strand that is still active", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    try {
      svc.list.mockResolvedValue([strand()]);
      svc.setStatus.mockRejectedValueOnce(new Error("offline"));
      render(<StrandsPage onBack={() => {}} />);
      fireEvent.click(await screen.findByText("Gets things done mid morning"));
      fireEvent.click(await screen.findByText("Pause"));
      await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
      expect(screen.getByText("Pause")).toBeInTheDocument();
    } finally {
      stop();
    }
  });
});

// WHY IS THIS LIST NOT GROWING (Dave 2026-09-06: "i dont see any trace of
// jarvis learning anything. theres 1 fact in what jarvis knows about me").
//
// The readiness panel is only worth building if the screen actually reaches
// it, which is the lesson this codebase has learned three times. These render
// the real StrandsPage through the real provider and read the rows back.
// C-39 (Astra, 2026-09-12): the instrument moved to the Learning Lab under
// Settings (settings/LearningLabPage.test.tsx carries its tests). This page
// says one word per detector and where the numbers went.
describe("What JARVIS Knows says one word per detector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.list.mockResolvedValue([]);
    try { localStorage.clear(); } catch { /* private mode */ }
  });

  it("gives every detector a row with a word, and no sentence", async () => {
    const { container } = render(<StrandsPage onBack={() => {}} />);
    await screen.findByText("Readiness");
    for (const label of [
      "When Tasks Get Done", "The Area That Slips", "Whether Plans Finish",
      "When You Train", "When Email Gets Done", "The Person You Email Most",
      "Who Has Gone Quiet", "How Long Tasks Take",
    ]) {
      expect(screen.getByText(label), label + " lost its row").toBeInTheDocument();
    }
    const words = [...container.querySelectorAll(".rdy-row .fact.st")].map((e) => e.textContent);
    expect(words.length).toBe(8);
    expect(words.every((w) => w === "Known" || w === "Close" || w === "Waiting")).toBe(true);
    expect(container.querySelectorAll(".rdy-why").length).toBe(0);
    expect(screen.getByText(/Numbers behind each gate/)).toBeInTheDocument();
  });

  it("a fact JARVIS already knows reads Known", async () => {
    svc.list.mockResolvedValue([strand()]); // derivation: completion_window
    const { container } = render(<StrandsPage onBack={() => {}} />);
    await screen.findByText("When Tasks Get Done");
    const row = [...container.querySelectorAll(".rdy-row")].find((e) => e.textContent?.includes("When Tasks Get Done"));
    expect(row?.querySelector(".fact.st")?.textContent).toBe("Known");
    expect(row?.querySelector(".fact.st")?.className).toContain("good");
  });
});
