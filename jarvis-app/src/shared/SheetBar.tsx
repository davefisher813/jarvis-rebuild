// THE SHEET HEADER (ruled 2026-09-01, "Sheets, the shared chrome": "Cancel,
// title, Save bar"; first worn by the exercise sheet 2026-09-02). Cancel on
// the left in the quiet ink, the sheet's name in the middle, the one verb on
// the right in the tint. Built once here so every sheet that ports to the
// ruling gets the same bar, the way PageHeader is one bar for every page.
export default function SheetBar({
  title,
  onCancel,
  onSave,
  saveLabel = "Save",
  saveDisabled = false,
}: {
  title: string;
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
  /** Dimmed, still tappable: the tap is what surfaces the missing thing. */
  saveDisabled?: boolean;
}) {
  return (
    <div className="sheet-bar">
      <button type="button" className="sheet-bar-cancel" onClick={onCancel}>Cancel</button>
      <div className="sheet-bar-title">{title}</div>
      <button type="button" className={"sheet-bar-save" + (saveDisabled ? " dim" : "")} onClick={onSave}>{saveLabel}</button>
    </div>
  );
}
