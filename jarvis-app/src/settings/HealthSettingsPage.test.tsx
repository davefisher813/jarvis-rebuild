// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Capacitor } from "@capacitor/core";
import HealthSettingsPage from "./HealthSettingsPage";
import { readHealthSettings, SHORTCUTS, WORKING_SHORTCUTS } from "../health/settings";
import { readGymSettings } from "../gym/settings";

// Health Push C, H-40 (2026-09-12).
beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("HealthSettingsPage", () => {
  it("toggling a shortcut writes through, and turning Water on seeds its metric", () => {
    const onEnableWater = vi.fn();
    render(<HealthSettingsPage onBack={() => {}} onEnableWater={onEnableWater} />);
    // 2026-09-14: the reference's four are on by default, Water among them.
    expect(screen.getByRole("button", { name: "Water" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Water" }));
    // The stored list keeps the keys no chip is offered for (2026-10-04).
    expect(readHealthSettings().shortcuts).toEqual(["bedtime", "meal", "checkin"]);
    expect(onEnableWater).toHaveBeenCalledTimes(0);
    fireEvent.click(screen.getByRole("button", { name: "Water" }));
    expect(readHealthSettings().shortcuts).toEqual(["bedtime", "meal", "checkin", "water"]);
    expect(onEnableWater).toHaveBeenCalledTimes(1);
  });

  // 2026-10-04 (audit): the Bedtime, Meal, Check In, Session Effort,
  // Discomfort and Medication chips wrote a list that nothing read. Log
  // Something lists every logger whatever the chips say (the approved design
  // of 2026-09-14), so the page offers a chip only for what still changes
  // something: Water, which adds its row there.
  it("offers a shortcut chip only for what a chip still changes, which is Water", () => {
    render(<HealthSettingsPage onBack={() => {}} />);
    const chips = screen.getByRole("group", { name: "Shortcuts" });
    expect([...chips.querySelectorAll("[role=button]")].map((c) => c.textContent)).toEqual(["Water"]);
    for (const gone of ["Bedtime", "Meal", "Check In", "Session Effort", "Discomfort", "Medication"]) {
      expect(screen.queryByRole("button", { name: gone }), gone + " changes nothing, so it is not a chip").toBeNull();
    }
    // Every chip on offer is a real shortcut key, and the page hint does not
    // promise tiles that are not there.
    expect(WORKING_SHORTCUTS.every((k) => SHORTCUTS.some((s) => s.key === k))).toBe(true);
    expect(document.body.textContent).not.toContain("The tiles under Daily Log");
    expect(document.body.textContent).toContain("Water adds a row to Log Something");
  });

  it("the session switches write the health store, and Last Time writes the gym store", () => {
    render(<HealthSettingsPage onBack={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Celebrations" }));
    expect(readHealthSettings().celebrations).toBe(false);
    fireEvent.click(screen.getByRole("switch", { name: "Rest Timer Sound" }));
    expect(readHealthSettings().restSound).toBe(false);
    fireEvent.click(screen.getByRole("switch", { name: "Last Time on Every Set" }));
    expect(readGymSettings().showLast).toBe(false);
  });

  // The Program Suggestion (2026-10-10, the workout-first flow) is on until he turns it off here.
  it("Suggest Programs is on by default and writes the gym store", () => {
    render(<HealthSettingsPage onBack={() => {}} />);
    const sw = screen.getByRole("switch", { name: "Suggest Programs" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(readGymSettings().suggestPrograms).toBe(false);
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(readGymSettings().suggestPrograms).toBe(true);
  });

  it("the weekly sets band is his to set, and the studied range is one tap back", () => {
    render(<HealthSettingsPage onBack={() => {}} />);
    expect(screen.queryByText("Use the Studied Range")).toBeNull();
    fireEvent.change(screen.getByLabelText("Weekly sets low"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Weekly sets high"), { target: { value: "18" } });
    expect(readHealthSettings().volumeBand).toEqual({ low: 12, high: 18 });
    // A band that makes no sense never reaches the store.
    fireEvent.change(screen.getByLabelText("Weekly sets high"), { target: { value: "5" } });
    expect(readHealthSettings().volumeBand).toEqual({ low: 12, high: 18 });
    fireEvent.click(screen.getByText("Use the Studied Range"));
    expect(readHealthSettings().volumeBand).toBeNull();
  });

  it("carries the rack controls", () => {
    render(<HealthSettingsPage onBack={() => {}} />);
    expect(screen.getByLabelText("Bar Weight")).toBeInTheDocument();
  });
});

// Part 3 wave 4 (Dave 15a): the Student template's screens open from here.
describe("HealthSettingsPage doors", () => {
  it("lists the doors by group and opens one by key; none without the seam", () => {
    const onOpenDoor = vi.fn();
    const doors = [
      { key: "share", group: "Sharing", label: "The Share Line", sub: "What crosses to a parent" },
      { key: "weekShape", group: "The Week", label: "Week Shape", sub: "Sessions and hours" },
    ];
    const { rerender } = render(<HealthSettingsPage onBack={() => {}} doors={doors} onOpenDoor={onOpenDoor} />);
    expect(screen.getByText("Sharing")).toBeInTheDocument();
    expect(screen.getByText("The Week")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Week Shape"));
    expect(onOpenDoor).toHaveBeenCalledWith("weekShape");
    rerender(<HealthSettingsPage onBack={() => {}} doors={doors} />);
    expect(screen.queryByText("The Share Line")).toBeNull();
  });
});

// 2026-09-14: the workout reminder, on at a default time, off, and retimed.
describe("HealthSettingsPage: the workout reminder", () => {
  it("is absent without the seam, turns on at 17:30, retimes, and turns off", () => {
    const { rerender } = render(<HealthSettingsPage onBack={() => {}} />);
    expect(screen.queryByText("Workout Reminder")).toBeNull();
    const onWorkoutReminder = vi.fn();
    rerender(<HealthSettingsPage onBack={() => {}} workoutReminder={null} onWorkoutReminder={onWorkoutReminder} />);
    fireEvent.click(screen.getByRole("switch", { name: "Workout Reminder" }));
    expect(onWorkoutReminder).toHaveBeenCalledWith("17:30");
    rerender(<HealthSettingsPage onBack={() => {}} workoutReminder={{ time: "17:30" }} onWorkoutReminder={onWorkoutReminder} />);
    fireEvent.change(screen.getByLabelText("Reminder time"), { target: { value: "06:15" } });
    expect(onWorkoutReminder).toHaveBeenLastCalledWith("06:15");
    fireEvent.click(screen.getByRole("switch", { name: "Workout Reminder" }));
    expect(onWorkoutReminder).toHaveBeenLastCalledWith(null);
  });
});

// 2026-10-04 (audit): RackSettings kept the whole gym blob as it was at mount
// and wrote it back with every plate, unit and bar tap, so a Last Time switch
// turned off a moment earlier on this page came back on.
describe("HealthSettingsPage: a Rack control never rolls back a sibling's value", () => {
  it("Last Time off, then a plate chip: Last Time stays off", () => {
    render(<HealthSettingsPage onBack={() => {}} />);
    const sw = screen.getByRole("switch", { name: "Last Time on Every Set" });
    fireEvent.click(sw);
    expect(readGymSettings().showLast).toBe(false);
    fireEvent.click(screen.getByText("5", { selector: ".chip" }));
    expect(readGymSettings().plates).not.toContain(5);
    expect(readGymSettings().showLast).toBe(false);
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("Last Time off, then the Rack Unit and Bar Weight: both land and Last Time stays off", () => {
    render(<HealthSettingsPage onBack={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Last Time on Every Set" }));
    fireEvent.click(screen.getByText("Kg", { selector: ".seg" }));
    fireEvent.change(screen.getByLabelText("Bar Weight"), { target: { value: "20" } });
    expect(readGymSettings()).toMatchObject({ rackUnit: "kg", barWeight: 20, showLast: false });
  });
});

// 2026-10-04 (audit): Program did exactly what Manual does, so the menu offers
// the two modes that differ, and a stored Program reads as Manual.
describe("HealthSettingsPage: progression", () => {
  it("offers Assisted and Manual only", () => {
    render(<HealthSettingsPage onBack={() => {}} />);
    fireEvent.click(screen.getByLabelText("Progression"));
    expect(screen.getAllByRole("menuitemradio").map((o) => o.textContent)).toEqual(["Assisted", "Manual"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Manual" }));
    expect(readHealthSettings().progression).toBe("manual");
    expect(screen.getByText("No Suggestions")).toBeInTheDocument();
  });

  it("a Program stored before this reads as Manual on the page", () => {
    localStorage.setItem("jarvis.health.settings.v1", JSON.stringify({ progression: "program", seeded: 2 }));
    render(<HealthSettingsPage onBack={() => {}} />);
    expect(screen.getByLabelText("Progression")).toHaveTextContent("Manual");
  });
});

// 2026-10-04 (audit): the Rest Notification switch decides a lock-screen alert
// only the phone app schedules; on the web it changed nothing.
describe("HealthSettingsPage: Rest Notification is the phone app's", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is not drawn on the web", () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    render(<HealthSettingsPage onBack={() => {}} />);
    expect(screen.queryByRole("switch", { name: "Rest Notification" })).toBeNull();
    // The sound switch beside it works on the web, so it stays.
    expect(screen.getByRole("switch", { name: "Rest Timer Sound" })).toBeInTheDocument();
  });

  it("is drawn on the phone app and writes the setting the rest timer reads", () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    render(<HealthSettingsPage onBack={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Rest Notification" }));
    expect(readHealthSettings().restNotify).toBe(false);
  });
});
