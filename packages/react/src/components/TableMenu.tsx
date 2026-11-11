/**
 * TableMenu — React wrapper around createTableMenu.
 *
 * Select cells and a card above the table shows its size and the row /
 * column edits the Table extension contributes as node actions. With `hover`
 * on, resting the pointer on a table peeks the same card, read-only. Override
 * either with `renderPeek` / `renderFull`.
 *
 * @example
 *   <TableMenu editor={editor} />
 */
import { Fragment, type ReactNode } from "react";
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
  /** Hover peeks. Default false; true or delays peek a hovered table. */
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
          {menu.actions.map((action, i) => (
            <Fragment key={action.id}>
              {(i === 0 || menu.actions[i - 1]!.group !== action.group) && (
                <span style={{ width: 1, alignSelf: "stretch" }} data-part="divider" />
              )}
              <button
                className={cx("scrivr-menu-item", itemClassName)}
                data-danger={action.danger ? "" : undefined}
                title={action.disabledReason || action.title || action.label}
                disabled={action.disabledReason !== false}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (action.disabledReason === false) menu.run(action.id);
                }}
                style={{ border: "none", cursor: "pointer" }}
              >
                {action.label}
              </button>
            </Fragment>
          ))}
        </>
      )}
    </div>,
    document.body,
  );
}
