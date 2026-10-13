// DELETING A PAGE ASKS FIRST, BY NAME (2026-10-13 fix order). Every place Notes offers Delete for a page or a note opens a
// confirmation that names it, with Delete and Cancel, Cancel the default; nothing is written until Delete is tapped. The
// Undo toast after a delete stays as the second net. One wording for every entry point, so they cannot drift apart.
import { titleCase } from "../shared/casing";

/** The confirmation's head: the page by name, and whether it can come back. */
export function deleteAskTitle(name: string, forever = false): string {
  const shown = titleCase(name.trim() || "Untitled");
  return forever ? `Delete \u201c${shown}\u201d for Good, No Undo` : `Delete \u201c${shown}\u201d, Restore It Within 30 Days`;
}
