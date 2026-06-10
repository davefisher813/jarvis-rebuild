import { slotForName, personInitials } from "../people/types";

// Demo-only dataset so the inbox feels real in the preview. The shipped app
// replaces this with live Gmail (web) and iMessage (native) once connected;
// nothing here is a stored entity. Content is generic, not user-specific.
export interface MailRow { from: string; date: string; subject: string; preview: string; unread: boolean; }
export interface DraftRow { name: string; subject: string; preview: string; }
export interface SchedRow { name: string; subject: string; sends: string; }
export interface TextRow { name: string; time: string; preview: string; unread: boolean; }

export const EMAILS: MailRow[] = [
  { from: "Priya Shah", date: "9:24 AM", subject: "Re: Q3 roadmap review", preview: "Looks good. One note on the timeline for the second milestone before we lock it.", unread: true },
  { from: "Stripe", date: "8:02 AM", subject: "Your payout is on the way", preview: "A payout of $4,210.00 is expected to arrive in your account by Tuesday.", unread: true },
  { from: "Acme HR", date: "Yesterday", subject: "Open enrollment ends Friday", preview: "Action needed: confirm your benefits selections before the window closes.", unread: false },
  { from: "Dana Whitfield", date: "Yesterday", subject: "Lunch next week?", preview: "Free Thursday or Friday? Would love to catch up and hear how the launch went.", unread: false },
  { from: "GitHub", date: "Mon", subject: "Security alert", preview: "A new sign-in to your account from a recognized device was just confirmed.", unread: false },
];

export const DRAFTS: DraftRow[] = [
  { name: "Marcus Lee", subject: "Proposal v2", preview: "Thanks for the quick turnaround. Attached is the revised scope and..." },
];

export const SCHEDULED: SchedRow[] = [
  { name: "Team", subject: "Weekly priorities", sends: "Sends Monday, 8:00 AM" },
];

export const TEXTS: TextRow[] = [
  { name: "Dana Whitfield", time: "9:31 AM", preview: "Sounds good, see you then. I'll book the table.", unread: true },
  { name: "Marcus Lee", time: "8:47 AM", preview: "Sent the file over, let me know what you think.", unread: false },
  { name: "Mom", time: "Yesterday", preview: "Call me when you get a chance, nothing urgent.", unread: false },
  { name: "Priya Shah", time: "Mon", preview: "Great work today, the team was impressed.", unread: false },
];

export const avFor = (name: string) => ({ slot: slotForName(name), initials: personInitials(name) });
