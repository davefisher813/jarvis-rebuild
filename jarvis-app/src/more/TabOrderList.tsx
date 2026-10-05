import { DESTINATIONS } from "../shell/destinations";
import ReorderList from "../shared/ReorderList";

// Tab order. The gesture lives in ReorderList so there is exactly one drag
// implementation in the app; this only says what a tab row looks like.
export default function TabOrderList({ keys, onReorder, handles = false }: { keys: string[]; onReorder: (next: string[]) => void | Promise<boolean | void>; handles?: boolean }) {
  const meta = (k: string) => DESTINATIONS.find((d) => d.key === k)!;
  return (
    <ReorderList
      ids={keys}
      onReorder={onReorder}
      handles={handles}
      renderRow={(k) => {
        const m = meta(k);
        return (
          <>
            <div className="sec-ico ico-surface"><m.Icon className="ic" /></div>
            <div className="row-grow"><div className="conn-name">{m.label}</div></div>
          </>
        );
      }}
    />
  );
}
