import { useRef, useState } from "react";
import EntityStar from "../shared/EntityStar";
import RowActionSheet from "../shared/RowActionSheet";
import RowMenuButton from "../shared/RowMenuButton";
import { Brain } from "../shared/icons";
import { useLongPress } from "../shared/useLongPress";
import type { ChatMessage } from "./ChatService";

// ONE CHAT BUBBLE, WITH ITS OWN MENU (Brain "Log It", 2026-09-29).
//
// This was inline in ChatFlow's msgs.map. The long press is a hook, and a hook
// cannot live inside a map callback, so the bubble is a component: each row
// owns its press timer and its menu, and ChatFlow only says whether Brain
// exists (onFile) and what to do with the message once someone picks Log It.
//
// WITHOUT BRAIN THERE IS NOTHING HERE. No onFile, no wrapper, no button, no
// press handlers: the markup below the early return is byte for byte what the
// bubble was before, so a chat with no Brain service shows no dead control.
//
// WITH BRAIN, TWO DOORS TO ONE MENU (shared/RowActionSheet, the app's only
// row menu):
//   - a long press on the bubble (touch). A scroll is not a press: the shared
//     hook cancels on movement past 8px and on touchcancel, which is what the
//     browser sends when it takes the gesture to scroll.
//   - a real button beside the bubble (shared/RowMenuButton). Quiet until the
//     row is hovered or focused on a pointer that hovers, and out of the way
//     but still reachable for VoiceOver on a touch screen (components.css,
//     .chat-row-menu). Enter and Space are free because it is a button.
//
// WHAT THE PRESS LEAVES ALONE: text selection (the native context menu is not
// suppressed, and a press that finds a selection inside the bubble does not
// open the menu over it), the ref chips, the star and the provenance line (a
// press that starts on any control inside the bubble is that control's).
// Mouse presses never start the timer: a desktop click-and-hold is how text
// gets selected, and the button is the desktop door.

function pressStartsOnControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a, input, textarea, select, [role='button']") !== null;
}

function selectionInside(el: HTMLElement | null): boolean {
  if (!el || typeof window === "undefined" || !window.getSelection) return false;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  return !!sel.anchorNode && el.contains(sel.anchorNode);
}

export default function ChatMessageRow({ m, prov, refs, onOpen, onFile }: {
  m: ChatMessage;
  // The provenance line's words, worked out by ChatFlow (it owns the wording).
  prov: string | null;
  refs: { kind: string; id: string; label: string }[];
  onOpen?: (kind: string, id: string) => void;
  // Present only when the Brain service exists.
  onFile?: (m: ChatMessage) => void;
}) {
  const bubble = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState(false);
  const canFile = !!onFile && m.data.text.trim() !== "";
  const press = useLongPress({
    enabled: canFile,
    onLongPress: () => { if (!selectionInside(bubble.current)) setMenu(true); },
  });

  const body = (
    <div
      ref={bubble}
      className={"chat-bubble " + (m.data.role === "user" ? "chat-user" : "chat-jarvis")}
      {...(canFile ? {
        onTouchStart: (e: React.TouchEvent) => { if (!pressStartsOnControl(e.target)) press.onTouchStart(e); },
        onTouchMove: press.onTouchMove,
        onTouchEnd: press.onTouchEnd,
        onTouchCancel: press.onTouchCancel,
        // Pen only: a mouse press-and-hold is text selection, and touch is
        // handled by the touch events above (the hook says why).
        onPointerDown: (e: React.PointerEvent) => { if (e.pointerType === "pen" && !pressStartsOnControl(e.target)) press.onPointerDown(e); },
        onPointerMove: press.onPointerMove,
        onPointerUp: press.onPointerUp,
        onPointerLeave: press.onPointerLeave,
        onClickCapture: press.onClickCapture,
      } : {})}
    >
      <div className="chat-text">{m.data.text}</div>
      {/* C-50: an AI answer can be remembered; the star leads its
          provenance line and writes the answer's first line. */}
      {m.data.role === "jarvis" && prov && (
        <div className="chat-prov">
          {m.data.provenance?.kind === "ai" && <EntityStar entityType="chat_message" entityId={m.id} title={m.data.text.split("\n")[0] ?? ""} />}
          {/* §AM: an action receipt's "Done" is a done state, so it
              takes the key's green; the two source lines stay grey. */}
          {m.data.provenance?.kind === "action"
            ? <span className="fact good">{prov}</span>
            : prov}
        </div>
      )}
      {onOpen && refs.length > 0 && (
        <div className="chip-row chat-refs">
          {refs.map((r) => (
            <button
              key={r.kind + ":" + r.id}
              type="button"
              className="chip"
              onClick={() => onOpen(r.kind, r.id)}
            >{r.label}</button>
          ))}
        </div>
      )}
    </div>
  );

  if (!canFile) return body;
  return (
    <div className={"chat-row " + (m.data.role === "user" ? "chat-row-user" : "chat-row-jarvis")}>
      {body}
      <span className="chat-row-menu">
        <RowMenuButton
          what={m.data.role === "user" ? "Your Message" : "JARVIS Message"}
          onMenu={() => setMenu(true)}
        />
      </span>
      {menu && (
        <RowActionSheet
          title={m.data.role === "user" ? "Your Message" : "JARVIS Message"}
          actions={[{
            label: "Log It",
            icon: <Brain className="ic cat-fg-purple" />,
            onPick: () => onFile!(m),
          }]}
          onCancel={() => setMenu(false)}
        />
      )}
    </div>
  );
}
