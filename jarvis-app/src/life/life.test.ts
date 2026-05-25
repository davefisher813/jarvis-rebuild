import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { AreaService } from "./AreaService";
import { GoalService } from "./GoalService";
import { AREA_META, GOAL_META } from "./types";

describe("AreaService", () => {
  it("creates, lists, updates, removes", async () => {
    const a = new AreaService(new Store(new InMemoryAdapter()), "u");
    const id = await a.create({ name: "Health", state: "strong" });
    expect((await a.list()).length).toBe(1);
    await a.update(id!, { state: "drifting" });
    expect((await a.get(id!))!.data.state).toBe("drifting");
    await a.remove(id!);
    expect((await a.list()).length).toBe(0);
  });
  it("rejects empty name", async () => {
    const a = new AreaService(new Store(new InMemoryAdapter()), "u");
    expect(await a.create({ name: "  ", state: "steady" })).toBeNull();
  });
  it("maps state to label/color/pct", () => {
    expect(AREA_META.strong.cls).toBe("good");
    expect(GOAL_META.at_risk.label).toBe("At risk");
  });
});

describe("GoalService", () => {
  it("creates, lists, updates, removes", async () => {
    const g = new GoalService(new Store(new InMemoryAdapter()), "u");
    const id = await g.create({ title: "Run a half marathon", state: "on_track", areaId: "a1" });
    expect((await g.list())[0]!.data.areaId).toBe("a1");
    await g.update(id!, { state: "at_risk" });
    expect((await g.get(id!))!.data.state).toBe("at_risk");
    await g.remove(id!);
    expect((await g.list()).length).toBe(0);
  });
});
