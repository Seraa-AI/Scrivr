import { useEffect, useMemo, useRef, useState } from "react";
import { createSlashMenu } from "@scrivr/core";
import type { Editor } from "@scrivr/core";
import { useFloatingPosition } from "./useFloatingPosition";

export interface SlashMenuItem {
  /** Short icon label shown in the menu (e.g. "H1", "•"). */
  label: string;
  /** Display name (also used as the React key — must be unique in the list). */
  title: string;
  /** One-line description shown below the title. */
  description: string;
  /** Called when the item is selected. Delete-slash logic runs before this. */
  action: () => void;
}

export interface UseSlashMenuOptions {
  items?: SlashMenuItem[] | undefined;
}

export function useSlashMenu(
  editor: Editor | null,
  options: UseSlashMenuOptions = {},
) {
  const itemsProp = options.items;
  const defaultItems = useMemo((): SlashMenuItem[] => {
    if (!editor) return [];
    const c = editor.commands;
    return [
      {
        label: "¶",
        title: "Text",
        description: "Plain paragraph",
        action: () => c.setParagraph(),
      },
      {
        label: "H1",
        title: "Heading 1",
        description: "Large section title",
        action: () => c.setHeading1(),
      },
      {
        label: "H2",
        title: "Heading 2",
        description: "Medium section title",
        action: () => c.setHeading2(),
      },
      {
        label: "H3",
        title: "Heading 3",
        description: "Small section title",
        action: () => c.setHeading3(),
      },
      {
        label: "•",
        title: "Bullet list",
        description: "Unordered list",
        action: () => c.toggleBulletList(),
      },
      {
        label: "1.",
        title: "Ordered list",
        description: "Numbered list",
        action: () => c.toggleOrderedList(),
      },
      {
        label: "<>",
        title: "Code block",
        description: "Monospace code block",
        action: () => c.toggleCodeBlock(),
      },
      {
        label: "—",
        title: "Divider",
        description: "Horizontal rule",
        action: () => c.insertHorizontalRule(),
      },
    ];
  }, [editor]);

  const items = itemsProp ?? defaultItems;
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [slashFrom, setSlashFrom] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const controllerRef = useRef<ReturnType<typeof createSlashMenu> | null>(null);
  const filteredItems = query
    ? items.filter(
        (it) =>
          it.title.toLowerCase().includes(query.toLowerCase()) ||
          it.description.toLowerCase().includes(query.toLowerCase()),
      )
    : items;
  const { ref, position } = useFloatingPosition<HTMLDivElement>(
    rect,
    [filteredItems.length],
    { offset: 6 },
  );

  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, filteredItems.length - 1)));
  }, [filteredItems.length]);

  useEffect(() => {
    if (!editor) return;
    const ctrl = createSlashMenu(editor, {
      onShow: (r, q, from) => {
        setRect(r);
        setQuery(q);
        setSlashFrom(from);
        setActiveIndex(0);
        setVisible(true);
      },
      onUpdate: (r, q, from) => {
        setRect(r);
        setQuery(q);
        setSlashFrom(from);
      },
      onHide: () => {
        setVisible(false);
        setRect(null);
      },
    });
    controllerRef.current = ctrl;
    return () => ctrl.cleanup();
  }, [editor]);

  function dismiss() {
    controllerRef.current?.dismissMenu();
  }

  function selectItem(item: SlashMenuItem | undefined) {
    if (!item || !editor) return;
    const state = editor.getState();
    const cursor = state.selection.from;
    if (cursor > slashFrom) {
      editor.applyTransaction(state.tr.delete(slashFrom, cursor));
    }
    item.action();
    dismiss();
  }

  useEffect(() => {
    if (!visible) return;

    function onKeyDown(e: KeyboardEvent) {
      if (filteredItems.length === 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          dismiss();
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((i) => (i + 1) % filteredItems.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex(
          (i) => (i - 1 + filteredItems.length) % filteredItems.length,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        selectItem(filteredItems[activeIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      }
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, activeIndex, filteredItems]);

  return {
    visible,
    rect,
    position,
    query,
    items: filteredItems,
    activeIndex,
    setActiveIndex,
    rootRef: ref,
    selectItem,
    dismiss,
  };
}
