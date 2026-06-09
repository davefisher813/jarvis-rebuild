// Loading placeholder: shimmer rows shown while a list's first load is in flight
// (iOS convention 9). Uses the design system's skel-* classes.
export default function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="pad-x"><div className="card">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skel-row" key={i}>
          <div className="skel-circle" />
          <div className="skel-stack"><div className="skel-line" /><div className="skel-line short" /></div>
        </div>
      ))}
    </div></div>
  );
}
