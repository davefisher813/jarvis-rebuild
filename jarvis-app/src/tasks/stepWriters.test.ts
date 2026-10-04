import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "./TasksService";

const make = () => new TasksService(new Store(new InMemoryAdapter()), "u1");

async function seeded() {
  const svc = make();
  const id = (await svc.createTask("Plan the trip", { category: "life" }))!;
  await svc.setSteps(id, [{ text: "Pick dates", done: false }, { text: "Book flights", done: false }, { text: "Pack", done: false }]);
  return { svc, id };
}

describe("setStepDone: the exact step, once", () => {
  it("completes the named step and reports the change", async () => {
    const { svc, id } = await seeded();
    const r = await svc.setStepDone(id, 0, "Pick dates", true);
    expect(r?.changed).toBe(true);
    expect((await svc.task(id))!.steps![0]!.done).toBe(true);
  });

  it("a second tap, a retry or a second device is not a second credit", async () => {
    const { svc, id } = await seeded();
    await svc.setStepDone(id, 0, "Pick dates", true);
    const again = await svc.setStepDone(id, 0, "Pick dates", true);
    expect(again?.changed).toBe(false);
    expect((await svc.task(id))!.steps!.filter((s) => s.done)).toHaveLength(1);
  });

  it("refuses when the list moved under it, so the wrong step is never ticked", async () => {
    const { svc, id } = await seeded();
    expect(await svc.setStepDone(id, 0, "Something else", true)).toBeNull();
    expect(await svc.setStepDone(id, 9, "Pick dates", true)).toBeNull();
    expect((await svc.task(id))!.steps!.some((s) => s.done)).toBe(false);
  });

  it("finishing the last step does not complete the task", async () => {
    const { svc, id } = await seeded();
    await svc.setStepDone(id, 0, "Pick dates", true);
    await svc.setStepDone(id, 1, "Book flights", true);
    await svc.setStepDone(id, 2, "Pack", true);
    const t = (await svc.task(id))!;
    expect(t.steps!.every((s) => s.done)).toBe(true);
    expect(t.done).toBe(false);
  });

  it("undo restores the exact prior list without a trace", async () => {
    const { svc, id } = await seeded();
    const r = (await svc.setStepDone(id, 1, "Book flights", true))!;
    await svc.setSteps(id, r.before);
    expect((await svc.task(id))!.steps).toEqual(r.before);
    expect((await svc.task(id))!.done).toBe(false);
  });

  it("an unknown task is null, not a throw", async () => {
    expect(await make().setStepDone("nope", 0, "x", true)).toBeNull();
  });
});

describe("setStepText and insertStepBefore (Make this smaller)", () => {
  it("rewords an open step", async () => {
    const { svc, id } = await seeded();
    const r = await svc.setStepText(id, 1, "Book flights", "Open the airline site");
    expect(r?.changed).toBe(true);
    expect((await svc.task(id))!.steps![1]!.text).toBe("Open the airline site");
  });

  it("refuses blank words rather than deleting the step", async () => {
    const { svc, id } = await seeded();
    expect(await svc.setStepText(id, 1, "Book flights", "   ")).toBeNull();
    expect((await svc.task(id))!.steps).toHaveLength(3);
  });

  it("does not reword a done step, which is history", async () => {
    const { svc, id } = await seeded();
    await svc.setStepDone(id, 0, "Pick dates", true);
    expect(await svc.setStepText(id, 0, "Pick dates", "Changed")).toBeNull();
  });

  it("the person's own smaller move goes in front and becomes next", async () => {
    const { svc, id } = await seeded();
    const r = await svc.insertStepBefore(id, 1, "Open the airline site");
    expect(r?.changed).toBe(true);
    const steps = (await svc.task(id))!.steps!;
    expect(steps.map((s) => s.text)).toEqual(["Pick dates", "Open the airline site", "Book flights", "Pack"]);
    expect(steps[1]!.done).toBe(false);
  });

  it("blank smaller move is refused", async () => {
    const { svc, id } = await seeded();
    expect(await svc.insertStepBefore(id, 0, " ")).toBeNull();
  });
});

describe("logWorkedOn: partial progress is not completion", () => {
  it("records the work and touches no step and not done", async () => {
    const { svc, id } = await seeded();
    const before = (await svc.task(id))!;
    const r = await svc.logWorkedOn(id, "read the options", new Date("2026-10-04T10:00:00Z"));
    expect(r?.changed).toBe(true);
    const after = (await svc.task(id))!;
    expect(after.worked).toEqual([{ at: "2026-10-04T10:00:00.000Z", note: "read the options" }]);
    expect(after.steps).toEqual(before.steps);
    expect(after.done).toBe(false);
  });

  it("a double tap logs once", async () => {
    const { svc, id } = await seeded();
    const t = new Date("2026-10-04T10:00:00Z");
    await svc.logWorkedOn(id, "same", t);
    const again = await svc.logWorkedOn(id, "same", new Date(t.getTime() + 2000));
    expect(again?.changed).toBe(false);
    expect((await svc.task(id))!.worked).toHaveLength(1);
  });
});
