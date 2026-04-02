/**
 * FloatingMenu — React wrapper around createFloatingMenu.
 *
 * Renders children to the left of the cursor when the cursor is in an empty
 * text block. Intended for block-insertion UX ("+" button, slash commands).
 *
 * @example
 *   <FloatingMenu editor={editor}>
 *     <button onMouseDown={(e) => { e.preventDefault(); editor.commands.setHeading(1); }}>H1</button>
 *   </FloatingMenu>
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import { createFloatingMenu } from "@scrivr/core";
import type { FloatingMenuOptions } from "@scrivr/core";
import type { Editor } from "@scrivr/core";

interface FloatingMenuProps {
  editor: Editor | null;
  children: ReactNode;
  shouldShow?: FloatingMenuOptions["shouldShow"];
  className?: string;
}

export function FloatingMenu({ editor, children, shouldShow, className }: FloatingMenuProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!editor) return;
    const opts: FloatingMenuOptions = {
      onShow: setRect,
      onMove: setRect,
      onHide: () => { setRect(null); setPos(null); },
    };
    if (shouldShow) opts.shouldShow = shouldShow;
    return createFloatingMenu(editor, opts);
  }, [editor, shouldShow]);

  useEffect(() => {
    if (!rect || !menuRef.current) return;

    const virtualEl = {
      getBoundingClientRect: () => rect,
      getClientRects:        () => [rect] as unknown as DOMRectList,
    };

    let cancelled = false;
    computePosition(virtualEl, menuRef.current, {
      placement: "left",
      middleware: [offset(8), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => { if (!cancelled) setPos({ x, y }); });
    return () => { cancelled = true; };
  }, [rect]);

  if (!rect) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={className}
      style={{
        position:   "fixed",
        left:       pos?.x ?? 0,
        top:        pos?.y ?? 0,
        zIndex:     50,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
