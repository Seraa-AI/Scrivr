/**
 * LinkPopover — React wrapper around createLinkPopover.
 *
 * Automatically appears below any link mark the cursor touches.
 * Provides Open / Edit / Remove actions out of the box.
 * No configuration required — just mount it alongside your editor.
 *
 * @example
 *   <LinkPopover editor={editor} />
 */
import { createPortal } from "react-dom";
import type { Editor } from "@scrivr/core";
import { useLinkPopover } from "../hooks/useLinkPopover";
import { cx } from "../utils/classNames";

export interface LinkPopoverProps {
  editor: Editor | null;
  className?: string | undefined;
  itemClassName?: string | undefined;
  iconClassName?: string | undefined;
  titleClassName?: string | undefined;
}

export function LinkPopover({
  editor,
  className,
  itemClassName,
  iconClassName,
  titleClassName,
}: LinkPopoverProps) {
  const popover = useLinkPopover(editor);

  if (!popover.visible || !popover.info) return null;

  const display = popover.info.href.replace(/^https?:\/\//, "").slice(0, 40);

  return createPortal(
    <div
      ref={popover.rootRef}
      data-scrivr-popover="link-popover"
      className={cx("scrivr-menu scrivr-link-popover", className)}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        left: popover.position?.x ?? 0,
        top: popover.position?.y ?? 0,
        zIndex: "var(--scrivr-react-popover-z, 60)",
        visibility: popover.position ? "visible" : "hidden",
        display: "flex",
        alignItems: "center",
        gap: 8,
        whiteSpace: "nowrap",
        minWidth: 200,
      }}
    >
      {popover.editing ? (
        <>
          <input
            autoFocus
            value={popover.editValue}
            onChange={(e) => popover.setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") popover.save();
              if (e.key === "Escape") popover.cancelEdit();
            }}
            style={{
              flex: 1,
            }}
          />
          <button
            className={cx("scrivr-menu-item", itemClassName)}
            onClick={popover.save}
            style={btnStyle}
          >
            Save
          </button>
          <button
            className={cx("scrivr-menu-item", itemClassName)}
            onClick={popover.cancelEdit}
            style={btnStyle}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className={cx("scrivr-menu-icon", iconClassName)} data-part="icon">
            link
          </span>
          <a
            className={cx("scrivr-menu-title", titleClassName)}
            data-part="title"
            href={popover.info.href}
            target="_blank"
            rel="noreferrer"
            style={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {display}
          </a>
          <button
            className={cx("scrivr-menu-item", itemClassName)}
            onClick={popover.startEdit}
            style={btnStyle}
            title="Edit link"
          >
            Edit
          </button>
          <button
            className={cx("scrivr-menu-item", itemClassName)}
            onClick={popover.remove}
            style={btnStyle}
            title="Remove link"
          >
            Unlink
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}

const btnStyle = {
  border: "none",
  cursor: "pointer",
} as const;
