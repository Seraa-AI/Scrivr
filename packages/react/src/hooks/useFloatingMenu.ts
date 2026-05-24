import { useEffect, useState } from "react";
import { createFloatingMenu } from "@scrivr/core";
import type { Editor, FloatingMenuOptions } from "@scrivr/core";
import { useFloatingPosition } from "./useFloatingPosition";

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
      onHide: () => {
        setRect(null);
      },
      getPopoverElement: () => ref.current,
    };
    if (options.shouldShow) opts.shouldShow = options.shouldShow;
    return createFloatingMenu(editor, opts);
  }, [editor, options.shouldShow]);

  return { visible: !!rect, rect, position, rootRef: ref };
}
