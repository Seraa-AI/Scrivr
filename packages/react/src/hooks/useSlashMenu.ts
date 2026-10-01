import { useEffect, useMemo, useRef, useState } from "react";
import { createSlashMenu } from "@scrivr/core";
import type { Editor, SlashCommandSpec } from "@scrivr/core";
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

/** Turn an extension's declared entry into something this menu can render. */
function toItem(editor: Editor, spec: SlashCommandSpec): SlashMenuItem {
  return {
    label: spec.label,
    title: spec.title,
    description: spec.description,
    action: () => editor.runCommand(spec.command, spec.args),
  };
}

export function useSlashMenu(
  editor: Editor | null,
  options: UseSlashMenuOptions = {},
) {
  const itemsProp = options.items;
  const defaultItems = useMemo((): SlashMenuItem[] => {
    // Declared by whoever owns the node each entry inserts, so an application
    // extension's entries appear here without this hook knowing about it.
    if (!editor) return [];
    return editor.getSlashCommands().map((spec) => toItem(editor, spec));
  }, [editor]);

  const items = itemsProp ?? defaultItems;
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [slashFrom, setSlashFrom] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const controllerRef = useRef<ReturnType<typeof createSlashMenu> | null>(null);
  const [resolvedItems, setResolvedItems] = useState<SlashMenuItem[]>([]);
  const listedItems = query
    ? items.filter(
        (it) =>
          it.title.toLowerCase().includes(query.toLowerCase()) ||
          it.description.toLowerCase().includes(query.toLowerCase()),
      )
    : items;
  const filteredItems = useMemo(
    () => [...listedItems, ...resolvedItems],
    [listedItems, resolvedItems],
  );
  const { ref, position } = useFloatingPosition<HTMLDivElement>(
    rect,
    [filteredItems.length],
    { offset: 6 },
  );

  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, filteredItems.length - 1)));
  }, [filteredItems.length]);

  useEffect(() => {
    if (!editor || !visible) {
      setResolvedItems([]);
      return;
    }
    // Aborting on every keystroke is the whole contract: the editor throws
    // rather than resolving once the signal fires, so an answer that arrives
    // for a query the reader has typed past can never reach the menu.
    const controller = new AbortController();
    editor
      .resolveSlashCommands(query, controller.signal)
      .then((specs) => setResolvedItems(specs.map((spec) => toItem(editor, spec))))
      .catch(() => {
        // Abandoned, or a resolver failed. Either way the listed entries
        // stand on their own — a search that cannot answer shows nothing
        // rather than emptying the menu.
        if (!controller.signal.aborted) setResolvedItems([]);
      });
    return () => controller.abort();
  }, [editor, visible, query]);

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
      getPopoverElement: () => ref.current,
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
