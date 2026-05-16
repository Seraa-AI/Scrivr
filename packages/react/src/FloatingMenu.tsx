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
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createFloatingMenu } from "@scrivr/core";
import type { FloatingMenuOptions } from "@scrivr/core";
import type { Editor } from "@scrivr/core";
import { useFloatingPosition } from "./useFloatingPosition";

export interface FloatingMenuProps {
  editor: Editor | null;
  children: ReactNode;
  shouldShow?: FloatingMenuOptions["shouldShow"] | undefined;
  className?: string | undefined;
}

export function useFloatingMenu(
  editor: Editor | null,
  options: { shouldShow?: FloatingMenuOptions["shouldShow"] | undefined } = {},
) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const { ref, position } = useFloatingPosition<HTMLDivElement>(rect, [], {
    placement: "left",
  });

  useEffect(() => {
    if (!editor) return;
    const opts: FloatingMenuOptions = {
      onShow: setRect,
      onMove: setRect,
      onHide: () => { setRect(null); },
    };
    if (options.shouldShow) opts.shouldShow = options.shouldShow;
    return createFloatingMenu(editor, opts);
  }, [editor, options.shouldShow]);

  return { visible: !!rect, rect, position, rootRef: ref };
}

export function FloatingMenu({ editor, children, shouldShow, className }: FloatingMenuProps) {
  const menu = useFloatingMenu(editor, { shouldShow });

  if (!menu.visible) return null;

  return createPortal(
    <div
      ref={menu.rootRef}
      className={className}
      style={{
        position:   "fixed",
        left:       menu.position?.x ?? 0,
        top:        menu.position?.y ?? 0,
        zIndex:     "var(--scrivr-react-floating-z, 50)",
        visibility: menu.position ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
