// LAW (corrections pack 2026-08-14, item 4): no feature service lists records
// without passing its entity type to the adapter, so the filter runs in SQL
// against the (owner_id, entity_type) index instead of scanning the whole
// account in memory. One test per service, each asserting the adapter was
// queried with the right type. BackupService is the one sanctioned untyped
// read (export means every record) and is pinned as such below.

import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter, type Item } from "@core";
import { TasksService } from "../tasks/TasksService";
import { NotesService } from "../notes/NotesService";
import { ScheduleService } from "../schedule/ScheduleService";
import { MoneyService } from "../money/MoneyService";
import { ProjectsService } from "../projects/ProjectsService";
import { ProfileService } from "../profile/ProfileService";
import { RoutineService } from "../routine/RoutineService";
import { CategoriesService } from "../categories/CategoriesService";
import { GymService } from "../gym/GymService";
import { BrainDocService } from "../brain/docs/BrainDocService";
import { AreaService } from "../life/AreaService";
import { GoalService } from "../life/GoalService";
import { PeopleService } from "../people/PeopleService";
import { BackupService } from "../backup/BackupService";
import { LearnedRulesService } from "../rules/LearnedRulesService";
import { ChatService } from "../chat/ChatService";
import { DecisionService } from "../decisions/DecisionService";

// An adapter that records every listForUser call so the tests can prove the
// type made it all the way down (not just into the Store's cache key).
class RecordingAdapter extends InMemoryAdapter {
  calls: (string | undefined)[] = [];
  override async listForUser(ownerId: string, entityType?: string): Promise<Item[]> {
    this.calls.push(entityType);
    return super.listForUser(ownerId, entityType);
  }
}

function rig() {
  const adapter = new RecordingAdapter();
  const store = new Store(adapter);
  return { adapter, store };
}

const U = "user1";

describe("law: every service list is a typed adapter query", () => {
  it("TasksService lists with entity type task", async () => {
    const { adapter, store } = rig();
    await new TasksService(store, U).listTasks();
    expect(adapter.calls).toContain("task");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("NotesService lists notes and tasks with their types", async () => {
    const { adapter, store } = rig();
    const s = new NotesService(store, U);
    await s.listNotes();
    await s.listTasks();
    await s.notesLinkedTo("x");
    expect(adapter.calls).toContain("note");
    expect(adapter.calls).toContain("task");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("ScheduleService lists with entity type event", async () => {
    const { adapter, store } = rig();
    await new ScheduleService(store, U).listEvents();
    expect(adapter.calls).toContain("event");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("MoneyService lists with entity type account", async () => {
    const { adapter, store } = rig();
    await new MoneyService(store, U).list();
    expect(adapter.calls).toContain("account");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("ProjectsService lists with entity type project", async () => {
    const { adapter, store } = rig();
    await new ProjectsService(store, U).list();
    expect(adapter.calls).toContain("project");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("ProfileService reads with entity type profile", async () => {
    const { adapter, store } = rig();
    await new ProfileService(store, U).get();
    expect(adapter.calls).toContain("profile");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("RoutineService reads with entity type routine", async () => {
    const { adapter, store } = rig();
    await new RoutineService(store, U).get();
    expect(adapter.calls).toContain("routine");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("CategoriesService lists with entity type category", async () => {
    const { adapter, store } = rig();
    await new CategoriesService(store, U).list();
    expect(adapter.calls).toContain("category");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("GymService lists programs and workouts with their types", async () => {
    const { adapter, store } = rig();
    const s = new GymService(store, U);
    await s.listPrograms();
    await s.listWorkouts();
    expect(adapter.calls).toContain("program");
    expect(adapter.calls).toContain("workout");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("BrainDocService reads with entity type brain_doc", async () => {
    const { adapter, store } = rig();
    await new BrainDocService(store, U).get("habits");
    expect(adapter.calls).toContain("brain_doc");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("AreaService lists with entity type life_area", async () => {
    const { adapter, store } = rig();
    await new AreaService(store, U).list();
    expect(adapter.calls).toContain("life_area");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("GoalService lists with entity type goal", async () => {
    const { adapter, store } = rig();
    await new GoalService(store, U).list();
    expect(adapter.calls).toContain("goal");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("PeopleService lists with entity type person", async () => {
    const { adapter, store } = rig();
    await new PeopleService(store, U).list();
    expect(adapter.calls).toContain("person");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("LearnedRulesService lists with entity type learned_rule", async () => {
    const { adapter, store } = rig();
    await new LearnedRulesService(store, U).list();
    expect(adapter.calls).toContain("learned_rule");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("ChatService lists with entity type chat_message", async () => {
    const { adapter, store } = rig();
    await new ChatService(store, U).list();
    expect(adapter.calls).toContain("chat_message");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("DecisionService lists with entity type decision_record", async () => {
    const { adapter, store } = rig();
    await new DecisionService(store, U).list();
    expect(adapter.calls).toContain("decision_record");
    expect(adapter.calls).not.toContain(undefined);
  });

  it("BackupService export is the one sanctioned untyped read", async () => {
    const { adapter, store } = rig();
    await new BackupService(store, U).exportBundle();
    expect(adapter.calls).toEqual([undefined]);
  });
});

describe("typed lists filter correctly and cache independently", () => {
  it("a typed list returns only rows of that type", async () => {
    const { store } = rig();
    await store.create(U, "task", { text: "t" });
    await store.create(U, "note", { title: "n" });
    const tasks = await store.listForUser(U, "task");
    const notes = await store.listForUser(U, "note");
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.entityType).toBe("task");
    expect(notes.length).toBe(1);
    expect(notes[0]?.entityType).toBe("note");
  });

  it("a write invalidates every cached list for the owner", async () => {
    const { store } = rig();
    await store.create(U, "task", { text: "a" });
    await store.listForUser(U, "task"); // warm the typed cache
    await store.create(U, "task", { text: "b" });
    const after = await store.listForUser(U, "task");
    expect(after.length).toBe(2);
  });
});
