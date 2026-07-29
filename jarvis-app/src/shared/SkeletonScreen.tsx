// Loading skeleton in the shape of a JARVIS page: hero lines plus two cards,
// shimmering with the existing skel tokens. Used as the Suspense fallback for
// lazy tabs and for Today's initial data load, so loading never shows a void.
// All sizing lives in components.css (.skel-screen rules); no inline styles.
export default function SkeletonScreen({ hero = true }: { hero?: boolean }) {
  return (
    <div className="screen skel-screen" aria-hidden="true">
      {hero && (
        <div className="skel-hero">
          <div className="skel-line" />
          <div className="skel-line" />
          <div className="skel-line" />
        </div>
      )}
      <div className="skel-card">
        <div className="skel-line" />
        <div className="skel-line" />
      </div>
      <div className="skel-card">
        <div className="skel-line" />
        <div className="skel-line" />
        <div className="skel-line" />
      </div>
    </div>
  );
}
