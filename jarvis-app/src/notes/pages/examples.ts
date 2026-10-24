import type { PageData, PageRecord } from "./pageModel";
import { newId } from "./pageModel";

// THE TEMPLATE STANDARD, PART ONE (Dave's Decision 3, 2026-10-23): "every template opens as a filled example, clearable in one tap."
// A page made from the picker starts with a few rows that show what a finished page looks like. Each is flagged `ex`; the page says
// so once and offers Clear Example. A row the person edits (or ticks) stops being an example, so clearing never takes their words.
// Dates are written as "@N": N days from today. Money is a plain number. Every value fits its field (a choice is one of its options).

type Ex = { sec?: string; v: Record<string, string> };

export const EXAMPLES: Record<string, Ex[]> = {
  outreach: [
    { v: { who: "Coach Rivera", org: "Lakeside Prep", channel: "Email", status: "Reached Out", last: "@-3", next: "Call Thursday About the Visit" } },
    { v: { who: "Dana Whitfield", org: "Metro Sports Club", channel: "Phone", status: "Replied", last: "@-1", next: "Send the Schedule" } },
    { v: { who: "Sam Ortega", org: "Hilltop Academy", channel: "Text", status: "To Contact", next: "Introduce Myself" } },
  ],
  team: [
    { v: { name: "Jordan Lee", number: "7", position: "Guard" } },
    { v: { name: "Sam Patel", number: "12", position: "Forward" } },
    { v: { name: "Riley Chen", number: "23", position: "Center" } },
  ],
  pitching: [
    { v: { name: "Ben Carter", date: "@-6", pitches: "62", notes: "Felt Strong" } },
    { v: { name: "Luis Moreno", date: "@-2", pitches: "38" } },
  ],
  session: [
    { sec: "Drills", v: { act: "Passing Drill", min: "15", notes: "Two Lines" } },
    { sec: "Scrimmage", v: { act: "Scrimmage", min: "20" } },
  ],
  eventday: [
    { sec: "People", v: { item: "Meet the Group at the Gate" } },
    { sec: "Bring", v: { item: "Phone Charger" } },
  ],
  scouting: [
    { v: { name: "Eastside Hawks", team: "Eastside", rating: "4", strengths: "Fast Break, Rebounding", weaknesses: "Free Throws" } },
    { v: { name: "Pat Nguyen", team: "Westview", rating: "3", strengths: "Left Hand", weaknesses: "Stamina" } },
  ],
  trainingplan: [
    { sec: "Week 1", v: { day: "Monday", focus: "Legs", detail: "Squats, Lunges, Calf Raises" } },
    { sec: "Week 1", v: { day: "Wednesday", focus: "Upper Body", detail: "Press, Rows, Pull-Ups" } },
    { sec: "Week 1", v: { day: "Friday", focus: "Conditioning", detail: "Intervals, 20 Minutes" } },
  ],
  moneymap: [
    { sec: "Banking", v: { name: "Checking", kind: "Bank", where: "Main Street Credit Union", contact: "800 555 0100" } },
    { sec: "Policies", v: { name: "Auto Policy", kind: "Insurance", where: "Folder in the Desk, Second Drawer" } },
    { sec: "Subscriptions and Renewals", v: { name: "Streaming", kind: "Subscription", where: "Card on File" } },
  ],
  debt: [
    { v: { name: "Credit Card", apr: "22.9", min: "45", balance: "1800" } },
    { v: { name: "Car Loan", apr: "6.5", min: "310", balance: "9400" } },
  ],
  giving: [
    { v: { date: "@-10", to: "Food Bank", amount: "50", kind: "Money" } },
    { v: { date: "@-4", to: "Neighborhood Cleanup", kind: "Time", notes: "Two Hours" } },
  ],
  homebook: [
    { sec: "Home", v: { item: "Furnace Filter", model: "Standard Size", serviced: "@-80", due: "@10" } },
    { sec: "Vehicles", v: { item: "Family Car", model: "Make and Model", serviced: "@-120", due: "@60" } },
  ],
  inventory: [
    { sec: "Living Room", v: { item: "Television", room: "Living Room", value: "450", bought: "@-400" } },
    { sec: "Kitchen", v: { item: "Stand Mixer", room: "Kitchen", value: "280" } },
  ],
  healthcard: [
    { sec: "Emergency Contacts", v: { name: "Alex (Spouse)", kind: "Contact", contact: "555 0142" } },
    { sec: "Allergies", v: { name: "Penicillin", kind: "Allergy", detail: "Hives" } },
    { sec: "Doctors", v: { name: "Doctor Morgan", kind: "Doctor", detail: "Primary Care", contact: "555 0188" } },
  ],
  petcard: [
    { sec: "Vaccines", v: { name: "Rabies", kind: "Vaccine", due: "@120" } },
    { sec: "Feeding and Care", v: { name: "Breakfast", kind: "Feeding", detail: "One Cup, Morning" } },
  ],
  handover: [
    { sec: "Right Now", v: { topic: "The Dog Needs Out at Noon", detail: "Leash by the door, back door code on the fridge", who: "Neighbor" } },
    { sec: "Every Day", v: { topic: "Plants", detail: "Water the fern Monday and Thursday, skip the cactus", who: "Anyone" } },
    { sec: "If Something Goes Wrong", v: { topic: "Water Leak", detail: "Shut-off valve is under the kitchen sink, then call the plumber", who: "Plumber" } },
  ],
  carerecord: [
    { v: { date: "@0", who: "Alex", what: "Fed and Walked the Dog", notes: "Ate Everything" } },
  ],
  occasions: [
    { v: { name: "Mom", occasion: "Birthday", date: "@21", gift: "Garden Gloves", budget: "40" } },
    { v: { name: "Chris and Pat", occasion: "Anniversary", date: "@75", gift: "Dinner Voucher", budget: "100" } },
  ],
  trip: [
    { sec: "Getting There", v: { item: "Flights", when: "@45", where: "Airport", cost: "420" } },
    { sec: "Packing", v: { item: "Passport" } },
  ],
  expenses: [
    { sec: "To Submit", v: { vendor: "Airport Taxi", status: "To Submit", date: "@-2", amount: "38", for: "Client Visit" } },
    { sec: "Submitted", v: { vendor: "Conference Hotel", status: "Submitted", date: "@-12", amount: "212", for: "Conference" } },
  ],
  recipes: [
    { sec: "Mains", v: { name: "Sheet Pan Chicken", serves: "4", time: "40 Minutes", ingredients: "Chicken, Potatoes, Olive Oil, Rosemary", steps: "Roast at 425 until browned" } },
  ],
  mealplan: [
    { sec: "Monday", v: { meal: "Tacos", type: "Dinner" } },
  ],
  freezer: [
    { v: { item: "Chicken Soup", qty: "3 Containers", frozen: "@-14", useby: "@75" } },
    { v: { item: "Ground Beef", qty: "2 Pounds", frozen: "@-5", useby: "@85" } },
  ],
  accomplish: [
    { v: { title: "Finished the First Draft", date: "@-6", area: "Work" } },
    { v: { title: "Ran 10 Kilometres", date: "@-20", area: "Health" } },
  ],
  oneonone: [
    { v: { date: "@-7", topics: "Roadmap, Hiring", actions: "Send the Role Description", next: "@7" } },
  ],
  projtracker: [
    { sec: "In Progress", v: { item: "Draft the Proposal", owner: "Me", due: "@5" } },
    { sec: "Blocked", v: { item: "Vendor Contract", owner: "Legal", due: "@12", notes: "Waiting on Signatures" } },
    { sec: "Not Started", v: { item: "Plan the Launch", owner: "Me", due: "@30" } },
  ],
  bracket: [
    { v: { name: "Team One" } }, { v: { name: "Team Two" } }, { v: { name: "Team Three" } }, { v: { name: "Team Four" } },
  ],
  watchlist: [
    { sec: "Up Next", v: { title: "A Film a Friend Recommended", kind: "Movie", where: "Streaming", who: "Friend" } },
    { sec: "Watching", v: { title: "A Show in Progress", kind: "Show", where: "Streaming" } },
  ],
  party: [
    { sec: "Guests", v: { item: "Jamie", rsvp: "Yes" } },
    { sec: "Food and Drink", v: { item: "Cake", cost: "35" } },
    { sec: "Supplies", v: { item: "Balloons", cost: "12" } },
  ],
  poker: [
    { v: { name: "Ari", buyin: "20", cashout: "45" } },
    { v: { name: "Bo", buyin: "20", cashout: "0" } },
    { v: { name: "Cy", buyin: "20", rebuy: "20", cashout: "35" } },
  ],
};

const isoOffset = (days: number, from: Date = new Date()): string => {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The example rows for a kind, as records: dates resolved, headings matched by label, every one flagged. */
export function exampleRecords(page: PageData, today: Date = new Date()): PageRecord[] {
  return (EXAMPLES[page.kind] ?? []).map((e) => {
    const v: Record<string, string> = {};
    for (const [k, x] of Object.entries(e.v)) v[k] = /^@-?\d+$/.test(x) ? isoOffset(Number(x.slice(1)), today) : x;
    const sec = e.sec ? (page.sections ?? []).find((s) => s.label === e.sec)?.key : undefined;
    return { id: newId("r"), v, ex: true, ...(sec ? { sec } : {}) };
  });
}

/** A new page, filled with its example. Pages that already have rows (a template with starter rows) keep them and gain the example. */
export function withExample(page: PageData, today: Date = new Date()): PageData {
  const rows = exampleRecords(page, today);
  return rows.length ? { ...page, records: [...page.records, ...rows] } : page;
}

/** True while any row is still an unedited example. */
export const hasExample = (page: PageData): boolean => page.records.some((r) => r.ex);

/** Clear Example: take every unedited example row away and nothing else. */
export function clearExample(page: PageData): PageData {
  return { ...page, records: page.records.filter((r) => !r.ex) };
}
