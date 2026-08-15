// Native bridge surface for the native seven (staged 2026-08-15, pre-Apple
// enrollment). These are the typed contracts the Swift plugins under
// jarvis-app/native/ios/ will register with Capacitor once signing exists.
// Every method is a stub that throws NotStagedError today, so nothing can
// accidentally ship a half-wired native path; the pure logic the bridges
// feed (dedupe, matching) lives beside this file and is fully tested now.
//
// NOTHING in the existing app imports this module yet, by design: the web
// build must not change until the native wiring session.

// MARK: not-staged guard

export class NotStagedError extends Error {
  constructor(bridge: string, method: string) {
    super(`not staged: ${bridge}.${method} needs Apple Developer enrollment`);
    this.name = "NotStagedError";
  }
}

function notStaged(bridge: string, method: string): never {
  throw new NotStagedError(bridge, method);
}

// MARK: 1. Apple Health (read-only)

// Read scopes are workouts, steps, sleep, and nothing else. There is no
// write method on this interface on purpose: JARVIS never writes to
// HealthKit, and the absence of the method is the enforcement.

export type HealthAuthStatus = "granted" | "denied" | "undetermined";

export interface HealthWorkoutRecord {
  // HealthKit sample UUID string, stable per workout.
  uid: string;
  // Epoch ms.
  start: number;
  end: number;
  // HKWorkoutActivityType name, lowercased ("running", "traditionalStrengthTraining").
  activityType: string;
  // Active energy in kcal when HealthKit has it.
  calories?: number;
  // Recording source ("Apple Watch"), display only.
  sourceName?: string;
}

export interface HealthStepsDay {
  dayISO: string;
  steps: number;
}

export interface HealthSleepNight {
  // The morning the sleep ended, ISO date.
  dayISO: string;
  asleepMinutes: number;
  inBedMinutes: number;
}

export interface HealthBridge {
  requestReadAuthorization(): Promise<HealthAuthStatus>;
  queryWorkouts(sinceMs: number): Promise<HealthWorkoutRecord[]>;
  querySteps(fromDayISO: string, toDayISO: string): Promise<HealthStepsDay[]>;
  querySleep(fromDayISO: string, toDayISO: string): Promise<HealthSleepNight[]>;
}

export const healthBridge: HealthBridge = {
  requestReadAuthorization: () => notStaged("HealthBridge", "requestReadAuthorization"),
  queryWorkouts: () => notStaged("HealthBridge", "queryWorkouts"),
  querySteps: () => notStaged("HealthBridge", "querySteps"),
  querySleep: () => notStaged("HealthBridge", "querySleep"),
};

// MARK: 2. Apple Calendar + Reminders (EventKit)

// Read everything, write ONE thing: completing an imported reminder marks
// it complete in Reminders, so the two lists never disagree about done.

export interface EKEventRecord {
  icalUid: string;
  title: string;
  start: number;
  end: number;
  calendarTitle?: string;
  location?: string;
  allDay: boolean;
}

export interface EKReminderRecord {
  icalUid: string;
  title: string;
  // Epoch ms when the reminder has a due date.
  due?: number;
  completed: boolean;
  listTitle?: string;
}

export interface EventKitBridge {
  requestCalendarAccess(): Promise<boolean>;
  requestRemindersAccess(): Promise<boolean>;
  queryEvents(windowStartMs: number, windowEndMs: number): Promise<EKEventRecord[]>;
  queryReminders(): Promise<EKReminderRecord[]>;
  // The single sanctioned write of the whole native seven.
  completeReminder(icalUid: string): Promise<boolean>;
}

export const eventKitBridge: EventKitBridge = {
  requestCalendarAccess: () => notStaged("EventKitBridge", "requestCalendarAccess"),
  requestRemindersAccess: () => notStaged("EventKitBridge", "requestRemindersAccess"),
  queryEvents: () => notStaged("EventKitBridge", "queryEvents"),
  queryReminders: () => notStaged("EventKitBridge", "queryReminders"),
  completeReminder: () => notStaged("EventKitBridge", "completeReminder"),
};

// MARK: 3. Contacts (read-only enrichment)

// Match existing people by phone or email, fill ONLY missing fields, never
// create people, never write back to the device. The matching itself is
// pure logic in contactsMatch.ts; this bridge only reads.

export interface DeviceContact {
  id: string;
  givenName?: string;
  familyName?: string;
  phones: string[];
  emails: string[];
  // Opaque ref the native side resolves to thumbnail bytes on demand.
  photoRef?: string;
}

export interface ContactsBridge {
  requestAccess(): Promise<boolean>;
  queryContacts(): Promise<DeviceContact[]>;
  fetchPhoto(photoRef: string): Promise<string | null>; // base64 or null
}

export const contactsBridge: ContactsBridge = {
  requestAccess: () => notStaged("ContactsBridge", "requestAccess"),
  queryContacts: () => notStaged("ContactsBridge", "queryContacts"),
  fetchPhoto: () => notStaged("ContactsBridge", "fetchPhoto"),
};

// MARK: 4. Notification actions

// Done completes the task from the banner. Tomorrow uses the SAME push
// mechanics as Auto-Sweep: TasksService.setDue with slipped, so the slips
// counter advances and task.pushed fires (see tasks/autoSweep.ts). The
// native side only reports which button was hit on which task.

export type NotificationAction = "done" | "tomorrow";

export interface NotificationActionEvent {
  action: NotificationAction;
  taskId: string;
}

export interface NotificationActionsBridge {
  registerCategories(): Promise<void>;
  onAction(handler: (event: NotificationActionEvent) => void): void;
}

export const notificationActionsBridge: NotificationActionsBridge = {
  registerCategories: () => notStaged("NotificationActionsBridge", "registerCategories"),
  onAction: () => notStaged("NotificationActionsBridge", "onAction"),
};

// MARK: 5. Home Screen widget shared state

// The widget renders EXACTLY what Up Next shows, from a JSON snapshot the
// app writes to the App Group container on every Up Next change. It never
// computes its own ranking: one brain, two screens.

export interface WidgetTaskEntry {
  id: string;
  text: string;
  reason: string;
  // jarvis:// deep link the widget opens.
  url: string;
}

export interface WidgetEventEntry {
  id: string;
  title: string;
  start: number;
  end: number;
  url: string;
}

export interface WidgetState {
  writtenAt: number;
  nextTask: WidgetTaskEntry | null;
  nextEvent: WidgetEventEntry | null;
  // Upcoming event boundaries (epoch ms) so the timeline provider can place
  // an entry at each transition instead of polling.
  boundaries: number[];
}

export interface WidgetStateBridge {
  writeSharedState(state: WidgetState): Promise<void>;
  reloadTimelines(): Promise<void>;
}

export const widgetStateBridge: WidgetStateBridge = {
  writeSharedState: () => notStaged("WidgetStateBridge", "writeSharedState"),
  reloadTimelines: () => notStaged("WidgetStateBridge", "reloadTimelines"),
};

// MARK: 6. Leave By Live Activity

// Countdown to leave-by on the lock screen and Dynamic Island. Ends itself
// at departure time plus grace; the app can end it early when the event is
// cancelled or the user leaves.

export interface LeaveByActivityState {
  eventId: string;
  eventTitle: string;
  destination: string;
  // Epoch ms.
  leaveAt: number;
  eventStart: number;
  // Minutes past leaveAt before the activity dismisses itself.
  graceMinutes: number;
}

export interface LiveActivityBridge {
  startLeaveBy(state: LeaveByActivityState): Promise<string>; // activity id
  updateLeaveBy(activityId: string, leaveAt: number): Promise<void>;
  endLeaveBy(activityId: string): Promise<void>;
}

export const liveActivityBridge: LiveActivityBridge = {
  startLeaveBy: () => notStaged("LiveActivityBridge", "startLeaveBy"),
  updateLeaveBy: () => notStaged("LiveActivityBridge", "updateLeaveBy"),
  endLeaveBy: () => notStaged("LiveActivityBridge", "endLeaveBy"),
};

// MARK: 7. Siri / App Intents

// AddTask feeds captured text into the existing Smart Paste pipeline.
// Capture NEVER asks a follow-up by voice: low confidence saves a note
// instead (the same refusal Smart Paste already makes on screen). NextUp
// speaks the same next item the widget and Up Next show.

export interface AddTaskCapture {
  text: string;
  capturedAt: number;
}

export interface AddTaskResult {
  // "task" when the paste pipeline was confident, "note" when it saved the
  // raw text as a note instead.
  landedAs: "task" | "note";
  id: string;
}

export interface NextUpSpoken {
  // Short fragment Siri reads aloud, built from the same reasonFor line.
  line: string;
}

export interface IntentsBridge {
  onAddTask(handler: (capture: AddTaskCapture) => Promise<AddTaskResult>): void;
  onNextUp(handler: () => Promise<NextUpSpoken>): void;
}

export const intentsBridge: IntentsBridge = {
  onAddTask: () => notStaged("IntentsBridge", "onAddTask"),
  onNextUp: () => notStaged("IntentsBridge", "onNextUp"),
};
