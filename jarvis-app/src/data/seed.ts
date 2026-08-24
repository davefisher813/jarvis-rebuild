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
import type { DecisionService } from "../decisions/DecisionService";
import type { Category } from "../categories/types";
import { todayISO } from "../schedule/calendar";
import { saveMailSnapshot } from "../messages/home";

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
  decisions?: DecisionService;
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
    // B2 (audit 2026-08-21): the demo never once demonstrated a repeat, so a
    // reviewer could use the whole app and never learn it repeats anything.
    // Standup is daily; the gym runs weekly and ENDS, which is the half of
    // repeating that nothing anywhere was showing.
    await schedule.createEvent("Morning Standup", { date: today, start: "08:30", category: cat("Work"), recurrence: "daily" });
    await schedule.createEvent("Call With Nadia", { date: today, start: "10:00", category: cat("Work"), location: "Zoom" });
    // Deep Work and the drive exist so BLENDING has something to demonstrate:
    // a drive is a block you sit through, and a call rides along with it.
    await schedule.createEvent("Deep Work", { date: today, start: "13:00", end: "14:30", category: cat("Work") });
    await schedule.createEvent("Drive to Ridgeline", { date: today, start: "14:45", end: "15:30", category: cat("Family") });
    await schedule.createEvent("Fall Clinic Walkthrough", { date: today, start: "15:30", category: cat("Family"), location: "Ridgeline Fields" });
    await schedule.createEvent("Gym Session", { date: today, start: "17:30", category: cat("Health"), recurrence: "weekly", until: addDays(today, 56) });
    await schedule.createEvent("Board Call · Rob Calder", { date: addDays(today, 1), start: "09:00", category: cat("Family") });
    await schedule.createEvent("Sponsor Pitch · Summit Gear", { date: addDays(today, 1), start: "14:00", category: cat("Work") });
    await schedule.createEvent("Coach Onboarding Demo", { date: addDays(today, 2), start: "11:00", category: cat("Work") });
    await schedule.createEvent("Harper v Northline Prep", { date: addDays(today, 2), start: "16:00", category: cat("Money"), location: "Delaney Office" });
    await schedule.createEvent("Budget Review", { date: addDays(today, 3), start: "11:00", category: cat("Money") });
    await schedule.createEvent("Calder Summer Cookout Planning", { date: addDays(today, 4), start: "18:30", category: cat("Family") });
  }

  if ((await tasks.listTasks()).length === 0) {
    await tasks.createTask("Create Calder Invoice", { category: cat("Money"), due: today });
    await tasks.createTask("Pay Ticket", { category: cat("Money"), due: addDays(today, -2) });
    await tasks.createTask("Reply to Nadia re: Invoice", { category: cat("Work"), due: today });
    await tasks.createTask("Nudge Delaney on Harper v Northline", { category: cat("Work"), due: addDays(today, 1) });
    await tasks.createTask("Book PG 17U Travel", { category: cat("Family"), due: addDays(today, 3) });
    await tasks.createTask("Call Ridgeline About the Field", { category: cat("Family"), due: today });
    await tasks.createTask("Chase Summit Gear Order #D2565", { category: cat("Money"), due: addDays(today, 2) });
    const d1 = await tasks.createTask("Send Waiver to Ridgeline", { category: cat("Family"), due: addDays(today, -1) });
    const d2 = await tasks.createTask("Post Clinic Recap", { category: cat("Work"), due: addDays(today, -3) });
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
    // ARCHITECTURE C: `tags` are the CATEGORIES a goal watches, which is a
    // different axis from the legacy `areaId` above (Life Areas have no UI).
    //
    // Three carry tags, and only where the mapping is HONEST: every Health
    // task really is running work, every Money task really is runway. Date
    // night is deliberately untagged even though a Family tag would light it
    // up, because Family in this data is mostly the kids' sport, and a goal
    // that claims "Call Ridgeline About the Field" moves date night is the
    // exact nonsense a too-broad watch list produces. Books carries neither,
    // so the empty state is on screen too.
    await goals.create({ title: "Run three times a week", state: "on_track", areaId: health ?? undefined, tags: [cat("Health")] });
    await goals.create({ title: "Ship the App Store Launch", state: "steady", areaId: career ?? undefined, tags: [cat("Work")] });
    await goals.create({ title: "Weekly date night", state: "on_track", areaId: rel ?? undefined });
    await goals.create({ title: "Build a six-month runway", state: "at_risk", areaId: fin ?? undefined, tags: [cat("Money")] });
    await goals.create({ title: "Read twelve books", state: "steady", areaId: growth ?? undefined });
  }

  if ((await projects.list()).length === 0) {
    const launchGoal = (await goals.list()).find((g) => g.data.title === "Ship the App Store Launch");
    const golf = await projects.create({ title: "Calder Golf Event", status: "active", category: cat("Family") });
    const rebuild = await projects.create({ title: "Rebuild Calder App", status: "active", category: cat("Work"), goalId: launchGoal?.id });
    const site = await projects.create({ title: "Remodel Calder Website", status: "active", category: cat("Work") });
    const cookout = await projects.create({ title: "Calder Summer Cookout", status: "active", category: cat("Family") });
    await projects.create({ title: "Tax Filing", status: "on_hold", category: cat("Money") });
    // Linked tasks so progress bars, counts, and Next lines all populate.
    if (golf) {
      const g1 = await tasks.createTask("Lock the Pavilion Date", { category: cat("Family"), due: addDays(today, -6), projectId: golf });
      const g2 = await tasks.createTask("Order Sponsor Banners", { category: cat("Family"), due: addDays(today, -3), projectId: golf });
      const g3 = await tasks.createTask("Collect Raffle Prizes", { category: cat("Family"), due: addDays(today, -1), projectId: golf });
      const g4 = await tasks.createTask("Send Thank-You Notes", { category: cat("Family"), due: addDays(today, 2), projectId: golf });
      for (const g of [g1, g2, g3]) if (g) await tasks.toggleDone(g);
      void g4;
    }
    if (rebuild) {
      const r1 = await tasks.createTask("Draft the Coach Onboarding Email", { category: cat("Work"), due: today, projectId: rebuild });
      const r2 = await tasks.createTask("Confirm Apple Enrollment Fee", { category: cat("Money"), due: addDays(today, 1), projectId: rebuild });
      const r3 = await tasks.createTask("Record the Demo Walkthrough", { category: cat("Work"), due: addDays(today, 2), projectId: rebuild });
      const r4 = await tasks.createTask("Reserve the App Store Name", { category: cat("Work"), due: addDays(today, -3), projectId: rebuild });
      if (r4) await tasks.toggleDone(r4);
      void r1; void r2; void r3;
    }
    if (site) {
      const w1 = await tasks.createTask("Ship the New Landing Hero", { category: cat("Work"), due: addDays(today, -1), projectId: site });
      const w2 = await tasks.createTask("Swap Testimonial Quotes", { category: cat("Work"), due: addDays(today, 4), projectId: site });
      if (w1) await tasks.toggleDone(w1);
      void w2;
    }
    if (cookout) {
      const c1 = await tasks.createTask("Reserve the Park Shelter", { category: cat("Family"), due: addDays(today, 5), projectId: cookout });
      void c1;
    }
  }

  if ((await money.list()).length === 0) {
    await money.create({ name: "Checking", balance: 4820.5, kind: "cash" });
    await money.create({ name: "Savings", balance: 18230, kind: "savings" });
    await money.create({ name: "Brokerage", balance: 32540.75, kind: "investment" });
    await money.create({ name: "Credit Card", balance: -1240.3, kind: "credit" });
  }

  if ((await people.list()).length === 0) {
    await people.create({ name: "Rob Calder", group: "contacts", relationship: "Board" });
    await people.create({ name: "Nadia Brandt", group: "contacts", relationship: "Northlake" });
    await people.create({ name: "Marcus Delaney", group: "contacts", relationship: "Attorney" });
    await people.create({ name: "Ridgeline", group: "contacts", relationship: "Fields" });
    await people.create({ name: "Sam Okafor", group: "contacts", relationship: "Coach" });
  }

  // Bills are recurring money tasks; two due soon so the Money page and the
  // Today money line both populate.
  const existingTasks = await tasks.listTasks();

  // Reminders (2026-08-19): the meds case, so the strip is populated in the
  // demo. Morning is already ticked; the afternoon one is still open.
  if (!existingTasks.some((t) => t.data.reminder)) {
    await tasks.createTask("Morning Meds", { category: cat("Health"), reminder: { time: "08:00", lastDone: today } });
    await tasks.createTask("Vitamin D", { category: cat("Health"), reminder: { time: "13:00" } });
    await tasks.createTask("Night Meds", { category: cat("Health"), reminder: { time: "21:00" } });
  }

  if (!existingTasks.some((t) => t.data.bill)) {
    await tasks.createTask("Rent", { category: cat("Money"), due: addDays(today, 2), recurrence: "monthly", bill: { amount: 2200 } });
    await tasks.createTask("Internet", { category: cat("Money"), due: addDays(today, 6), recurrence: "monthly", bill: { amount: 89, autopay: true } });
    await tasks.createTask("Car Insurance", { category: cat("Money"), due: addDays(today, 12), recurrence: "monthly", bill: { amount: 148 } });
  }

  // Decision Records: one live with a revisit due TODAY (so the Today card
  // renders), one plain, and one superseded chain (so Replaces renders).
  const dec = extras.decisions;
  if (dec && (await dec.listAll()).length === 0) {
    const launch = (await projects.list()).find((p) => p.data.title === "Rebuild Calder App");
    await dec.create({
      decision: "Student template ships first",
      why: "Northlake gives 60 warm leads on day one",
      ruledOut: ["Personal first", "Business first", "All three at once"],
      linkedType: launch ? "project" : undefined,
      linkedId: launch?.id,
      linkedLabel: launch?.data.title,
      revisitOn: today,
    });
    await dec.create({
      decision: "No free tier at launch",
      why: "AI cost per user is unbounded without a gate",
    });
    const oldCall = await dec.create({
      decision: "Weekly clinics run Sundays",
      why: "Fields were open before the Ridgeline schedule landed",
    });
    if (oldCall) {
      await dec.supersede(oldCall, {
        decision: "Fall clinics run Saturdays only",
        why: "Ridgeline fields are locked Sundays through November",
        ruledOut: ["Sundays", "Both days"],
      });
    }
  }
}

// The home-page email snapshot, for the demo only. The real app gets this
// from the Email tab the moment it loads live mail; in a demo there is no
// Gmail behind it, so the preview writes the same shape so the Heads Up
// stream shows what the feature actually looks like.
export function seedDemoMail(): void {
  const today = todayISO();
  const day = (n: number): string => {
    const t = new Date(new Date(today + "T12:00:00").getTime() + n * DAY);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  };
  saveMailSnapshot({
    ts: Date.now(),
    needsYou: 7,
    threads: [
      { id: "demo-1", from: "App Store Team", fromEmail: "no-reply@apple.com", subject: "complete your enrollment", gist: "Enrollment closes and the app cannot ship", by: "today" },
      { id: "demo-2", from: "Nadia Brandt", fromEmail: "nadia@northlake.org", subject: "Invoice attached", gist: "Wants it signed before Net 15 starts Monday" },
      { id: "demo-3", from: "Northwind Cloud", fromEmail: "alerts@supabase.io", subject: "Security advisories flagged", gist: "Two projects need a version bump" },
    ],
    waiting: [
      { threadId: "demo-w1", to: "summitgear", subject: "Order #D2565", days: 55 },
      { threadId: "demo-w2", to: "Marcus Delaney", subject: "Harper v Northline", days: 55 },
    ],
    promises: [{ threadId: "demo-p1", text: "send rob the deck", due: day(1) }],
  });
}
