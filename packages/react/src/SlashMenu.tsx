/**
 * SlashMenu — React wrapper around createSlashMenu.
 *
 * Renders a block-type picker below the cursor when the user types "/" at
 * the start of a text block. Supports keyboard navigation (↑↓ Enter Escape)
 * and filters items as the user continues typing.
 *
 * @example
 *   <SlashMenu editor={editor} />
 *
 *   // Custom items:
 *   <SlashMenu editor={editor} items={[
 *     { label: "H1", title: "Heading 1", description: "Large title", command: "setHeading1" },
 *   ]} />
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import { createSlashMenu } from "@scrivr/core";
import type { Editor } from "@scrivr/core";

export interface SlashMenuItem {
  /** Short icon label shown in the menu (e.g. "H1", "•"). */
  label: string;
  /** Display name. */
  title: string;
  /** One-line description shown below the title. */
  description: string;
  /** Editor command name to call on select. */
  command: string;
  /** Optional args forwarded to the command. */
  args?: unknown[];
}

const DEFAULT_ITEMS: SlashMenuItem[] = [
  {
    label: "¶",
    title: "Text",
    description: "Plain paragraph",
    command: "setParagraph",
  },
  {
    label: "H1",
    title: "Heading 1",
    description: "Large section title",
    command: "setHeading1",
  },
  {
    label: "H2",
    title: "Heading 2",
    description: "Medium section title",
    command: "setHeading2",
  },
  {
    label: "H3",
    title: "Heading 3",
    description: "Small section title",
    command: "setHeading3",
  },
  {
    label: "•",
    title: "Bullet list",
    description: "Unordered list",
    command: "toggleBulletList",
  },
  {
    label: "1.",
    title: "Ordered list",
    description: "Numbered list",
    command: "toggleOrderedList",
  },
  {
    label: "<>",
    title: "Code block",
    description: "Monospace code block",
    command: "toggleCodeBlock",
  },
  {
    label: "—",
    title: "Divider",
    description: "Horizontal rule",
    command: "insertHorizontalRule",
  },
];

interface SlashMenuProps {
  editor: Editor | null;
  /** Override the default block items. */
  items?: SlashMenuItem[];
  className?: string;
}

export function SlashMenu({
  editor,
  items = DEFAULT_ITEMS,
  className,
}: SlashMenuProps) {
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [slashFrom, setSlashFrom] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ReturnType<typeof createSlashMenu> | null>(null);

  const filtered = query
    ? items.filter(
        (it) =>
          it.title.toLowerCase().includes(query.toLowerCase()) ||
          it.description.toLowerCase().includes(query.toLowerCase()),
      )
    : items;

  // Clamp activeIndex when filtered list shrinks
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Mount the controller
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
        setPos(null);
      },
    });
    controllerRef.current = ctrl;
    return () => ctrl.cleanup();
  }, [editor]);

  // Reposition via floating-ui whenever rect changes
  useEffect(() => {
    if (!rect || !menuRef.current) return;
    const virtualEl = {
      getBoundingClientRect: () => rect,
      getClientRects: () => [rect] as unknown as DOMRectList,
    };
    computePosition(virtualEl, menuRef.current, {
      placement: "bottom-start",
      middleware: [offset(6), flip(), shift({ padding: 8 })],
    })
      .then(({ x, y }) => setPos({ x, y }))
      .catch((err) =>
        console.error("[SlashMenu] computePosition failed:", err),
      );
  }, [rect, filtered.length]);

  // Keyboard navigation — capture phase intercepts before ProseMirror
  useEffect(() => {
    if (!visible) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        selectItem(filtered[activeIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        controllerRef.current?.dismissMenu();
      }
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    // filtered / activeIndex captured via closure — re-attach whenever they change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, activeIndex, filtered]);

  function selectItem(item: SlashMenuItem | undefined) {
    if (!item || !editor) return;
    // Delete "/<query>" text, then run the command
    const state = editor.getState();
    const cursor = state.selection.from;
    if (cursor > slashFrom) {
      editor._applyTransaction(state.tr.delete(slashFrom, cursor));
    }
    editor.commands[item.command]?.(...(item.args ?? []));
    controllerRef.current?.dismissMenu();
  }

  if (!visible) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={className}
      style={{
        position: "fixed",
        left: pos?.x ?? 0,
        top: pos?.y ?? 0,
        zIndex: 200,
        visibility: pos ? "visible" : "hidden",
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: "6px",
        minWidth: 220,
        boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
      }}
    >
      {filtered.length === 0 ? (
        <div style={{ padding: "8px 12px", color: "#94a3b8", fontSize: 13 }}>
          No matching blocks
        </div>
      ) : (
        filtered.map((item, i) => (
          <button
            key={item.command}
            onMouseDown={(e) => {
              e.preventDefault();
              selectItem(item);
            }}
            onMouseEnter={() => setActiveIndex(i)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              background: i === activeIndex ? "#f1f5f9" : "transparent",
              border: "none",
              borderRadius: 6,
              padding: "6px 8px",
              cursor: "pointer",
              textAlign: "left",
              transition: "background 0.08s",
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 5,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontFamily: "monospace",
                color: "#475569",
                flexShrink: 0,
              }}
            >
              {item.label}
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#1e293b",
                  lineHeight: 1.3,
                }}
              >
                {item.title}
              </span>
              <span style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.3 }}>
                {item.description}
              </span>
            </span>
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
