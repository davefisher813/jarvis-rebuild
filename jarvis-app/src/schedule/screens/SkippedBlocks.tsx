// THE BLOCKS A DAY SKIPS (JUST THIS DAY, 2026-10-01). A block skipped for one
// date is gone from that day's list and from the planner's walls, which is the
// point, and it also leaves nothing to tap. This is the one place it stays
// visible, as a quiet line with the door back, so skipping is never a one-way
// trip. Rendered by the day list on Schedule and by Your Day on Today.
export interface SkippedBlock { s: number; e: number; label: string; id?: string }

export default function SkippedBlocks({ blocks, onBackToNormal }: { blocks: SkippedBlock[]; onBackToNormal?: (blockId: string) => void }) {
  if (blocks.length === 0) return null;
  return (
    <div className="skipped-blocks">
      {blocks.map((b) => {
        return (
          <div className="skipped-row" key={b.id ?? b.label + b.s}>
            <span className="skipped-t">{b.label} <span className="skipped-w">&middot; Skipped Today</span></span>
            {b.id && onBackToNormal && (
              <button type="button" className="block-add skipped-back" onClick={() => onBackToNormal(b.id!)}>Back to Normal</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
