import type { AILevel } from "../ai/aiGate";
import type { DocBlock, DocKind } from "./types";

// WHAT A DOCUMENT'S ROW SAYS (build order: "plain-language lifecycle"). One pure function from the file's `doc` block to the words, so
// the row, the tests and the acceptance checks read one table. Title Case, facts as separate spans (the dot is drawn by CSS, never typed).
// Nothing here guesses: a state it does not know reads as Saved, which is always true.

export type RowAction = "review" | "retry" | "open";

export interface RowWords {
  title: string;
  /** Each is one fact span under the title. */
  facts: string[];
  /** The one thing a tap on the row does, when it is more than opening the document. */
  action?: RowAction;
  /** True while the worker is busy with it, so the row can say it is alive. */
  working?: boolean;
}

export const KIND_NAME: Record<DocKind, string> = {
  bill: "Bill", schedule: "Schedule", "task-list": "To-Do List", letter: "Letter", receipt: "Receipt", general: "Document",
};

const pageWord = (n: number): string => (n === 1 ? "1 Page" : `${n} Pages`);
// Up to four pages are named; more than that is a count, because a long list on a row is noise and "6 and More" breaks the number rule.
const pagesMissing = (p: number[]): string => (p.length === 1 ? `Page ${p[0]} Missing` : p.length <= 4 ? `Pages ${p.join(", ")} Missing` : `${p.length} Pages Missing`);

export function rowWords(block: DocBlock | undefined, opts: { aiLevel: AILevel }): RowWords {
  const b = block;
  if (!b || b.state === "stored") {
    // A photo is read on the phone before the server sees it. Until a phone reader exists in the app this is said as it is.
    if (b?.errorCode === "NO_TEXT") return { title: "Saved", facts: ["Photos Can't Be Read Yet"] };
    return { title: "Saved", facts: ["Waiting to Be Read"], working: true };
  }
  switch (b.state) {
    case "uploading": return { title: "Uploading", facts: [], working: true };
    case "reading": return { title: "Reading", facts: [], working: true };
    case "extracting": return { title: "Reviewing", facts: [], working: true };
    case "proposed": return { title: "Ready to Review", facts: b.kind ? [KIND_NAME[b.kind]] : [], action: "open" };
    case "filed": return { title: "Filed", facts: b.filedTo ? [b.filedTo] : [], action: "open" };
    case "unreadable":
      if (b.errorCode === "ENCRYPTED") return { title: "Password Protected", facts: ["Can't Be Read"] };
      if (b.errorCode === "PARSER") return { title: "Couldn't Open This File", facts: [] };
      return { title: "No Text to Read", facts: b.pages ? [pageWord(b.pages)] : [] };
    case "failed":
      if (b.errorCode === "OUTCOME_UNKNOWN") return { title: "Reading Didn't Finish", facts: ["Tap to Try Again"], action: "retry" };
      return { title: "Couldn't Read This", facts: ["Tap to Try Again"], action: "retry" };
    case "read-partial":
    case "read": {
      const partial = b.state === "read-partial";
      const facts: string[] = [];
      if (partial && b.missingPages?.length) facts.push(pagesMissing(b.missingPages));
      else if (b.pages) facts.push(pageWord(b.pages));
      // The credit state is named: the document is safe and has been read, only the review is waiting on the account.
      if (b.errorCode === "CREDIT") return { title: "Saved, Not Read Yet", facts: ["The AI Account Needs Credit"], action: "retry" };
      if (b.waiting) return { title: "Waiting", facts: ["AI Is Busy Right Now"], working: true };
      if (b.notReviewed) {
        facts.push("Not Reviewed Yet");
        // Off cannot review; On Request reviews on a tap; a review that was skipped otherwise is offered the same way.
        return { title: partial ? "Partly Read" : "Read", facts, ...(opts.aiLevel === "off" ? {} : { action: "review" as const }) };
      }
      // A row holds a title and one or two facts and no more (a third was cut off on the phone's width in the render): the missing pages win
      // on a partial read, and a known kind takes the place of the page count on a full one.
      if (b.kind && !(partial && b.missingPages?.length)) return { title: partial ? "Partly Read" : "Read", facts: [`Looks Like a ${KIND_NAME[b.kind]}`] };
      return { title: partial ? "Partly Read" : "Read", facts };
    }
    default: return { title: "Saved", facts: [] };
  }
}
