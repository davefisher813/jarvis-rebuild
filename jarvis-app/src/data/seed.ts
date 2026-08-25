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
import type { SealService } from "../review/seal";
import type { GymService } from "../gym/GymService";
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
  seal?: SealService;
  gym?: GymService;
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
    // FINISH LINES (picks 13/14). Each one is the measure the goal's own
    // TITLE already names, which is the point: a goal called "run three times
    // a week" knew nothing about three, or about a week. Date night carries
    // none, so the unmeasured state is on screen too.
    await goals.create({ title: "Run three times a week", state: "on_track", areaId: health ?? undefined, tags: [cat("Health")], measure: { kind: "cadence", times: 3, per: "week" } });
    await goals.create({ title: "Ship the App Store Launch", state: "steady", areaId: career ?? undefined, tags: [cat("Work")], measure: { kind: "projects" } });
    await goals.create({ title: "Weekly date night", state: "on_track", areaId: rel ?? undefined });
    await goals.create({ title: "Build a six-month runway", state: "at_risk", areaId: fin ?? undefined, tags: [cat("Money")], moneyTarget: 24000 });
    await goals.create({ title: "Read twelve books", state: "steady", areaId: growth ?? undefined, measure: { kind: "count", target: 12, since: today }, by: addDays(today, 120) });
  }

  if ((await projects.list()).length === 0) {
    const launchGoal = (await goals.list()).find((g) => g.data.title === "Ship the App Store Launch");
    const golf = await projects.create({ title: "Calder Golf Event", status: "active", category: cat("Family") });
    const rebuild = await projects.create({ title: "Rebuild Calder App", status: "active", category: cat("Work"), goalId: launchGoal?.id });
    const site = await projects.create({ title: "Remodel Calder Website", status: "active", category: cat("Work") });
    const cookout = await projects.create({ title: "Calder Summer Cookout", status: "active", category: cat("Family") });
    // PICK 20: a hold that RAN OUT, because that is the state worth showing.
    // A hold with a future date is quiet furniture; one whose day has passed
    // is the only moment the app has anything to say about it.
    await projects.create({ title: "Tax Filing", status: "on_hold", category: cat("Money"), holdUntil: addDays(today, -9) });
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

  // THE MONTHLY REPORT'S DEMO (2026-08-25): two sealed months plus the
  // dated Store facts the hero and joins read, so a reviewer sees the full
  // page instead of a first-of-the-month empty state. Demo only; the real
  // seal writes itself at the boundary.
  if (extras?.seal && (await extras.seal.list()).length === 0) {
    const now = new Date(today + "T12:00:00");
    const y = now.getFullYear();
    const m = now.getMonth() + 1; // 1-based current month
    const key = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}`;
    const monthKey = m === 1 ? key(y - 1, 12) : key(y, m - 1);
    const prevKey = m <= 2 ? key(y - 1, 12 - (2 - m)) : key(y, m - 2);
    const dIn = (k: string, day: number) => `${k}-${String(day).padStart(2, "0")}`;

    if (extras.goals) {
      await extras.goals.create({ title: "Run a Half Marathon", state: "achieved", achievedOn: dIn(monthKey, 14), tags: [cat("Health")] });
      await extras.goals.create({ title: "Read every evening", state: "on_track", dropped: { on: dIn(monthKey, 19) } });
    }
    await extras.projects.create({ title: "Garage Cleanout", status: "done", category: cat("Friends"), closedOn: dIn(monthKey, 20) });
    const carriedId = await tasks.createTask("Update insurance docs", { category: cat("Friends") });

    if (extras.gym) {
      for (const day of [2, 4, 7, 9, 11, 13, 14, 16, 18, 21, 23, 25, 27, 28]) {
        await extras.gym.saveWorkout({
          programId: "demo", dayId: "demo-day", dayName: day % 2 === 0 ? "Push Day" : "Pull Day",
          date: dIn(monthKey, day),
          startedAt: new Date(dIn(monthKey, day) + "T17:30:00").getTime(),
          endedAt: new Date(dIn(monthKey, day) + "T18:17:00").getTime(),
          exercises: [],
        });
      }
    }

    const byHour = [0, 0, 0, 0, 0, 0, 1, 2, 6, 13, 16, 12, 7, 6, 5, 5, 4, 3, 2, 1, 1, 0, 0, 0];
    const doneByDay: Record<string, number> = {};
    for (let d = 1; d <= 28; d++) {
      // Training days carry more finishes, so the join has something true
      // to say; Sundays (7, 14, 21, 28 here) stay quiet like real weeks.
      const trained = [2, 4, 7, 9, 11, 13, 14, 16, 18, 21, 23, 25, 27, 28].includes(d);
      doneByDay[dIn(monthKey, d)] = trained ? 4 : d % 7 === 0 ? 1 : 2;
    }
    await extras.seal.create({
      month: monthKey, sealedAt: Date.now() - 86400000,
      done: 84, pushed: 19, daysIn: 26,
      byCategory: { [cat("Work")]: 48, [cat("Friends")]: 22, [cat("Health")]: 8, [cat("Family")]: 2 },
      bandStart: 9, bandCount: 41, byHour, doneByDay,
      pushedByCategory: { [cat("Work")]: 5, [cat("Friends")]: 3, [cat("Family")]: 11 },
      slip: { category: cat("Family"), n: 11 },
      byPick: [
        { n: 1, picked: 18, done: 14 }, { n: 2, picked: 17, done: 11 },
        { n: 3, picked: 15, done: 8 }, { n: 4, picked: 9, done: 2 }, { n: 5, picked: 5, done: 1 },
      ],
      overrunByCategory: { [cat("Work")]: { min: 240, n: 12 }, [cat("Friends")]: { min: -30, n: 6 } },
      suggestions: { first_step: { acc: 9, dis: 2 }, link: { acc: 1, dis: 7 } },
      strands: { created: 4, corrected: 1, deleted: 0 },
      remindersTicked: 14,
      deck: { sent: 18, asWritten: 14 },
      sessions: 14, deposits: 9, saved: 1200, goalsLive: 4, goalsAchieved: 1,
      carried: carriedId ? [{ id: carriedId, n: 7 }] : [],
    });
    await extras.seal.create({
      month: prevKey, sealedAt: Date.now() - 40 * 86400000,
      done: 72, pushed: 24, daysIn: 26,
      byCategory: { [cat("Work")]: 40, [cat("Friends")]: 18, [cat("Health")]: 3, [cat("Family")]: 11 },
      bandStart: 10, bandCount: 33, byHour: byHour.map((n) => Math.max(0, n - 1)), doneByDay: {},
      pushedByCategory: {}, slip: null, byPick: [], overrunByCategory: {}, suggestions: {},
      strands: { created: 2, corrected: 0, deleted: 0 }, remindersTicked: 9,
      deck: { sent: 11, asWritten: 7 },
      sessions: 16, deposits: 11, saved: 950, goalsLive: 4, goalsAchieved: 0,
      carried: [],
    });
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
      // Gists are FRAGMENTS here for the same reason triage now asks for them
      // (Dave 2026-08-25: "The subtext on email previews feels a little
      // lengthy"). The demo is the one place the copy rules are visible
      // without a live inbox, so a demo that still writes sentences is a demo
      // of the old behaviour.
      { id: "demo-1", from: "App Store Team", fromEmail: "no-reply@apple.com", subject: "complete your enrollment", gist: "Closes today, blocks the ship", by: "today" },
      { id: "demo-2", from: "Nadia Brandt", fromEmail: "nadia@northlake.org", subject: "Invoice attached", gist: "Signature needed before Monday" },
      { id: "demo-3", from: "Northwind Cloud", fromEmail: "alerts@supabase.io", subject: "Security advisories flagged", gist: "Two projects need a bump" },
      // The three shapes of a dated commitment, so all three buttons are
      // reachable without a live inbox: an appointment with a time, a bill
      // with an amount, and a package with only a day.
      {
        id: "demo-4", from: "Riverside Dental", fromEmail: "front@riversidedental.com",
        subject: "Appointment reminder", gist: "Cleaning, 2 PM",
        act: { kind: "appointment", title: "Dental cleaning", date: day(2), start: "14:00", durationMin: 45 },
      },
      {
        id: "demo-5", from: "Northwind Cloud", fromEmail: "billing@supabase.io",
        subject: "Your invoice is ready", gist: "Renews Sept 1",
        act: { kind: "bill", title: "Northwind Cloud", date: day(6), amount: 74.99 },
      },
      {
        id: "demo-6", from: "Summit Gear", fromEmail: "ship@summitgear.com",
        subject: "Your order has shipped", gist: "Order #D2565 arriving",
        act: { kind: "delivery", title: "Summit Gear order", date: day(1) },
      },
    ],
    waiting: [
      { threadId: "demo-w1", to: "summitgear", subject: "Order #D2565", days: 55 },
      { threadId: "demo-w2", to: "Marcus Delaney", subject: "Harper v Northline", days: 55 },
    ],
    promises: [{ threadId: "demo-p1", text: "send rob the deck", due: day(1) }],
  });
}
