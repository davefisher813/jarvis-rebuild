// COPY, AND SAY SO ONLY IF IT WORKED (2026-09-29).
//
// Resolves when the clipboard accepted the text and rejects when it did not, so
// a caller can say "Code copied" after the await and never before. A string is
// written in the same tick as the tap (iOS drops a clipboard write that is not
// made inside the gesture). A promise of a string, for a value that has to be
// fetched first, goes through ClipboardItem, which is the one API that lets the
// write START inside the gesture and finish later; a browser without it gets
// the plain path after the value arrives, which may be refused, and says so.

export async function copyPromised(
  source: string | Promise<string>,
  nav: Pick<Navigator, "clipboard"> | undefined = typeof navigator === "undefined" ? undefined : navigator,
): Promise<void> {
  const clip = nav?.clipboard;
  if (!clip) throw new Error("No clipboard in this browser");
  if (typeof source === "string") {
    if (!clip.writeText) throw new Error("No clipboard in this browser");
    return clip.writeText(source);
  }
  if (typeof ClipboardItem !== "undefined" && typeof clip.write === "function") {
    await clip.write([new ClipboardItem({ "text/plain": source.then((t) => new Blob([t], { type: "text/plain" })) })]);
    return;
  }
  const text = await source;
  if (!clip.writeText) throw new Error("No clipboard in this browser");
  await clip.writeText(text);
}
