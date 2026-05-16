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
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createBubbleMenu } from "@scrivr/core";
import type { BubbleMenuOptions } from "@scrivr/core";
import type { Editor } from "@scrivr/core";
import { useFloatingPosition } from "./useFloatingPosition";

export interface BubbleMenuProps {
  editor: Editor | null;
  children: ReactNode;
  /** Override the default shouldShow logic. */
  shouldShow?: BubbleMenuOptions["shouldShow"] | undefined;
  className?: string | undefined;
}

export function useBubbleMenu(
  editor: Editor | null,
  options: { shouldShow?: BubbleMenuOptions["shouldShow"] | undefined } = {},
) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const { ref, position } = useFloatingPosition<HTMLDivElement>(rect, [], {
    placement: "top",
  });

  useEffect(() => {
    if (!editor) return;
    const opts: BubbleMenuOptions = {
      onShow: setRect,
      onMove: setRect,
      onHide: () => { setRect(null); },
    };
    if (options.shouldShow) opts.shouldShow = options.shouldShow;
    return createBubbleMenu(editor, opts);
  }, [editor, options.shouldShow]);

  return { visible: !!rect, rect, position, rootRef: ref };
}

export function BubbleMenu({ editor, children, shouldShow, className }: BubbleMenuProps) {
  const menu = useBubbleMenu(editor, { shouldShow });

  if (!menu.visible) return null;

  return createPortal(
    <div
      ref={menu.rootRef}
      className={className}
      style={{
        position: "fixed",
        left:     menu.position?.x ?? 0,
        top:      menu.position?.y ?? 0,
        zIndex:   "var(--scrivr-react-floating-z, 50)",
        visibility: menu.position ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
