/**
 * ImageMenu — React wrapper around createImageMenu.
 *
 * Automatically appears below a selected image, showing controls for
 * vertical alignment, dimensions, and (future) text wrapping mode.
 * No configuration required — just mount it alongside your editor.
 *
 * @example
 *   <ImageMenu editor={editor} />
 */
import { createPortal } from "react-dom";
import type { Editor } from "@scrivr/core";
import { cx } from "../utils/classNames";
import { useImageMenu } from "../hooks/useImageMenu";

export interface ImageMenuProps {
  editor: Editor | null;
  className?: string | undefined;
  itemClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
}

export function ImageMenu({
  editor,
  className,
  itemClassName,
  titleClassName,
  descriptionClassName,
}: ImageMenuProps) {
  const menu = useImageMenu(editor);

  if (!menu.visible) return null;

  return createPortal(
    <div
      ref={menu.rootRef}
      className={cx("scrivr-menu scrivr-image-menu", className)}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        left: menu.position?.x ?? 0,
        top: menu.position?.y ?? 0,
        zIndex: "var(--scrivr-react-popover-z, 60)",
        visibility: menu.position ? "visible" : "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 6,
        whiteSpace: "nowrap",
        userSelect: "none",
      }}
    >
      {/* Layout / wrapping mode */}
      <div style={styles.group}>
        <span className={cx("scrivr-menu-title", titleClassName)} data-part="title" style={styles.label}>
          Layout
        </span>
        <div style={styles.segmented}>
          {menu.wrapOptions.map(({ value, label, title }) => (
            <button
              key={value}
              className={cx("scrivr-menu-item", itemClassName)}
              data-selected={menu.wrappingMode === value ? "" : undefined}
              title={title}
              onMouseDown={(e) => {
                e.preventDefault();
                menu.setWrapMode(value);
              }}
              style={{
                ...styles.segBtn,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Vertical alignment — only shown when image is inline */}
      {!menu.isFloat && (
        <>
          <div style={styles.divider} />
          <div style={styles.group}>
            <span className={cx("scrivr-menu-title", titleClassName)} data-part="title" style={styles.label}>
              Align
            </span>
            <div style={styles.segmented}>
              {menu.alignOptions.map(({ value, label, title }) => (
                <button
                  key={value}
                  className={cx("scrivr-menu-item", itemClassName)}
                  data-selected={menu.currentAlign === value ? "" : undefined}
                  title={title}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    menu.setAlign(value);
                  }}
                  style={{
                    ...styles.segBtn,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div style={styles.divider} />

      {/* Dimensions */}
      <div style={styles.group}>
        <span className={cx("scrivr-menu-title", titleClassName)} data-part="title" style={styles.label}>
          W
        </span>
        <input
          value={menu.width}
          onChange={(e) => menu.setWidth(e.target.value)}
          onBlur={menu.commitDimensions}
          onKeyDown={(e) => {
            if (e.key === "Enter") menu.commitDimensions();
          }}
          style={styles.dimInput}
        />
        <span className={cx("scrivr-menu-description", descriptionClassName)} data-part="description">
          x
        </span>
        <span className={cx("scrivr-menu-title", titleClassName)} data-part="title" style={styles.label}>
          H
        </span>
        <input
          value={menu.height}
          onChange={(e) => menu.setHeight(e.target.value)}
          onBlur={menu.commitDimensions}
          onKeyDown={(e) => {
            if (e.key === "Enter") menu.commitDimensions();
          }}
          style={styles.dimInput}
        />
        <span className={cx("scrivr-menu-description", descriptionClassName)} data-part="description">
          px
        </span>
      </div>
    </div>,
    document.body,
  );
}

const styles = {
  group: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  label: {
  },
  segmented: {
    display: "flex",
    overflow: "hidden",
  },
  segBtn: {
    border: "none",
    cursor: "pointer",
    lineHeight: 1.4,
  },
  divider: {
    width: "100%",
    height: 1,
  },
  dimInput: {
    width: 44,
    textAlign: "center" as const,
  },
} as const;
