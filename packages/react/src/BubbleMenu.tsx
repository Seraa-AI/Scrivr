/**
 * BubbleMenu — React wrapper around createBubbleMenu.
 *
 * Renders children in a floating portal above the current text selection.
 * Position is computed from the canvas CharacterMap — no DOM text node traversal.
 *
 * @example
 *   <BubbleMenu editor={editor}>
 *     <button onMouseDown={(e) => { e.preventDefault(); editor.commands.toggleBold(); }}>B</button>
 *     <button onMouseDown={(e) => { e.preventDefault(); editor.commands.toggleItalic(); }}>I</button>
 *   </BubbleMenu>
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import { createBubbleMenu } from "@scrivr/core";
import type { BubbleMenuOptions } from "@scrivr/core";
import type { Editor } from "@scrivr/core";

interface BubbleMenuProps {
  editor: Editor | null;
  children: ReactNode;
  /** Override the default shouldShow logic. */
  shouldShow?: BubbleMenuOptions["shouldShow"];
  className?: string;
}

export function BubbleMenu({ editor, children, shouldShow, className }: BubbleMenuProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!editor) return;
    const opts: BubbleMenuOptions = {
      onShow: setRect,
      onMove: setRect,
      onHide: () => { setRect(null); setPos(null); },
    };
    if (shouldShow) opts.shouldShow = shouldShow;
    return createBubbleMenu(editor, opts);
  }, [editor, shouldShow]);

  // Re-position via floating-ui whenever rect changes
  useEffect(() => {
    if (!rect || !menuRef.current) return;

    const virtualEl = {
      getBoundingClientRect: () => rect,
      getClientRects:        () => [rect] as unknown as DOMRectList,
    };

    computePosition(virtualEl, menuRef.current, {
      placement: "top",
      middleware: [offset(8), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => setPos({ x, y }));
  }, [rect]);

  if (!rect) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={className}
      style={{
        position: "fixed",
        left:     pos?.x ?? 0,
        top:      pos?.y ?? 0,
        zIndex:   50,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
