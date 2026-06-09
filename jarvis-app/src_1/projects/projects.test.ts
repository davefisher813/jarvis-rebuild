import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { ProjectsService } from "./ProjectsService";
import { PROJECT_META } from "./types";

describe("ProjectsService", () => {
  it("creates, lists (active first), updates, removes", async () => {
    const p = new ProjectsService(new Store(new InMemoryAdapter()), "u");
    await p.create({ title: "Old thing", status: "done" });
    const id = await p.create({ title: "Q3 launch", status: "active", category: "c1" });
    const list = await p.list();
    expect(list[0]!.data.title).toBe("Q3 launch"); // active sorts above done
    await p.update(id!, { status: "on_hold" });
    expect((await p.get(id!))!.data.status).toBe("on_hold");
    await p.remove(id!);
    expect((await p.list()).length).toBe(1);
  });
  it("rejects empty title; maps status", async () => {
    const p = new ProjectsService(new Store(new InMemoryAdapter()), "u");
    expect(await p.create({ title: "  ", status: "active" })).toBeNull();
    expect(PROJECT_META.on_hold.label).toBe("On hold");
  });
});
