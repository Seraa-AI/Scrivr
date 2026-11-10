import { useEffect, useState } from "react";
import { createLinkPopover } from "@scrivr/core";
import type { Editor, HoverOption, LinkPopoverInfo } from "@scrivr/core";
import { useFloatingPosition } from "./useFloatingPosition";

export interface UseLinkPopoverOptions {
  /** Hover peeks. Default true; false shows the popover from the selection only. */
  hover?: HoverOption;
}

export function useLinkPopover(editor: Editor | null, options: UseLinkPopoverOptions = {}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [info, setInfo] = useState<LinkPopoverInfo | null>(null);
  const { ref, position } = useFloatingPosition<HTMLDivElement>(
    rect,
    [editing, info?.presentation],
    { offset: 6 },
  );

  useEffect(() => {
    if (!editor) return;
    return createLinkPopover(editor, {
      onShow: (r, i) => {
        setRect(r);
        setInfo(i);
        setEditing(false);
      },
      onMove: (r, i) => {
        // The same link, moved or re-presented; a different one arrives as
        // onShow. Going back to a peek drops an edit in progress.
        if (i.presentation === "peek") setEditing(false);
        setRect(r);
        setInfo(i);
      },
      onHide: () => {
        setRect(null);
        setInfo(null);
        setEditing(false);
      },
      getPopoverElement: () => ref.current,
      hover: options.hover,
    });
    // `hover` is read once, at mount: an inline `{ showDelay }` is a new object
    // every render, and resubscribing would restart a peek's wait each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  function startEdit() {
    if (!info) return;
    setEditValue(info.href);
    setEditing(true);
  }

  function save() {
    if (editor && info && editValue.trim()) {
      editor.commands.setLinkHref(info.from, info.to, editValue.trim());
    }
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
  }

  function remove() {
    editor?.commands.unsetLink();
    setRect(null);
  }

  function dismiss() {
    setRect(null);
    setInfo(null);
    setEditing(false);
  }

  return {
    visible: !!rect && !!info,
    rect,
    info,
    /** "peek" from hover (read-only), "full" when the selection is in the link. */
    presentation: info?.presentation ?? null,
    position,
    rootRef: ref,
    editing,
    editValue,
    setEditValue,
    startEdit,
    save,
    cancelEdit,
    remove,
    dismiss,
  };
}
