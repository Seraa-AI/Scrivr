import { useEffect, useMemo, useRef, useState } from "react";
import { createSlashMenu } from "@scrivr/core";
import type { Editor, SlashCommandSpec } from "@scrivr/core";
import { useFloatingPosition } from "./useFloatingPosition";

export interface SlashMenuItem {
  /** Short icon label shown in the menu (e.g. "H1", "•"). */
  label: string;
  /** Display name. */
  title: string;
  /** One-line description shown below the title. */
  description: string;
  /**
   * Stable identity, used as the React key. An extension's entry carries the
   * one it declared; a title cannot stand in, because two search hits can
   * legitimately share a label and the rows would then reconcile onto each
   * other — the highlight on one and Enter running another.
   */
  id?: string;
  /** Logical grouping. Renderers draw a divider between groups. */
  group?: string;
  /** Called when the item is selected. Delete-slash logic runs before this. */
  action: () => void;
}

export interface UseSlashMenuOptions {
  /**
   * Replace the entries entirely — the extensions' own are not offered, and
   * no resolver is asked.
   */
  items?: SlashMenuItem[] | undefined;
  /**
   * How long to wait after a keystroke before asking the resolvers, in ms.
   * A search is I/O: typing "indemnity" should not be ten requests.
   */
  resolveDebounceMs?: number | undefined;
}

/**
 * Short glyph for an entry, by the command it runs.
 *
 * A spec carries no icon: Scrivr contributes no renderer, so what an entry
 * looks like is the host's business — the same split the playground toolbar
 * makes, keying its Lucide icons off `item.command`. An entry whose command is
 * not listed here renders with no glyph rather than a wrong one.
 */
const GLYPHS: Partial<Record<SlashCommandSpec["command"], string>> = {
  setParagraph: "¶",
  setHeading1: "H1",
  setHeading2: "H2",
  setHeading3: "H3",
  toggleBulletList: "•",
  toggleOrderedList: "1.",
  toggleCodeBlock: "<>",
  insertHorizontalRule: "—",
};

/** Turn an extension's declared entry into something this menu can render. */
function toItem(editor: Editor, spec: SlashCommandSpec): SlashMenuItem {
  return {
    label: GLYPHS[spec.command] ?? "",
    title: spec.label,
    description: spec.description ?? "",
    id: spec.id,
    ...(spec.group !== undefined ? { group: spec.group } : {}),
    action: () => editor.runCommand(spec.command, spec.args),
  };
}

export function useSlashMenu(
  editor: Editor | null,
  options: UseSlashMenuOptions = {},
) {
  const itemsProp = options.items;
  const debounceMs = options.resolveDebounceMs ?? 150;
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
    // A host that supplied its own items owns the whole list, so no resolver
    // is asked — otherwise "override" would mean "append to".
    if (!editor || !visible || itemsProp) {
      setResolvedItems([]);
      return;
    }
    // Cleared up front, not on the answer: holding the previous query's
    // entries on screen leaves them selectable, and Enter would insert
    // something matching a query the reader has already typed past.
    setResolvedItems([]);

    const controller = new AbortController();
    const timer = setTimeout(() => {
      editor
        .resolveSlashCommands(query, controller.signal)
        .then((specs) => setResolvedItems(specs.map((spec) => toItem(editor, spec))))
        .catch(() => {
          // Abandoned, or every resolver failed. The listed entries stand on
          // their own — a search that cannot answer shows nothing.
        });
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [editor, visible, query, itemsProp, debounceMs]);

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
