/**
 * LinkPopover — React wrapper around createLinkPopover.
 *
 * Peeks on hover: rest the pointer on a link and a compact, read-only card
 * shows where it goes. Put the cursor in the link and the same card expands
 * to Open / Edit / Remove. Override either with `renderPeek` / `renderFull`.
 * No configuration required — just mount it alongside your editor.
 *
 * @example
 *   <LinkPopover editor={editor} />
 */
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Editor, HoverOption } from "@scrivr/core";
import { useLinkPopover } from "../hooks/useLinkPopover";
import { cx } from "../utils/classNames";

export interface LinkPopoverProps {
  editor: Editor | null;
  className?: string | undefined;
  itemClassName?: string | undefined;
  iconClassName?: string | undefined;
  titleClassName?: string | undefined;
  /** Hover peeks. Default true; false shows the popover from the selection only. */
  hover?: HoverOption | undefined;
  /** Replace the peek's content. */
  renderPeek?: ((popover: LinkPopoverState) => ReactNode) | undefined;
  /** Replace the full popover's content. */
  renderFull?: ((popover: LinkPopoverState) => ReactNode) | undefined;
}

export type LinkPopoverState = ReturnType<typeof useLinkPopover>;

export function LinkPopover({
  editor,
  className,
  itemClassName,
  iconClassName,
  titleClassName,
  hover,
  renderPeek,
  renderFull,
}: LinkPopoverProps) {
  const popover = useLinkPopover(editor, hover !== undefined ? { hover } : {});

  if (!popover.visible || !popover.info) return null;

  const display = popover.info.href.replace(/^https?:\/\//, "").slice(0, 40);
  const peek = popover.presentation === "peek";
  const custom = peek ? renderPeek : renderFull;

  return createPortal(
    <div
      ref={popover.rootRef}
      data-scrivr-popover="link-popover"
      data-presentation={popover.presentation ?? undefined}
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
        minWidth: peek ? undefined : 200,
      }}
    >
      {custom ? (
        custom(popover)
      ) : peek ? (
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
            title={popover.info.href}
            style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 320 }}
          >
            {peekLabel(popover.info.href)}
          </a>
        </>
      ) : popover.editing ? (
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

/** Host + path, for a peek: "example.com/docs/intro". Falls back to the raw href. */
function peekLabel(href: string): string {
  try {
    const url = new URL(href);
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${url.host}${path}`;
  } catch {
    return href;
  }
}
