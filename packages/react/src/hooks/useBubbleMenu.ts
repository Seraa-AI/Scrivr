import { useEffect, useState } from "react";
import { createBubbleMenu } from "@scrivr/core";
import type { BubbleMenuOptions, Editor } from "@scrivr/core";
import { useFloatingPosition } from "./useFloatingPosition";

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
      onHide: () => {
        setRect(null);
      },
      // Lets the focus-outside check verify clicks landed inside this popover
      // (via the actual DOM ref) rather than relying on a marker attribute
      // the consumer might forget to add.
      getPopoverElement: () => ref.current,
    };
    if (options.shouldShow) opts.shouldShow = options.shouldShow;
    return createBubbleMenu(editor, opts);
  }, [editor, options.shouldShow]);

  return { visible: !!rect, rect, position, rootRef: ref };
}
