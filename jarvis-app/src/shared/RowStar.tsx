// THE REMEMBER STAR (C-50, Astra section 3). A 16px outline star at the
// leading edge of a row, filled yellow when the row's entity has a strand
// linked to it. It is not the row's control and does not count toward R.1
// (astra law 3 amended).
//
// Push D puts the glyph on strand rows as a MARKER: filled when the strand
// was written from a row (StrandData.link), hollow otherwise. The tap that
// writes or removes a linked strand lands with C-50 elsewhere (Push E), on
// the mail, task, event and people rows that own an entity to link; on a
// strand row the strand is the thing itself, so there is nothing for a tap
// to write. A span, therefore, and hidden from the accessibility tree, so
// it is never announced as a button it is not.
export default function RowStar({ on }: { on: boolean }) {
  return (
    <span className={"row-star" + (on ? " on" : "")} aria-hidden="true">
      <svg className="ic" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round">
        <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" />
      </svg>
    </span>
  );
}
