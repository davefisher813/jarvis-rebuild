// EVERY CARD TO REVIEW, IN EMAIL (Dave 2026-10-12; spec section 7: the generic review count leaves Today and stays on
// the Email surface). The inbox's own review focus showed only the cards on the pages this phone had loaded and said
// "N More in Older Mail" for the rest; this list asks the server for every message the count counts
// (candidates_to_review, migration 0068), newest first, and draws each with its cards under it, exactly as the inbox
// does. On a database without 0068 it falls back to the loaded pages and says nothing it cannot prove. A row opens the
// message sheet; a card saves, dismisses or opens its details from here. Nothing is approved by reading.
import type { ReactNode } from "react";
import PageHeader from "../shared/PageHeader";
import SkeletonRows from "../shared/SkeletonRows";
import InboxList from "./InboxList";
import EmptyState from "./EmptyState";
import { EMAIL_TITLE, EMPTY_REVIEW, REVIEW_LIST_TITLE } from "./copy";
import { dayGroups } from "./format";
import type { InboxRow } from "./emailClient";

export default function ReviewListScreen({ rows, loading, labels, now, onBack, onOpen, renderBelow }: {
  /** The messages with a card to review; null while the first read is out. */
  rows: InboxRow[] | null;
  loading: boolean;
  labels: Record<string, string>;
  now: Date;
  onBack: () => void;
  onOpen: (row: InboxRow) => void;
  renderBelow: (row: InboxRow) => ReactNode;
}) {
  return (
    <div className="screen ruled">
      <PageHeader title={REVIEW_LIST_TITLE} back={EMAIL_TITLE} onBack={onBack} />
      {loading && !rows && <SkeletonRows rows={3} />}
      {rows && rows.length === 0 && <EmptyState copy={EMPTY_REVIEW} onAction={onBack} />}
      {rows && rows.length > 0 && <InboxList groups={dayGroups(rows, now)} labels={labels} now={now} atEnd onOpen={onOpen} renderBelow={renderBelow} />}
      <div className="screen-foot" />
    </div>
  );
}
