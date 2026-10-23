import { useEffect, useState } from "react";
import { createTableMenu } from "@scrivr/core";
import type { Editor, HoverOption, TableMenuInfo } from "@scrivr/core";
import { useFloatingPosition } from "./useFloatingPosition";

export interface UseTableMenuOptions {
  /** Hover peeks. Default true; false shows the menu from the selection only. */
  hover?: HoverOption;
}

/** The structure edits the full table menu offers, in display order. */
const TABLE_COMMANDS = [
  { id: "addRowBefore", label: "Row ↑", title: "Insert row above" },
  { id: "addRowAfter", label: "Row ↓", title: "Insert row below" },
  { id: "deleteRow", label: "− Row", title: "Delete row" },
  { id: "addColumnBefore", label: "Col ←", title: "Insert column left" },
  { id: "addColumnAfter", label: "Col →", title: "Insert column right" },
  { id: "deleteColumn", label: "− Col", title: "Delete column" },
  { id: "deleteTable", label: "Delete table", title: "Delete the whole table", danger: true },
] as const;

export type TableCommandId = (typeof TABLE_COMMANDS)[number]["id"];

export function useTableMenu(editor: Editor | null, options: UseTableMenuOptions = {}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [info, setInfo] = useState<TableMenuInfo | null>(null);
  // Above the table's top edge; below it when there is no room above.
  const { ref, position } = useFloatingPosition<HTMLDivElement>(rect, [info?.presentation], {
    placement: "top-start",
    fallbackPlacements: ["bottom-start"],
    offset: 6,
  });

  useEffect(() => {
    if (!editor) return;
    return createTableMenu(editor, {
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
      getPopoverElement: () => ref.current,
      ...(options.hover !== undefined ? { hover: options.hover } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  function run(id: TableCommandId) {
    if (!editor) return;
    editor.commands[id]();
  }

  return {
    visible: !!rect && !!info,
    rect,
    info,
    /** "peek" from hover (read-only), "full" when cells are selected. */
    presentation: info?.presentation ?? null,
    position,
    rootRef: ref,
    commands: TABLE_COMMANDS,
    run,
  };
}
