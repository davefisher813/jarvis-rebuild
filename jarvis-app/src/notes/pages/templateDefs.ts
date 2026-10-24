// THE TEMPLATE CATALOG (issue #115, waves 2 to 4). Every template page after slice 1 is a DEFINITION here, not a screen of its
// own: a name on a shelf, the fields it starts with (the smallest useful set), the headings its rows sit under, and which view
// draws it. The engine around it (sections, a done mark, reorder, suggested fields, export, import, snapshots, "save as my
// template") is shared, so a template that is only a list of rows costs a definition and nothing else, and every one of them is
// edited the same way: on the page, never in a settings maze.
//
// This file holds data and pure functions only (it is imported by pageModel for the names), so it takes pageModel's TYPES alone.
import type { PageField } from "./pageModel";

export type Shelf = "Sports" | "Life" | "Entertainment" | "Finance" | "Professional";
export const SHELVES: Shelf[] = ["Sports", "Life", "Finance", "Professional", "Entertainment"];

/** Which view draws a template's rows. "sheet" is the shared list of rows under headings. */
export type TemplateView = "sheet" | "profile" | "standings" | "scoreboard" | "pitching" | "session" | "traininglog" | "trainingplan" | "debt" | "bizledger" | "occasions" | "accomplish" | "bracket" | "draft" | "poker";

export type IconKey = "target" | "user" | "list" | "send" | "table" | "checks" | "dumbbell" | "calendar" | "file" | "wallet" | "dollar" | "home" | "gauge" | "timer" | "flame" | "bulb" | "clock" | "mail" | "brain" | "kanban" | "zap" | "sparkles" | "person" | "tag";

export interface TemplateDef {
  key: string;
  name: string;
  shelf: Shelf;
  /** The grey line under the name in the picker: a Title Case fragment, no period. */
  desc: string;
  cat: string;
  icon: IconKey;
  /** A row, singular and plural: "Player", "Players". */
  noun: string;
  plural: string;
  /** The field that names a row. */
  headline: string;
  /** The fields drawn under a row's name, in order (empty ones are skipped). */
  show: string[];
  fields: PageField[];
  /** Headings a new page starts with. Rows can be moved between them. EVERY heading is drawn, rows or none, each with its own
   *  Add (Alfred 2026-10-16: 24 templates opened as an empty shell, a counter and one Add, because a heading with no rows was
   *  hidden; a template opens READY, its structure on the page). */
  sections?: string[];
  /** Rows a new page starts with, where the def implies them (a Warm-Up and a Cool-Down, Doors Open, a Dinner per day). The
   *  smallest structural starters: two to five, plainly editable and removable, never personal data. `sec` is the heading's
   *  index or label. */
  starter?: { sec?: number | string; v: Record<string, string> }[];
  /** Fields the page does not start with but offers in one tap: smallest useful structure first, grown when the person says. */
  suggested?: PageField[];
  /** Sums drawn beside the page's count. */
  totals?: { key: string; label: string; money?: boolean }[];
  /** WHAT A FIELD KEEPS WORKING (2026-10-17, the 2026-10-13 spec: a structural change with consequences says what stops working
   *  BEFORE it is applied). The fields this template's own arithmetic reads beyond its totals, due date and sort (those are read
   *  from `totals`, `due` and `sort`), each with the line the Remove sheet says first. Taken from the code that reads them. */
  needs?: Record<string, string>;
  view: TemplateView;
  /** A running record: choosing the template again asks (open it, or make another) rather than quietly making a second. */
  one?: boolean;
  wave: 2 | 3 | 4;
  /** Starting values for the page's own small settings. */
  meta?: Record<string, string>;
  /** A PRESET OR ENTRY POINT of another template (Home Inventory under Home & Vehicle Book, Meal Plan under Kitchen Page). It is not
   *  a row in the picker; choosing its parent asks which one. `entry` is what the chooser calls it. */
  parent?: string;
  entry?: string;
  /** The row's name in the picker when the template's own name is one entry of several ("Kitchen Page" for Recipes). */
  shelfName?: string;
  /** POINTERS ONLY (Money Map): where a thing is, never how to get into it. A password, a PIN or a long account number is refused. */
  pointersOnly?: boolean;
  /** A sensitive record: each row says when it was last confirmed, and the page can confirm them all (never automatically). */
  confirm?: boolean;
  /** A date field that says what is coming: "Due in 12 Days", "Overdue". `yearly` repeats it every year (a birthday). */
  due?: { key: string; yearly?: boolean };
  /** How the rows are ordered: newest first, or by the next time the date comes round. Absent: the order the person made. */
  sort?: "dateDesc" | "next";
  /** A grey line under the head, for a page that leaves something out on purpose. */
  note?: string;
  /** The rows are read from the app (Business Ledger over Money), never stored: no Add, no import. */
  derived?: boolean;
  /** OTHER SHELVES THE PICKER LISTS IT UNDER (the 2026-10-13 spec: Accomplishments and Milestones sits under both Life and
   *  Professional). The template is still ONE template on its own `shelf`; a second row is the same key, one tap to the same
   *  page, never a second template. */
  alsoShelves?: Shelf[];
  /** FOLDED INTO ANOTHER TEMPLATE (Dave's cut list, 2026-10-23). Not a row in the picker any more, and the line says where it lives now.
   *  The definition stays so every page already made from it opens and works exactly as it did; nothing is migrated or deleted. */
  retired?: string;
  /** The heading whose rows run on a clock from the page's Start Time (the Event Day Pack's Timeline, which is the Running Order folded
   *  in). Absent: the clock runs over every row, as the Session Plan's does. */
  timeline?: string;
  /** What an empty page says in one plain line instead of the Starts With and Suggested rows (a reference page, not a list to work through). */
  plainEmpty?: string;
}

const f = (key: string, label: string, type: PageField["type"] = "text", options?: string[]): PageField => ({ key, label, type, ...(options ? { options } : {}) });

/** Every template the catalog has built so far. A key is added here as its wave lands. */
export const TEMPLATE_KEYS = [
  "scoreboard", "rounds", "pitching", "session", "eventday", "scouting", "profile", "traininglog", "trainingplan", "standings", "group",
  "moneymap", "insurance", "debt", "giving", "homebook", "inventory", "healthcard", "petcard", "handover", "carerecord", "occasions", "trip", "expenses",
  "recipes", "mealplan", "freezer", "accomplish", "oneonone", "projtracker", "bizledger",
  "bracket", "draft", "watchlist", "party", "runorder", "poker",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const TEMPLATES: Record<TemplateKey, TemplateDef> = {
  // ---- Wave 2: Sports
  scoreboard: {
    key: "scoreboard", name: "Scoreboard", shelf: "Sports", desc: "Any Sport, Real Scoring, Game Night and Trivia", cat: "green", icon: "gauge",
    noun: "Side", plural: "Sides", headline: "name", show: [], fields: [f("name", "Name")], view: "scoreboard", wave: 2,
  },
  // THE ROUNDS PAGE (Dave 2026-10-23, Golf decision: "past rounds are kept in a history"). Every finished Golf round writes one row per
  // player here, and the course book (a course's real pars, remembered after one setup) lives in this page's settings. It is a PRESET of
  // the Golf Scorecard (`parent`), so it is not a row of its own in the picker: the Golf row asks "New Round" or "Rounds".
  rounds: {
    key: "rounds", name: "Rounds", shelf: "Sports", desc: "Every Round You Finish, by Course and Score", cat: "green", icon: "target",
    noun: "Round", plural: "Rounds", headline: "player", show: ["date", "course", "score", "topar"], parent: "scorecard", entry: "Rounds",
    fields: [f("date", "Date", "date"), f("course", "Course"), f("player", "Player"), f("score", "Score", "number"), f("topar", "To Par"), f("net", "Net", "number"), f("pts", "Points", "number"), f("putts", "Putts", "number"), f("fairways", "Fairways"), f("greens", "Greens", "number")],
    view: "sheet", one: true, wave: 2, sort: "dateDesc", note: "Rows Come From Finished Rounds",
  },
  pitching: {
    key: "pitching", name: "Pitching Board", shelf: "Sports", desc: "Pitch Counts, Rest Days, Who Is Available", cat: "orange", icon: "flame",
    noun: "Outing", plural: "Outings", headline: "name", show: ["date", "pitches", "notes"],
    fields: [f("name", "Pitcher"), f("date", "Date", "date"), f("pitches", "Pitches", "number"), f("notes", "Notes")],
    view: "pitching", one: true, wave: 2, meta: { limit: "85" },
    // pitcherStatuses: rest follows from the last outing's date and pitches; the view checks the pitches against the limit.
    needs: { date: "Rest Days and Who Is Available Stop Working", pitches: "Pitch Counts, Rest Days and the Limit Stop Working" },
  },
  session: {
    key: "session", name: "Session Plan", shelf: "Sports", desc: "Warm-Up, Drills, Scrimmage, Minutes Add Up", cat: "blue", icon: "timer",
    noun: "Activity", plural: "Activities", headline: "act", show: ["min", "notes"],
    fields: [f("act", "Activity"), f("min", "Minutes", "number"), f("notes", "Notes")],
    sections: ["Warm-Up", "Drills", "Scrimmage", "Cool-Down"], totals: [{ key: "min", label: "Min" }],
    starter: [{ sec: "Warm-Up", v: { act: "Warm-Up", min: "10" } }, { sec: "Cool-Down", v: { act: "Cool-Down", min: "5" } }],
    suggested: [f("coach", "Coach"), f("equip", "Equipment")], view: "session", wave: 2, meta: { start: "" },
    // sessionClock: each activity's clock time is the start plus the minutes before it.
    needs: { min: "Clock Times From the Start Stop Working" },
  },
  eventday: {
    key: "eventday", name: "Event Day Pack", shelf: "Sports", desc: "Before You Go, Bring, People, and a Timeline With Clock Times", cat: "yellow", icon: "checks",
    noun: "Item", plural: "Items", headline: "item", show: ["min", "notes"],
    // REBUILT 2026-10-23 (Dave's cut list): the Running Order folded in as the Timeline. The old four-heading skeleton (Schedule was a
    // list of words with no times) is gone; Timeline rows carry minutes and the page works out each one's clock time from the start.
    fields: [f("item", "Item"), f("done", "Done", "check"), f("min", "Minutes", "number"), f("notes", "Notes")],
    sections: ["Before You Go", "Bring", "People", "Timeline"], timeline: "Timeline", totals: [{ key: "min", label: "Min" }],
    starter: [
      { sec: "Before You Go", v: { item: "Tickets" } }, { sec: "Before You Go", v: { item: "Directions" } }, { sec: "Bring", v: { item: "Water" } },
      { sec: "Timeline", v: { item: "Arrive", min: "15" } }, { sec: "Timeline", v: { item: "Event Starts", min: "90" } }, { sec: "Timeline", v: { item: "Pack Up", min: "15" } },
    ],
    suggested: [f("who", "Who"), f("where", "Where")], view: "session", wave: 2, meta: { start: "" },
    needs: { min: "Clock Times From the Start Stop Working" },
  },
  scouting: {
    key: "scouting", name: "Scouting Report", shelf: "Sports", desc: "Opponents or Prospects: Strengths, Weaknesses", cat: "purple", icon: "brain",
    noun: "Report", plural: "Reports", headline: "name", show: ["team", "rating", "strengths"],
    fields: [f("name", "Name"), f("team", "Team"), f("rating", "Rating", "choice", ["1", "2", "3", "4", "5"]), f("strengths", "Strengths"), f("weaknesses", "Weaknesses"), f("notes", "Notes")],
    suggested: [f("position", "Position"), f("seen", "Last Seen", "date")], view: "sheet", wave: 2,
  },
  profile: {
    key: "profile",
    retired: "Printed From a Scouting Report", name: "Profile One-Pager", shelf: "Sports", desc: "One Athlete, One Printable Page", cat: "red", icon: "person",
    noun: "Profile", plural: "Profiles", headline: "name", show: [],
    fields: [f("name", "Name"), f("position", "Position"), f("team", "Team"), f("year", "Class Year"), f("height", "Height"), f("weight", "Weight"), f("gpa", "GPA"), f("contact", "Contact"), f("highlights", "Highlights")],
    suggested: [f("school", "School"), f("coach", "Coach"), f("video", "Video Link")], view: "profile", one: true, wave: 2,
  },
  traininglog: {
    key: "traininglog", name: "Training Log", shelf: "Sports", desc: "Your Workouts, Read From Health", cat: "teal", icon: "dumbbell",
    noun: "Note", plural: "Notes", headline: "note", show: ["date", "coach"], parent: "trainingplan", entry: "Training Log",
    fields: [f("date", "Date", "date"), f("note", "Note"), f("coach", "Coach")], view: "traininglog", one: true, wave: 2,
    // TrainingLogView: a view over Health with no entries of its own; notes a page already has are drawn newest first by their date.
  },
  trainingplan: {
    key: "trainingplan", name: "Training Plan", shelf: "Sports", desc: "Weeks and Days, From a Program or Your Own", cat: "sky", icon: "calendar",
    noun: "Day", plural: "Days", headline: "day", show: ["focus", "detail"],
    fields: [f("day", "Day"), f("focus", "Focus"), f("detail", "Details"), f("done", "Done", "check")], sections: ["Week 1"],
    suggested: [f("rest", "Rest"), f("notes", "Notes")], view: "trainingplan", wave: 2,
  },
  standings: {
    key: "standings",
    parent: "scoreboard", entry: "League Standings", name: "League Standings", shelf: "Sports", desc: "Teams, Games, Wins and Losses Worked Out", cat: "blue", icon: "table",
    noun: "Team", plural: "Teams", headline: "name", show: [], fields: [f("name", "Team")], view: "standings", one: true, wave: 2,
  },
  group: {
    key: "group",
    retired: "Folded Into the Team Sheet: Fees, Roles, Who Is Coming, Key Dates", name: "Group Manager Page", shelf: "Sports", desc: "Members, Roles, Dues, Who Is Coming", cat: "orange", icon: "user",
    noun: "Member", plural: "Members", headline: "name", show: ["role", "contact"],
    fields: [f("name", "Name"), f("role", "Role", "choice", ["Leader", "Member", "Guest"]), f("contact", "Contact"), f("dues", "Dues Paid", "check")],
    sections: ["Leaders", "Members"], suggested: [f("coming", "Coming", "check"), f("notes", "Notes")], view: "sheet", one: true, wave: 2,
  },

  // ---- Wave 3: Finance
  moneymap: {
    key: "moneymap", name: "Money Map", shelf: "Finance", desc: "Where Everything Is, Policies, Renewals: Pointers Only, Never Passwords", cat: "yellow", icon: "wallet",
    noun: "Pointer", plural: "Pointers", headline: "name", show: ["kind", "where", "contact"],
    fields: [f("name", "Name"), f("kind", "Kind", "choice", ["Bank", "Card", "Loan", "Investment", "Retirement", "Bill", "Subscription", "Insurance", "Other"]), f("where", "Where to Find It"), f("contact", "Contact"), f("notes", "Notes")],
    // The 2026-10-13 spec: a Subscriptions and Renewals section, and For My Family (what they would need to find, pointers only).
    // The Insurance Page folded in on 2026-10-23 (Dave's cut list) as the Policies section: the carrier, the renewal date and the premium
    // are one tap each, and the renewal says how close it is. A policy number is not kept here; "Where to Find It" says where it is.
    sections: ["Banking", "Cards and Loans", "Investing", "Policies", "Subscriptions and Renewals", "For My Family", "Other"],
    suggested: [f("opened", "Opened", "date"), f("who", "Whose"), f("renews", "Renews", "date"), f("carrier", "Carrier"), f("premium", "Premium", "money"), f("deductible", "Deductible", "money"), f("covers", "Covers")],
    totals: [{ key: "premium", label: "Premium", money: true }], due: { key: "renews" },
    view: "sheet", one: true, wave: 3, pointersOnly: true, confirm: true,
    note: "Names and Places Only; No Passwords, PINs or Full Account Numbers",
  },
  insurance: {
    key: "insurance",
    retired: "Folded Into the Money Map as Its Policies Section", name: "Insurance Page", shelf: "Finance", desc: "Policies, Carriers, Renewal Dates, Who to Call", cat: "sky", icon: "file",
    noun: "Policy", plural: "Policies", headline: "name", show: ["kind", "carrier", "renews", "premium"],
    fields: [f("name", "Policy"), f("kind", "Kind", "choice", ["Auto", "Home", "Renters", "Health", "Life", "Umbrella", "Pet", "Other"]), f("carrier", "Carrier"), f("number", "Policy Number"), f("premium", "Premium", "money"), f("renews", "Renews", "date"), f("agent", "Agent or Phone")],
    sections: ["Home and Auto", "Health and Life", "Other"], suggested: [f("deductible", "Deductible", "money"), f("covers", "Covers")],
    totals: [{ key: "premium", label: "Premium", money: true }], view: "sheet", one: true, wave: 3, confirm: true, due: { key: "renews" },
  },
  debt: {
    key: "debt", name: "Debt Payoff", shelf: "Finance", desc: "What You Owe, Which to Pay First, Balances From Money", cat: "red", icon: "gauge",
    noun: "Debt", plural: "Debts", headline: "name", show: ["apr", "min"],
    fields: [f("name", "Debt"), f("apr", "APR %", "number"), f("min", "Minimum", "money"), f("balance", "Balance If Not in Money", "money")],
    view: "debt", one: true, wave: 3, meta: { method: "avalanche", extra: "0" },
    // debtsOf: the plan reads each debt's rate, minimum, and (for a debt not linked to Money) its own balance.
    needs: {
      apr: "The Payoff Order and Interest Stop Working",
      min: "The Payoff Plan Stops Counting Minimum Payments",
      balance: "Debts Not in Money Drop Out of the Payoff Plan",
    },
  },
  giving: {
    key: "giving", name: "Giving Log", shelf: "Finance", desc: "Gifts of Money, Time and Goods, Totalled", cat: "pink", icon: "sparkles",
    noun: "Gift", plural: "Gifts", headline: "to", show: ["date", "amount", "kind"],
    fields: [f("date", "Date", "date"), f("to", "To"), f("amount", "Amount", "money"), f("kind", "Kind", "choice", ["Money", "Time", "Goods"]), f("notes", "Notes")],
    suggested: [f("receipt", "Receipt", "check")], totals: [{ key: "amount", label: "Given", money: true }], view: "sheet", one: true, wave: 3, sort: "dateDesc",
  },

  // ---- Wave 3: Life
  homebook: {
    key: "homebook", name: "Home and Vehicle Book", shelf: "Life", desc: "Home, Vehicles, Appliances: Service Dates and What Is Due", cat: "orange", icon: "home",
    noun: "Item", plural: "Items", headline: "item", show: ["model", "serviced", "due"], entry: "Home and Vehicle Book",
    fields: [f("item", "Item"), f("model", "Make and Model"), f("serviced", "Last Serviced", "date"), f("due", "Next Due", "date"), f("notes", "Notes")],
    // The 2026-10-13 spec: a Purchases and Warranties section, with the warranty's end one tap away.
    sections: ["Home", "Vehicles", "Appliances", "Purchases and Warranties"], suggested: [f("vin", "VIN or Serial"), f("vendor", "Who Services It"), f("warranty", "Warranty Ends", "date")], view: "sheet", one: true, wave: 3, due: { key: "due" },
  },
  inventory: {
    key: "inventory", name: "Home Inventory", shelf: "Life", desc: "Everything You Own: Room, Value, Serial", cat: "orange", icon: "list",
    noun: "Item", plural: "Items", headline: "item", show: ["room", "value", "bought"], parent: "homebook", entry: "Home Inventory",
    // The 2026-10-13 spec: what I own, where it is, where its receipt is.
    fields: [f("item", "Item"), f("room", "Room"), f("value", "Value", "money"), f("bought", "Bought", "date"), f("serial", "Serial Number"), f("receipt", "Where the Receipt Is"), f("notes", "Notes")],
    sections: ["Living Room", "Kitchen", "Bedrooms", "Garage", "Other"], totals: [{ key: "value", label: "Value", money: true }], view: "sheet", one: true, wave: 3,
  },
  healthcard: {
    key: "healthcard", name: "Health Card", shelf: "Life", desc: "Allergies, Conditions, Doctors, Emergency Contacts", cat: "red", icon: "person",
    noun: "Entry", plural: "Entries", headline: "name", show: ["kind", "detail", "contact"], entry: "Person",
    fields: [f("name", "Item"), f("kind", "Kind", "choice", ["Allergy", "Condition", "Doctor", "Contact", "Vaccine", "Other"]), f("detail", "Detail"), f("contact", "Phone")],
    // Emergency block FIRST (Dave's fix item): who to call, then what could hurt you, then the rest. Nothing here is a task, so no row has a check.
    sections: ["Emergency Contacts", "Allergies", "Conditions", "Doctors"], suggested: [f("blood", "Blood Type"), f("insurer", "Insurance")],
    view: "sheet", one: true, wave: 3, confirm: true, note: "Medications Live in Health; This Card Does Not Copy Them",
  },
  petcard: {
    key: "petcard", name: "Pet Card", shelf: "Life", desc: "Vaccines, Medications, Vet, Feeding", cat: "red", icon: "person",
    noun: "Entry", plural: "Entries", headline: "name", show: ["kind", "detail", "due"], parent: "healthcard", entry: "Pet",
    fields: [f("name", "Item"), f("kind", "Kind", "choice", ["Vaccine", "Medication", "Vet", "Feeding", "Other"]), f("detail", "Detail"), f("due", "Due", "date")],
    sections: ["Vaccines", "Medications", "Vet", "Feeding and Care"], view: "sheet", wave: 3, confirm: true, due: { key: "due" },
  },
  handover: {
    key: "handover", name: "Handover Sheet", shelf: "Life", desc: "Everything Someone Needs to Cover for You", cat: "teal", icon: "checks",
    noun: "Item", plural: "Items", headline: "topic", show: ["detail", "who"], entry: "Handover Sheet",
    fields: [f("topic", "Topic"), f("detail", "What to Know"), f("who", "Who")],
    sections: ["Right Now", "Every Day", "If Something Goes Wrong", "Contacts"], suggested: [f("where", "Where It Is"), f("when", "When")],
    // A REFERENCE PAGE, NOT A LIST OF THINGS TO TICK OFF (Dave's fix item): the rows are what someone needs to know, read in full. A page
    // with none says one plain line, never rows that look like instructions to clear.
    view: "sheet", wave: 3, confirm: true, plainEmpty: "Write What Someone Covering for You Needs to Know",
  },
  carerecord: {
    key: "carerecord", name: "Care Record", shelf: "Life", desc: "Dated Entries of Who Cared for What", cat: "teal", icon: "clock",
    noun: "Entry", plural: "Entries", headline: "what", show: ["date", "who"], parent: "handover", entry: "Care Record",
    fields: [f("date", "Date", "date"), f("who", "Who"), f("what", "What Was Done"), f("notes", "Notes")], view: "sheet", wave: 3, sort: "dateDesc",
  },
  occasions: {
    key: "occasions", name: "People and Occasions", shelf: "Life", desc: "Birthdays, Anniversaries, Gift Ideas and Budgets", cat: "pink", icon: "sparkles",
    noun: "Occasion", plural: "Occasions", headline: "name", show: ["occasion", "date", "gift", "budget"],
    fields: [f("name", "Person"), f("occasion", "Occasion", "choice", ["Birthday", "Anniversary", "Holiday", "Other"]), f("date", "Date", "date"), f("gift", "Gift Ideas"), f("budget", "Budget", "money"), f("done", "Handled This Year", "check")],
    totals: [{ key: "budget", label: "Budget", money: true }], view: "occasions", one: true, wave: 3, sort: "next", due: { key: "date", yearly: true },
    note: "A Date Comes Round Every Year; the Page Says When One Is Near",
  },
  trip: {
    key: "trip", name: "Trip Sheet", shelf: "Life", desc: "Getting There, Staying, Doing, Packing, What It Costs", cat: "sky", icon: "send",
    noun: "Item", plural: "Items", headline: "item", show: ["when", "where", "confirmation", "cost"], entry: "Trip Sheet",
    fields: [f("item", "Item"), f("done", "Done", "check"), f("when", "When", "date"), f("where", "Where"), f("confirmation", "Confirmation"), f("cost", "Cost", "money")],
    sections: ["Getting There", "Staying", "Doing", "Packing"], totals: [{ key: "cost", label: "Cost", money: true }],
    starter: [{ sec: "Getting There", v: { item: "Flights" } }, { sec: "Staying", v: { item: "Hotel" } }], view: "sheet", wave: 3,
  },
  expenses: {
    key: "expenses", name: "Expenses to Submit", shelf: "Life", desc: "Receipts to Turn In, Totalled, Checked Off", cat: "sky", icon: "dollar",
    noun: "Expense", plural: "Expenses", headline: "vendor", show: ["date", "amount", "for", "status"], parent: "trip", entry: "Expenses to Submit",
    // The 2026-10-13 spec: a reimbursement status, with the headings following it; the submitted date is one tap away.
    fields: [f("vendor", "Vendor"), f("submitted", "Submitted", "check"), f("status", "Status", "choice", ["To Submit", "Submitted", "Reimbursed"]), f("date", "Date", "date"), f("amount", "Amount", "money"), f("for", "For"), f("receipt", "Receipt", "check")],
    sections: ["To Submit", "Submitted", "Reimbursed"], suggested: [f("submittedOn", "Submitted On", "date")], totals: [{ key: "amount", label: "Total", money: true }], view: "sheet", wave: 3, sort: "dateDesc",
  },
  recipes: {
    key: "recipes", name: "Recipes", shelf: "Life", desc: "Recipes, Meal Plan, Freezer", cat: "green", icon: "list", shelfName: "Kitchen Page", entry: "Recipes",
    noun: "Recipe", plural: "Recipes", headline: "name", show: ["serves", "time", "source"],
    fields: [f("name", "Recipe"), f("serves", "Serves"), f("time", "Time"), f("ingredients", "Ingredients"), f("steps", "Directions"), f("source", "Source")],
    sections: ["Mains", "Sides", "Desserts", "Other"], view: "sheet", wave: 3,
  },
  mealplan: {
    key: "mealplan", name: "Meal Plan", shelf: "Life", desc: "A Week of Meals, Day by Day", cat: "green", icon: "calendar",
    noun: "Meal", plural: "Meals", headline: "meal", show: ["type", "notes"], parent: "recipes", entry: "Meal Plan",
    fields: [f("meal", "Meal"), f("type", "Type", "choice", ["Breakfast", "Lunch", "Dinner", "Snack"]), f("notes", "Notes")],
    sections: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    starter: [0, 1, 2, 3, 4, 5, 6].map((sec) => ({ sec, v: { meal: "Dinner", type: "Dinner" } })), view: "sheet", wave: 3,
  },
  freezer: {
    key: "freezer", name: "Freezer", shelf: "Life", desc: "What Is in There, How Much, Use By", cat: "green", icon: "gauge",
    noun: "Item", plural: "Items", headline: "item", show: ["qty", "frozen", "useby"], parent: "recipes", entry: "Freezer",
    fields: [f("item", "Item"), f("qty", "Amount"), f("frozen", "Frozen", "date"), f("useby", "Use By", "date")],
    view: "sheet", wave: 3, due: { key: "useby" },
  },
  accomplish: {
    key: "accomplish", name: "Accomplishments and Milestones", shelf: "Life", desc: "What You Finished, Dated; the App Suggests, You Confirm", cat: "yellow", icon: "zap",
    noun: "Entry", plural: "Entries", headline: "title", show: ["date", "area"],
    fields: [f("title", "What"), f("date", "Date", "date"), f("area", "Area"), f("notes", "Notes")],
    suggested: [f("who", "With"), f("proof", "Proof or Link")], view: "accomplish", one: true, wave: 3, sort: "dateDesc", alsoShelves: ["Professional"],
  },

  // ---- Wave 3: Professional
  oneonone: {
    key: "oneonone", name: "1:1 Log", shelf: "Professional", desc: "Meetings by Person: Topics, Decisions, Follow-Ups", cat: "blue", icon: "mail",
    noun: "Meeting", plural: "Meetings", headline: "date", show: ["topics", "actions", "next"],
    fields: [f("date", "Date", "date"), f("topics", "Topics"), f("notes", "Notes"), f("actions", "Follow-Ups"), f("next", "Next 1:1", "date")],
    view: "sheet", one: true, wave: 3, sort: "dateDesc", due: { key: "next" },
    // carriedForward: a new meeting starts with the last one's follow-ups.
    needs: { actions: "Follow-Ups Stop Carrying Forward to the Next 1:1" },
  },
  projtracker: {
    key: "projtracker", name: "Project Tracker", shelf: "Professional", desc: "Work Items by Status: Owner, Due, Blocked", cat: "purple", icon: "kanban",
    noun: "Item", plural: "Items", headline: "item", show: ["owner", "due", "notes"],
    fields: [f("item", "Item"), f("owner", "Owner"), f("due", "Due", "date"), f("notes", "Notes")],
    sections: ["Not Started", "In Progress", "Blocked", "Done"], suggested: [f("link", "Link"), f("size", "Size")], view: "sheet", wave: 3, due: { key: "due" },
  },
  bizledger: {
    key: "bizledger", name: "Business Ledger", shelf: "Professional", desc: "A View Over Your Money: Business Spending, Totalled", cat: "teal", icon: "table",
    noun: "Entry", plural: "Entries", headline: "vendor", show: ["date", "amount"],
    fields: [f("date", "Date", "date"), f("vendor", "Vendor"), f("category", "Category"), f("amount", "Amount", "money"), f("from", "From")],
    view: "bizledger", wave: 3, derived: true, meta: { category: "Business", year: "" }, parent: "moneymap", entry: "Business Ledger",
    note: "Read From Money; Nothing Here Is a Second Ledger",
  },

  // ---- Wave 4: Entertainment
  bracket: {
    key: "bracket", name: "Brackets and Pools", shelf: "Entertainment", desc: "Single Elimination, Round Robin or a Fantasy Draft: Pick Winners, Watch Them Advance", cat: "orange", icon: "kanban",
    noun: "Entrant", plural: "Entrants", headline: "name", show: ["notes"], fields: [f("name", "Name"), f("notes", "Notes")],
    suggested: [f("seed", "Seed"), f("contact", "Contact"), f("pos", "Position")], view: "bracket", wave: 4, meta: { format: "single" },
    // The Fantasy Draft Board folded in on 2026-10-23 as a format (Single Elimination, Round Robin, Fantasy Draft): entrants become picks in
    // order, with the teams and snake or straight order the draft board always had.
  },
  draft: {
    key: "draft",
    retired: "Folded Into Brackets and Pools as a Format", name: "Fantasy Draft Board", shelf: "Entertainment", desc: "Teams, Snake or Straight, Who Is on the Clock", cat: "green", icon: "list",
    noun: "Pick", plural: "Picks", headline: "player", show: ["pos", "club"],
    fields: [f("player", "Player"), f("pos", "Position", "choice", ["QB", "RB", "WR", "TE", "K", "DEF", "G", "F", "C", "SP", "RP", "Other"]), f("club", "Team")],
    suggested: [f("notes", "Notes"), f("adp", "Projected Pick", "number")], view: "draft", wave: 4, meta: { teams: "", snake: "1" },
  },
  watchlist: {
    key: "watchlist", name: "Watch List", shelf: "Entertainment", desc: "Movies and Shows: Up Next, Watching, Watched, Who Liked What", cat: "purple", icon: "clock",
    noun: "Title", plural: "Titles", headline: "title", show: ["kind", "where", "rating"],
    fields: [f("title", "Title"), f("kind", "Kind", "choice", ["Movie", "Show", "Documentary", "Other"]), f("where", "Where to Watch"), f("rating", "How It Was", "choice", ["Loved It", "Liked It", "It Was Fine", "Skip It"]), f("who", "Recommended By")],
    sections: ["Up Next", "Watching", "Watched"], suggested: [f("length", "Length"), f("notes", "Notes")], view: "sheet", wave: 4,
  },
  party: {
    key: "party", name: "Party Planner", shelf: "Entertainment", desc: "Guests, Food, Supplies, Schedule, What It Costs", cat: "pink", icon: "sparkles",
    noun: "Item", plural: "Items", headline: "item", show: ["rsvp", "who", "cost"],
    fields: [f("item", "Item or Guest"), f("done", "Done", "check"), f("rsvp", "RSVP", "choice", ["Yes", "No", "Maybe"]), f("who", "Who"), f("cost", "Cost", "money")],
    sections: ["Guests", "Food and Drink", "Supplies", "Schedule", "To Do"], totals: [{ key: "cost", label: "Cost", money: true }],
    starter: [{ sec: "To Do", v: { item: "Send Invites" } }], suggested: [f("notes", "Notes"), f("when", "When")], view: "sheet", wave: 4,
  },
  runorder: {
    key: "runorder",
    retired: "Folded Into the Event Day Pack as Its Timeline", name: "Running Order", shelf: "Entertainment", desc: "A Show or Event, Item by Item, Clock Times From the Start", cat: "blue", icon: "timer",
    noun: "Item", plural: "Items", headline: "item", show: ["min", "who"],
    fields: [f("item", "Item"), f("min", "Minutes", "number"), f("who", "Who"), f("notes", "Notes")],
    sections: ["Before", "Show", "After"], totals: [{ key: "min", label: "Min" }],
    starter: [{ sec: "Before", v: { item: "Doors Open" } }, { sec: "Show", v: { item: "Opening" } }, { sec: "After", v: { item: "Strike" } }],
    suggested: [f("cue", "Cue"), f("where", "Where")], view: "session", wave: 4, meta: { start: "" },
    // sessionClock, as the Session Plan.
    needs: { min: "Clock Times From the Start Stop Working" },
  },
  poker: {
    key: "poker", name: "Poker Night", shelf: "Entertainment", desc: "Buy-Ins, Cash-Outs, Who Owes Whom", cat: "red", icon: "dollar",
    noun: "Player", plural: "Players", headline: "name", show: ["buyin", "cashout"],
    fields: [f("name", "Player"), f("buyin", "Buy-In", "money"), f("rebuy", "Rebuys", "money"), f("cashout", "Cash-Out", "money")],
    suggested: [f("notes", "Notes")], view: "poker", wave: 4,
    // pokerRows: each player's net is the cash-out less the buy-in and rebuys.
    needs: { buyin: "Who Owes Whom Stops Adding Up", rebuy: "Who Owes Whom Stops Adding Up", cashout: "Who Owes Whom Stops Adding Up" },
  },
};

export const TEMPLATE_NAMES = Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, TEMPLATES[k].name])) as Record<TemplateKey, string>;

export function templateDef(kind: string): TemplateDef | null {
  return (TEMPLATES as Record<string, TemplateDef>)[kind] ?? null;
}

export const isTemplateKey = (k: string): k is TemplateKey => (TEMPLATE_KEYS as readonly string[]).includes(k);

// Local, so this file keeps to pageModel's types only (pageModel reads TEMPLATE_NAMES from here when it loads).
const rid = (): string => "r_" + (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 13).replace(/-/g, "") : Math.random().toString(36).slice(2, 13));

/** A page of a catalog template, at its smallest useful size: its fields, every heading, and the starter rows its def implies.
 *  A profile starts with its one record. */
export function newTemplatePage(key: TemplateKey): import("./pageModel").PageData {
  const d = TEMPLATES[key];
  const sections = d.sections ? d.sections.map((label, i) => ({ key: "s" + i, label })) : [];
  const secKey = (sec: number | string | undefined): string | undefined => {
    if (sec === undefined) return undefined;
    const s = typeof sec === "number" ? sections[sec] : sections.find((x) => x.label === sec);
    return s?.key;
  };
  const starters = (d.starter ?? []).map((r) => { const sec = secKey(r.sec); return { id: rid(), v: { ...r.v }, ...(sec ? { sec } : {}) }; });
  return {
    v: 1,
    kind: key,
    fields: d.fields.map((x) => ({ ...x, ...(x.options ? { options: [...x.options] } : {}) })),
    records: d.view === "profile" ? [{ id: rid(), v: {} }] : starters,
    ...(d.sections ? { sections } : {}),
    ...(d.meta ? { meta: { ...d.meta } } : {}),
  };
}
