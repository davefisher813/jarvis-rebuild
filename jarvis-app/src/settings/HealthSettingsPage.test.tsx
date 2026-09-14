// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import HealthSettingsPage from "./HealthSettingsPage";
import { readHealthSettings } from "../health/settings";
import { readGymSettings } from "../gym/settings";

// Health Push C, H-40 (2026-09-12).
beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("HealthSettingsPage", () => {
  it("toggling a shortcut writes through, and turning Water on seeds its metric", () => {
    const onEnableWater = vi.fn();
    render(<HealthSettingsPage onBack={() => {}} onEnableWater={onEnableWater} />);
    // 2026-09-14: the reference's four are on by default, Water among them.
    expect(screen.getByRole("button", { name: "Bedtime" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Water" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Water" }));
    expect(readHealthSettings().shortcuts).toEqual(["bedtime", "meal", "checkin"]);
    expect(onEnableWater).toHaveBeenCalledTimes(0);
    fireEvent.click(screen.getByRole("button", { name: "Water" }));
    expect(readHealthSettings().shortcuts).toEqual(["bedtime", "meal", "checkin", "water"]);
    expect(onEnableWater).toHaveBeenCalledTimes(1);
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
