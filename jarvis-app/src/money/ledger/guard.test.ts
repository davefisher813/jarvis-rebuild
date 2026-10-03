import { describe, it, expect, beforeEach, vi } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { clearRejections, guardTaskCandidate, isBillShaped, recentRejections } from "./guard";
import { TasksService } from "../../tasks/TasksService";

// HARD RULE 1 (acceptance 3): no pipeline can create a task from a bill-shaped
// candidate. These feed bill candidates to the real task pipeline and assert
// the rejection, so a future path that "just calls createTask" fails here.

describe("isBillShaped", () => {
  it("a bill field, an amount with a vendor, or a bill word with an amount", () => {
    expect(isBillShaped({ bill: { amount: 10 } })).toBe(true);
    expect(isBillShaped({ amount: 84.12, vendor: "ConEdison" })).toBe(true);
    expect(isBillShaped({ amountCents: 8412, vendor: "ConEdison" })).toBe(true);
    expect(isBillShaped({ kind: "Invoice", amount: 120 })).toBe(true);
    expect(isBillShaped({ kind: "renewal", amountCents: 999 })).toBe(true);
  });
  it("a plain task, an amount alone, or a bill word alone is not", () => {
    expect(isBillShaped({})).toBe(false);
    expect(isBillShaped({ amount: 20 })).toBe(false);
    expect(isBillShaped({ kind: "invoice" })).toBe(false);
    expect(isBillShaped({ vendor: "ConEdison" })).toBe(false);
    expect(isBillShaped({ amount: 0, vendor: "x" })).toBe(false);
  });
});

describe("the task pipeline's door", () => {
  beforeEach(() => { clearRejections(); vi.spyOn(console, "warn").mockImplementation(() => {}); });

  it("guardTaskCandidate refuses and logs", () => {
    expect(guardTaskCandidate({ amount: 84.12, vendor: "ConEdison" }, "test")).toEqual({ ok: false, reason: "bill_is_not_a_task" });
    expect(recentRejections()).toHaveLength(1);
    expect(recentRejections()[0]!.via).toBe("test");
    expect(guardTaskCandidate({}, "test")).toEqual({ ok: true });
    expect(recentRejections()).toHaveLength(1);
  });

  it("TasksService.createTask refuses a bill-shaped candidate and writes nothing (acceptance 3)", async () => {
    const tasks = new TasksService(new Store(new InMemoryAdapter()), "u");
    const id = await tasks.createTask("Pay ConEdison", { bill: { amount: 84.12 } });
    expect(id).toBeNull();
    expect(await tasks.listTasks()).toEqual([]);
    expect(recentRejections().at(-1)).toMatchObject({ via: "TasksService.createTask", reason: "bill_is_not_a_task" });
  });

  it("an ordinary task still goes through", async () => {
    const tasks = new TasksService(new Store(new InMemoryAdapter()), "u");
    const id = await tasks.createTask("Call the plumber");
    expect(id).toBeTruthy();
    expect(recentRejections()).toHaveLength(0);
  });
});
