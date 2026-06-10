// Placeholder for tabs whose features are not built yet (Today, Tasks,
// Schedule, Brain). Keeps the shell navigable while those are pending.
export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="screen">
      <div className="nav-large">{title}</div>
      <div className="pad-x">
        <div className="card">
          <div className="row">
            <div className="conn-name">Coming Soon</div>
          </div>
        </div>
      </div>
    </div>
  );
}
