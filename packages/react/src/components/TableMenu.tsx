/**
 * TableMenu — React wrapper around createTableMenu.
 *
 * Peeks on hover: rest the pointer on a table and a compact card above it
 * shows its size. Select cells and the same card expands to row / column
 * edits. Override either with `renderPeek` / `renderFull`.
 *
 * @example
 *   <TableMenu editor={editor} />
 */
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Editor, HoverOption } from "@scrivr/core";
import { useTableMenu } from "../hooks/useTableMenu";
import { cx } from "../utils/classNames";

export interface TableMenuProps {
  editor: Editor | null;
  className?: string | undefined;
  itemClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
  /** Hover peeks. Default true; false shows the menu from the selection only. */
  hover?: HoverOption | undefined;
  /** Replace the peek's content. */
  renderPeek?: ((menu: TableMenuState) => ReactNode) | undefined;
  /** Replace the full menu's content. */
  renderFull?: ((menu: TableMenuState) => ReactNode) | undefined;
}

export type TableMenuState = ReturnType<typeof useTableMenu>;

export function TableMenu({
  editor,
  className,
  itemClassName,
  titleClassName,
  descriptionClassName,
  hover,
  renderPeek,
  renderFull,
}: TableMenuProps) {
  const menu = useTableMenu(editor, hover !== undefined ? { hover } : {});

  if (!menu.visible || !menu.info) return null;

  const { rows, columns, headerRow } = menu.info;
  const peek = menu.presentation === "peek";
  const custom = peek ? renderPeek : renderFull;
  const summary = (
    <>
      <span className={cx("scrivr-menu-title", titleClassName)} data-part="title">
        Table · {rows} × {columns}
      </span>
      {headerRow && (
        <span className={cx("scrivr-menu-description", descriptionClassName)} data-part="description">
          header row
        </span>
      )}
    </>
  );

  return createPortal(
    <div
      ref={menu.rootRef}
      data-scrivr-popover="table-menu"
      data-presentation={menu.presentation ?? undefined}
      className={cx("scrivr-menu scrivr-table-menu", className)}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        left: menu.position?.x ?? 0,
        top: menu.position?.y ?? 0,
        zIndex: "var(--scrivr-react-popover-z, 60)",
        visibility: menu.position ? "visible" : "hidden",
        display: "flex",
        alignItems: "center",
        gap: 8,
        whiteSpace: "nowrap",
        userSelect: "none",
      }}
    >
      {custom ? (
        custom(menu)
      ) : peek ? (
        summary
      ) : (
        <>
          {summary}
          <span style={{ width: 1, alignSelf: "stretch" }} data-part="divider" />
          {menu.commands.map((c) => (
            <button
              key={c.id}
              className={cx("scrivr-menu-item", itemClassName)}
              data-danger={"danger" in c ? "" : undefined}
              title={c.title}
              onMouseDown={(e) => {
                e.preventDefault();
                menu.run(c.id);
              }}
              style={{ border: "none", cursor: "pointer" }}
            >
              {c.label}
            </button>
          ))}
        </>
      )}
    </div>,
    document.body,
  );
}
