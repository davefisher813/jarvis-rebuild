// One-time demo data, seeded centrally so every tab has rich, varied content.
// Idempotent per entity: only seeds a type when its store is empty. Generic
// sample data, tagged with the user's seeded category ids. Varied categories so
// the color system reads (never a single-category monochrome flow).
import type { TasksService } from "../tasks/TasksService";
import type { ScheduleService } from "../schedule/ScheduleService";
import type { AreaService } from "../life/AreaService";
import type { GoalService } from "../life/GoalService";
import type { ProjectsService } from "../projects/ProjectsService";
import type { MoneyService } from "../money/MoneyService";
import type { PeopleService } from "../people/PeopleService";
import type { Category } from "../categories/types";
import { todayISO } from "../schedule/calendar";

const DAY = 86400000;
function addDays(iso: string, n: number): string {
  const t = new Date(new Date(iso + "T00:00:00").getTime() + n * DAY);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

interface Extras {
  areas: AreaService;
  goals: GoalService;
  projects: ProjectsService;
  money: MoneyService;
  people: PeopleService;
}

export async function seedDemoData(
  tasks: TasksService,
  schedule: ScheduleService,
  categories: Category[],
  extras?: Extras,
): Promise<void> {
  const today = todayISO();
  const cat = (name: string): string =>
    categories.find((c) => c.data.name === name)?.id ?? categories[0]?.id ?? "";

  if ((await schedule.listEvents()).length === 0) {
    await schedule.createEvent("Morning Standup", { date: today, start: "08:30", category: cat("Work") });
    await schedule.createEvent("Client Call", { date: today, start: "10:00", category: cat("Work"), location: "Zoom" });
    await schedule.createEvent("Lunch With Sam", { date: today, start: "12:30", category: cat("Friends"), location: "Blue Bottle, Ferry Building" });
    await schedule.createEvent("Team Sync", { date: today, start: "14:30", category: cat("Work") });
    await schedule.createEvent("Gym Session", { date: today, start: "16:30", category: cat("Health") });
    await schedule.createEvent("Evening Run", { date: today, start: "18:00", category: cat("Health") });
    await schedule.createEvent("Dentist", { date: addDays(today, 1), start: "09:00", category: cat("Health"), location: "200 Market St" });
    await schedule.createEvent("Call With Alex", { date: addDays(today, 1), start: "15:00", category: cat("Friends") });
    await schedule.createEvent("Coffee Catch-up", { date: addDays(today, 2), start: "09:30", category: cat("Friends"), location: "Sightglass Coffee" });
    await schedule.createEvent("Project Demo", { date: addDays(today, 2), start: "13:00", category: cat("Work") });
    await schedule.createEvent("Budget Review", { date: addDays(today, 3), start: "11:00", category: cat("Money") });
    await schedule.createEvent("Family Dinner", { date: addDays(today, 4), start: "19:00", category: cat("Family"), location: "Mom's house" });
  }

  if ((await tasks.listTasks()).length === 0) {
    await tasks.createTask("Pay rent", { category: cat("Money"), due: addDays(today, -1) });
    await tasks.createTask("Reply to Sam re: Proposal", { category: cat("Work"), due: addDays(today, -2) });
    await tasks.createTask("Send Invoice", { category: cat("Money"), due: today });
    await tasks.createTask("Submit Expense Report", { category: cat("Money"), due: today });
    await tasks.createTask("Book Flights", { category: cat("Family"), due: addDays(today, 3) });
    await tasks.createTask("Coffee With Alex", { category: cat("Friends"), due: addDays(today, 5) });
    await tasks.createTask("Plan weekend trip", { category: cat("Family"), due: addDays(today, 6) });
    const d1 = await tasks.createTask("Email the team", { category: cat("Work"), due: addDays(today, -1) });
    const d2 = await tasks.createTask("Renew gym membership", { category: cat("Health"), due: addDays(today, -3) });
    if (d1) await tasks.toggleDone(d1);
    if (d2) await tasks.toggleDone(d2);
  }

  if (!extras) return;
  const { areas, goals, projects, money, people } = extras;

  if ((await areas.list()).length === 0) {
    const health = await areas.create({ name: "Health", state: "strong" });
    const career = await areas.create({ name: "Career", state: "steady" });
    const rel = await areas.create({ name: "Relationships", state: "steady" });
    const fin = await areas.create({ name: "Finances", state: "drifting" });
    const growth = await areas.create({ name: "Growth", state: "steady" });
    await goals.create({ title: "Run three times a week", state: "on_track", areaId: health ?? undefined });
    await goals.create({ title: "Ship the new release", state: "steady", areaId: career ?? undefined });
    await goals.create({ title: "Weekly date night", state: "on_track", areaId: rel ?? undefined });
    await goals.create({ title: "Build a six-month runway", state: "at_risk", areaId: fin ?? undefined });
    await goals.create({ title: "Read twelve books", state: "steady", areaId: growth ?? undefined });
  }

  if ((await projects.list()).length === 0) {
    await projects.create({ title: "Q3 Launch", status: "active", category: cat("Work") });
    await projects.create({ title: "Website Redesign", status: "active", category: cat("Work") });
    await projects.create({ title: "Tax Filing", status: "on_hold", category: cat("Money") });
    await projects.create({ title: "Home Renovation", status: "on_hold", category: cat("Family") });
    await projects.create({ title: "2024 Retro", status: "done", category: cat("Work") });
  }

  if ((await money.list()).length === 0) {
    await money.create({ name: "Checking", balance: 4820.5, kind: "cash" });
    await money.create({ name: "Savings", balance: 18230, kind: "savings" });
    await money.create({ name: "Brokerage", balance: 32540.75, kind: "investment" });
    await money.create({ name: "Credit Card", balance: -1240.3, kind: "credit" });
  }

  if ((await people.list()).length === 0) {
    await people.create({ name: "Sam Rivera", group: "contacts", relationship: "Colleague" });
    await people.create({ name: "Alex Chen", group: "contacts", relationship: "Client" });
    await people.create({ name: "Jordan Lee", group: "contacts", relationship: "Neighbor" });
    await people.create({ name: "Maria Diaz", group: "inner_circle", relationship: "Sister" });
    await people.create({ name: "Chris Park", group: "inner_circle", relationship: "Best friend" });
    await people.create({ name: "Dad", group: "inner_circle", relationship: "Family" });
    await people.create({ name: "Rival Corp", group: "adversarial", relationship: "Competitor" });
  }
}
