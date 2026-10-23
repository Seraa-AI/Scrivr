/**
 * ImageMenu — React wrapper around createImageMenu.
 *
 * Peeks on hover — alt text, size and layout, read-only. Select the image and
 * the same card expands to controls for layout, alignment and dimensions.
 * Override either with `renderPeek` / `renderFull`.
 * No configuration required — just mount it alongside your editor.
 *
 * @example
 *   <ImageMenu editor={editor} />
 */
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Editor, HoverOption } from "@scrivr/core";
import { cx } from "../utils/classNames";
import { useImageMenu } from "../hooks/useImageMenu";

export interface ImageMenuProps {
  editor: Editor | null;
  className?: string | undefined;
  itemClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
  /** Hover peeks. Default true; false shows the menu from the selection only. */
  hover?: HoverOption | undefined;
  /** Replace the peek's content. */
  renderPeek?: ((menu: ImageMenuState) => ReactNode) | undefined;
  /** Replace the full menu's content. */
  renderFull?: ((menu: ImageMenuState) => ReactNode) | undefined;
}

export type ImageMenuState = ReturnType<typeof useImageMenu>;

export function ImageMenu({
  editor,
  className,
  itemClassName,
  titleClassName,
  descriptionClassName,
  hover,
  renderPeek,
  renderFull,
}: ImageMenuProps) {
  const menu = useImageMenu(editor, hover !== undefined ? { hover } : {});

  if (!menu.visible || !menu.info) return null;

  const peek = menu.presentation === "peek";
  const custom = peek ? renderPeek : renderFull;

  return createPortal(
    <div
      ref={menu.rootRef}
      data-scrivr-popover="image-menu"
      data-presentation={menu.presentation ?? undefined}
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
      {custom ? (
        custom(menu)
      ) : peek ? (
        <ImagePeek menu={menu} titleClassName={titleClassName} descriptionClassName={descriptionClassName} />
      ) : (
      <>
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
      </>
      )}
    </div>,
    document.body,
  );
}

function ImagePeek({
  menu,
  titleClassName,
  descriptionClassName,
}: {
  menu: ImageMenuState;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
}) {
  const attrs = menu.info?.node.attrs ?? {};
  const alt = typeof attrs["alt"] === "string" && attrs["alt"] ? attrs["alt"] : null;
  const width = typeof attrs["width"] === "number" ? Math.round(attrs["width"]) : null;
  const height = typeof attrs["height"] === "number" ? Math.round(attrs["height"]) : null;
  const layout = menu.wrapOptions.find((o) => o.value === menu.wrappingMode)?.label ?? menu.wrappingMode;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 280 }}>
      <span
        className={cx("scrivr-menu-title", titleClassName)}
        data-part="title"
        style={{ overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {alt ?? "Image"}
      </span>
      <span className={cx("scrivr-menu-description", descriptionClassName)} data-part="description">
        {width !== null && height !== null ? `${width} × ${height} px · ` : ""}
        {layout}
      </span>
    </div>
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
