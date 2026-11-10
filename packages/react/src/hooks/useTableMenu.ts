import { useEffect, useState } from "react";
import { createTableMenu } from "@scrivr/core";
import type { Editor, HoverOption, ResolvedNodeAction, TableMenuInfo } from "@scrivr/core";
import { useFloatingPosition } from "./useFloatingPosition";

export interface UseTableMenuOptions {
  /** Hover peeks. Default false; true or delays peek a hovered table. */
  hover?: HoverOption;
}

export function useTableMenu(editor: Editor | null, options: UseTableMenuOptions = {}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [info, setInfo] = useState<TableMenuInfo | null>(null);
  const [actions, setActions] = useState<readonly ResolvedNodeAction[]>([]);
  // Above the table's top edge; below it when there is no room above.
  const { ref, position } = useFloatingPosition<HTMLDivElement>(rect, [info?.presentation], {
    placement: "top-start",
    fallbackPlacements: ["bottom-start"],
    offset: 6,
  });

  useEffect(() => {
    if (!editor) return;
    const show = (r: DOMRect, i: TableMenuInfo) => {
      setRect(r);
      setInfo(i);
      // The Table extension owns what a cell selection offers.
      setActions(i.presentation === "full" ? editor.getNodeActions() : []);
    };
    return createTableMenu(editor, {
      onShow: show,
      onMove: show,
      onHide: () => {
        setRect(null);
        setInfo(null);
        setActions([]);
      },
      getPopoverElement: () => ref.current,
      hover: options.hover,
    });
    // `hover` is read once, at mount: an inline `{ showDelay }` is a new object
    // every render, and resubscribing would restart a peek's wait each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  function run(id: string) {
    editor?.runNodeAction(id).catch((err: unknown) => {
      // The action was listed for this selection a moment ago; one that no
      // longer applies, or fails, leaves the document as it was.
      console.error(err);
    });
  }

  return {
    visible: !!rect && !!info,
    rect,
    info,
    /** "peek" from hover or a read-only selection, "full" when editable cells are selected. */
    presentation: info?.presentation ?? null,
    position,
    rootRef: ref,
    /** The selection's node actions — empty unless the presentation is "full". */
    actions,
    run,
  };
}
