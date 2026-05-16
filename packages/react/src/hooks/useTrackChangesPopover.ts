import { useEffect, useState } from "react";
import type { Placement } from "@floating-ui/dom";
import type { Editor } from "@scrivr/core";
import { createChangePopover } from "@scrivr/plugins";
import type { ChangePopoverInfo } from "@scrivr/plugins";
import { useFloatingPosition } from "./useFloatingPosition";

const TRACK_POPOVER_FALLBACK_PLACEMENTS: Placement[] = ["top-start"];

export function useTrackChangesPopover(editor: Editor | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [info, setInfo] = useState<ChangePopoverInfo | null>(null);
  const { ref, position } = useFloatingPosition<HTMLDivElement>(rect, [info], {
    fallbackPlacements: TRACK_POPOVER_FALLBACK_PLACEMENTS,
  });

  useEffect(() => {
    if (!editor) return;
    return createChangePopover(editor, {
      onShow: (r, i) => {
        setRect(r);
        setInfo(i);
      },
      onMove: (r, i) => {
        setRect(r);
        setInfo(i);
      },
      onHide: () => {
        setRect(null);
        setInfo(null);
      },
    });
  }, [editor]);

  function dismiss() {
    setRect(null);
    setInfo(null);
  }

  return {
    visible: !!rect && !!info,
    rect,
    info,
    position,
    rootRef: ref,
    dismiss,
  };
}
