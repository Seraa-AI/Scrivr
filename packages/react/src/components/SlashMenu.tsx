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
import { createPortal } from "react-dom";
import type { Editor } from "@scrivr/core";
import { cx } from "../utils/classNames";
import { useSlashMenu, type SlashMenuItem } from "../hooks/useSlashMenu";

export interface SlashMenuProps {
  editor: Editor | null;
  /** Override the default block items. If omitted, a typed default list is built from editor.commands. */
  items?: SlashMenuItem[];
  className?: string | undefined;
  itemClassName?: string | undefined;
  iconClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
  emptyClassName?: string | undefined;
}

export function SlashMenu({
  editor,
  items: itemsProp,
  className,
  itemClassName,
  iconClassName,
  titleClassName,
  descriptionClassName,
  emptyClassName,
}: SlashMenuProps) {
  const menu = useSlashMenu(editor, { items: itemsProp });

  if (!menu.visible) return null;

  return createPortal(
    <div
      ref={menu.rootRef}
      className={cx("scrivr-menu scrivr-slash-menu", className)}
      style={{
        position: "fixed",
        left: menu.position?.x ?? 0,
        top: menu.position?.y ?? 0,
        zIndex: "var(--scrivr-react-menu-z, 200)",
        visibility: menu.position ? "visible" : "hidden",
        minWidth: 220,
      }}
    >
      {menu.items.length === 0 ? (
        <div className={cx("scrivr-menu-empty", emptyClassName)} data-empty>
          No matching blocks
        </div>
      ) : (
        menu.items.map((item, i) => (
          <button
            key={item.title}
            className={cx("scrivr-menu-item", itemClassName)}
            data-active={i === menu.activeIndex ? "" : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              menu.selectItem(item);
            }}
            onMouseEnter={() => menu.setActiveIndex(i)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              className={cx("scrivr-menu-icon", iconClassName)}
              data-part="icon"
              style={{
                width: 28,
                height: 28,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {item.label}
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span
                className={cx("scrivr-menu-title", titleClassName)}
                data-part="title"
                style={{
                  lineHeight: 1.3,
                }}
              >
                {item.title}
              </span>
              <span
                className={cx("scrivr-menu-description", descriptionClassName)}
                data-part="description"
                style={{ lineHeight: 1.3 }}
              >
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
