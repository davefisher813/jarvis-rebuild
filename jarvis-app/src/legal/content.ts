// THE LEGAL TEXT, ONCE (UP-LAUNCH-05, 2026-09-05).
//
// Until now the Privacy Policy, the Terms and the Support page each existed
// twice: as a React screen under src/settings and as a static page under
// public/. SHELL-F-19 hand-copied the reviewed web text into the app to close
// a gap that had already opened once (the app named no AI provider, made no
// Google limited-use statement, and pointed at support@your-domain.com). Two
// copies of a policy is not a bug that gets fixed, it is a bug that recurs,
// and the copy App Store Connect links to is the one that has to be true.
//
// So the words live here, once. The React screens render this (legal/Body.tsx)
// and the published pages are GENERATED from it (tools/build-legal.mjs writes
// public/*.html; src/legal/sync.test.ts fails if the committed HTML no longer
// matches, and names the command that fixes it). Neither copy can move alone.
//
// This file deliberately imports nothing, so `node --experimental-strip-types`
// can load it directly in the build script without a bundler.
//
// WHAT IS NOT HERE, and why: no subscription, auto-renewal or refund terms.
// There is nothing to buy in this app today, and terms describing a purchase
// a user cannot make are the same failure as a policy describing a feature
// that does not exist. They arrive with the paywall, not before it.

/** One run of text. A plain string, bold, or a link (web renders an anchor). */
export type Inline = string | { b: string } | { a: string; href: string };

export type Block =
  /** A paragraph. */
  | { kind: "p"; runs: Inline[] }
  /** A paragraph the web page boxes in a card. The app renders it as a paragraph. */
  | { kind: "card"; runs: Inline[] }
  /** The web page renders a real list; the app renders one paragraph per item,
   *  which is what both screens already did before they shared a source. */
  | { kind: "ul"; items: Inline[][] };

export interface Section {
  /** Title Case: this names a section, so the copy law applies (Apple HIG). */
  heading: string;
  blocks: Block[];
}

export interface LegalDoc {
  /** public/<slug>.html */
  slug: string;
  /** The in-app screen title and the second half of the web <h1>. */
  title: string;
  /** Absent on Support: nothing in it is an agreement with a date. */
  updated?: string;
  /** Blocks before the first heading. */
  intro: Block[];
  sections: Section[];
  /** Rendered only on the web page, where there is no navigation bar. */
  webFooter?: Inline[];
}

// The one support address. It appears in three documents and on three
// published pages, and this is the only place it is written down.
//
// UP-LAUNCH-05: this is still a personal mailbox. support@ on the project
// domain is a Dave step (domain plus forwarding), and when it exists it is a
// one-line change here that moves all six places at once.
export const SUPPORT_EMAIL = "davefisher813@gmail.com";

const mailto = (): Inline => ({ a: SUPPORT_EMAIL, href: "mailto:" + SUPPORT_EMAIL });

export const PRIVACY: LegalDoc = {
  slug: "privacy",
  title: "Privacy Policy",
  updated: "September 5, 2026",
  intro: [
    { kind: "p", runs: ["JARVIS is a personal productivity app. This policy explains what we collect, why, and what we never do with it. The short version: your data exists to run your app, and for nothing else."] },
  ],
  sections: [
    {
      heading: "What We Collect",
      blocks: [
        {
          kind: "ul",
          items: [
            [{ b: "Account information." }, " Your email address, used to sign you in."],
            [{ b: "Your content." }, " The tasks, events, notes, people, goals, categories, and settings you create. This is your data; we store it so the app works across sessions and devices."],
            [{ b: "AI feature inputs." }, " When you use AI features (such as Plan My Day), the relevant text (for example, task names and your working hours) is sent to our AI provider, Anthropic, to generate the result. Anthropic processes it to answer your request and does not use it to train models."],
            [{ b: "Basic usage records." }, " We count AI requests per account to prevent abuse and manage costs, and we record a small, fixed set of typed events (which day the app was opened, that a task was completed) so we can tell whether the app is working. Those events carry no text you wrote: the record has columns for a category, a number and a flag, and nothing else can reach it."],
          ],
        },
      ],
    },
    {
      heading: "Google Account Data",
      blocks: [
        { kind: "p", runs: ["Optional. If you choose to connect Gmail or Google Calendar, JARVIS accesses that data solely to show your email and events inside the app. JARVIS's use of information received from Google APIs adheres to the ", { a: "Google API Services User Data Policy", href: "https://developers.google.com/terms/api-services-user-data-policy" }, ", including the Limited Use requirements. Access tokens are held in memory only. The refresh token that lets the app reconnect is encrypted and stored on our server, and it is revoked with Google when you disconnect or delete your account. You can disconnect at any time."] },
      ],
    },
    {
      heading: "What We Never Do",
      blocks: [
        { kind: "card", runs: ["We do not sell your data. We do not share it with advertisers. We do not show ads. We do not use your content to train AI models. There is no third-party analytics or advertising software in this app."] },
      ],
    },
    {
      heading: "Where Your Data Lives",
      blocks: [
        { kind: "p", runs: ["Your data is stored with Supabase (our database provider) with per-account access controls: your records are readable only by your account. The app is served by Vercel, which also runs the small server functions the app calls."] },
      ],
    },
    {
      heading: "Crash Reports",
      blocks: [
        { kind: "p", runs: ["When the app hits an error it sends us a report so we can fix it: the error's name and message, the code path it came from, the build number, and the kind of device. It carries no account identifier and none of your text. It is the only way we hear about a crash on a phone we do not own."] },
      ],
    },
    {
      heading: "Files You Upload",
      blocks: [
        { kind: "p", runs: ["Files you upload (images and PDFs) are stored privately in your account, readable only by you. We remove location data embedded in images before storing them. Files are deleted when you delete the item they belong to, or when you delete them directly."] },
      ],
    },
    {
      heading: "Conversations with JARVIS",
      blocks: [
        { kind: "p", runs: ["Your conversations with JARVIS are stored in your account so the assistant can keep context. You can delete your entire chat history at any time in Settings. Deleted history is removed from our systems and is not used afterward."] },
      ],
    },
    {
      heading: "Documents You Upload for Extraction",
      blocks: [
        { kind: "p", runs: ["Statements and documents you upload for extraction are processed to create the records you review. Merchant names from financial documents are retained with those records; you can delete any record and its source file at any time."] },
      ],
    },
    {
      heading: "Email Open Receipts",
      blocks: [
        { kind: "p", runs: ["When enabled in Settings, mail you send through JARVIS includes an invisible image that reports back when the message is first displayed. Only an anonymous identifier and a timestamp are stored; never the recipient, subject, or content. You can turn this off any time under Settings, Connections."] },
      ],
    },
    {
      heading: "How Long We Keep It",
      blocks: [
        { kind: "p", runs: ["Your content stays until you delete it or delete your account: we do not expire your notes. AI request counts are kept as abuse and cost accounting. Crash reports live in our hosting provider's logs and age out with them. Nothing is archived after an account deletion."] },
      ],
    },
    {
      heading: "Your Controls",
      blocks: [
        {
          kind: "ul",
          items: [
            [{ b: "Export." }, " Settings, Backup lets you download everything you own as a file."],
            [{ b: "Delete." }, " You can delete individual items in the app. Settings, Account, Delete Account erases your entire account: every task, note, event and uploaded file, your AI request counts, your event records, any connected Google tokens (revoked with Google as part of the deletion), and the sign-in itself. It happens while you wait, and it cannot be undone."],
          ],
        },
      ],
    },
    {
      heading: "Children and Teens",
      blocks: [
        { kind: "p", runs: ["JARVIS is not directed at children under 13, and we do not knowingly collect data from them. If you are between 13 and 17, use JARVIS with a parent's or guardian's permission. A parent or guardian can email us to have a teen's account and data deleted."] },
      ],
    },
    {
      heading: "Changes",
      blocks: [
        { kind: "p", runs: ["If this policy changes materially, we will update this page and note it in the app."] },
      ],
    },
    {
      heading: "Contact",
      blocks: [
        { kind: "p", runs: ["Questions or requests: ", mailto()] },
      ],
    },
  ],
};

export const TERMS: LegalDoc = {
  slug: "terms",
  title: "Terms of Service",
  updated: "September 5, 2026",
  intro: [
    { kind: "p", runs: ["These terms are a plain-language agreement between you and JARVIS (\"we\"). By creating an account or using the app, you agree to them."] },
  ],
  sections: [
    {
      heading: "The Service",
      blocks: [
        { kind: "p", runs: ["JARVIS is a personal productivity app: tasks, schedule, notes, and related features, with optional AI assistance. We work to keep it available and improving, but it is provided \"as is\", without warranties, and features may change."] },
      ],
    },
    {
      heading: "Your Account",
      blocks: [
        { kind: "p", runs: ["You are responsible for your account and for keeping access to your email secure. You must be at least 13 years old, and if you are under 18 you need a parent's or guardian's permission."] },
      ],
    },
    {
      heading: "Your Content",
      blocks: [
        { kind: "p", runs: ["Everything you create in JARVIS remains yours. You grant us only the limited license needed to store, process, and display it back to you, which is what makes the app function. We claim no other rights to it."] },
      ],
    },
    {
      heading: "Acceptable Use",
      blocks: [
        { kind: "p", runs: ["Don't attempt to break, overload, reverse engineer, or gain unauthorized access to the service or other people's data, and don't use the service for unlawful activity. We may suspend accounts that do."] },
        { kind: "p", runs: ["The AI features are part of that: don't use them to generate unlawful, harmful or deceptive material, and don't feed them other people's data you have no right to. AI features have per-account limits, and working around those limits is a breach of these terms."] },
      ],
    },
    {
      heading: "AI Features",
      blocks: [
        { kind: "p", runs: ["AI-generated suggestions (like a proposed day plan) are assistance, not professional advice. They can be wrong. Review them before relying on them, and never treat anything JARVIS says as medical, legal or financial advice."] },
      ],
    },
    {
      heading: "Availability and Data",
      blocks: [
        { kind: "p", runs: ["We aim for reliability and provide an export feature (Settings, Backup); we recommend keeping backups of important data. To the maximum extent permitted by law, our liability is limited to the amount you paid us in the past 12 months."] },
      ],
    },
    {
      heading: "Ending Things",
      blocks: [
        { kind: "p", runs: ["You can stop using JARVIS at any time, and Settings, Account, Delete Account ends it immediately and erases your data. We may terminate accounts that violate these terms."] },
      ],
    },
    {
      heading: "Changes",
      blocks: [
        { kind: "p", runs: ["If these terms change materially, we will update this page and note it in the app. Continued use after changes means acceptance."] },
      ],
    },
    {
      heading: "Contact",
      blocks: [
        { kind: "p", runs: [mailto()] },
      ],
    },
  ],
};

export const SUPPORT: LegalDoc = {
  slug: "support",
  title: "Support",
  intro: [
    { kind: "p", runs: ["Need help with JARVIS? You're in the right place."] },
  ],
  sections: [
    {
      heading: "Common Fixes",
      blocks: [
        {
          kind: "ul",
          items: [
            [{ b: "App looks out of date or blank." }, " Fully close the app and reopen it twice; it self-updates."],
            [{ b: "Can't log in." }, " Check that your email is typed correctly and look for the sign-in email in spam."],
            [{ b: "Something looks wrong." }, " Close and reopen the app; if it persists, email us a screenshot."],
          ],
        },
      ],
    },
    {
      heading: "Get Your Data",
      blocks: [
        { kind: "p", runs: ["Settings, Backup exports everything you own as a single file, any time."] },
      ],
    },
    {
      heading: "Contact Us",
      blocks: [
        { kind: "card", runs: ["Email ", mailto(), " and we'll get back to you as soon as we can. Include what you were doing and a screenshot if possible."] },
      ],
    },
  ],
  webFooter: [{ a: "Privacy Policy", href: "/privacy.html" }, " and ", { a: "Terms of Service", href: "/terms.html" }],
};

export const DOCS: LegalDoc[] = [PRIVACY, TERMS, SUPPORT];
