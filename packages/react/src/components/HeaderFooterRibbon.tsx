/**
 * HeaderFooterRibbon — Google Docs-style ribbon bar that appears on EVERY
 * page between the header/footer band and body content when editing is active.
 *
 * Renders one ribbon per page, positioned absolutely inside the Scrivr container.
 * Shows: "Header"/"Footer" label, "Different first page" checkbox, "Options" menu.
 *
 * @example
 *   <div style={{ position: "relative" }}>
 *     <Scrivr editor={editor} />
 *     <HeaderFooterRibbon editor={editor} />
 *   </div>
 */

import type { Editor } from "@scrivr/core";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  type HeaderFooterController,
  type HeaderFooterState,
} from "@scrivr/plugins";
import { cx } from "../utils/classNames";
import { useHeaderFooterRibbon } from "../hooks/useHeaderFooterRibbon";

export interface HeaderFooterRibbonProps {
  editor: Editor | null;
  /**
   * Gap between pages in px. Must match the gap prop passed to the sibling
   * Scrivr component — if they diverge, the ribbon will be mispositioned.
   * Default: 24 (matches Scrivr's default).
   */
  gap?: number;
  className?: string | undefined;
  itemClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
}

export function HeaderFooterRibbon({
  editor,
  gap = 24,
  className,
  itemClassName,
  titleClassName,
  descriptionClassName,
}: HeaderFooterRibbonProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [overlayRect, setOverlayRect] = useState<DOMRect | null>(null);
  const measureOverlay = useCallback(() => {
    setOverlayRect(overlayRef.current?.getBoundingClientRect() ?? null);
  }, []);
  const ribbon = useHeaderFooterRibbon(editor, gap, overlayRect);

  useLayoutEffect(() => {
    measureOverlay();
    const node = overlayRef.current;
    const ro = typeof ResizeObserver !== "undefined" && node
      ? new ResizeObserver(measureOverlay)
      : null;
    ro?.observe(node!);
    window.addEventListener("resize", measureOverlay);
    window.addEventListener("scroll", measureOverlay, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measureOverlay);
      window.removeEventListener("scroll", measureOverlay, true);
    };
  }, [measureOverlay, ribbon.visible]);

  if (!editor || !ribbon.visible || !ribbon.state) return null;
  const state = ribbon.state;

  return (
    <div
      ref={overlayRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
      }}
    >
      {ribbon.ribbons.map((item) => {
        return (
          <div
            key={item.pageNum}
            className={cx("scrivr-header-footer-ribbon", className)}
            style={{
              position: "absolute",
              top: item.top,
              left: item.left,
              width: item.width,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              // Sized from `HeaderFooter.options.activeEditingGap` via
              // the hook — matches the gap the extension reserved at
              // layout time. Change the extension config and the
              // ribbon's height + the body's gap both follow.
              height: ribbon.ribbonHeight,
              userSelect: "none",
              zIndex: "var(--scrivr-react-ribbon-z, 10)",
              boxSizing: "border-box",
              pointerEvents: "auto",
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <span className={cx("scrivr-menu-title", titleClassName)} data-part="title">
              {item.label}
            </span>

            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <label
                className={cx("scrivr-menu-description", descriptionClassName)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={ribbon.differentFirstPage}
                  onChange={ribbon.toggleFirstPage}
                  style={{ margin: 0, cursor: "pointer" }}
                />
                Different first page
              </label>

              {/* Ref only attaches to the page with the open dropdown —
                  click-outside detection via optionsRef.contains() needs
                  exactly one DOM node, not one per page. */}
              <div ref={ribbon.optionsOpen === item.pageNum ? ribbon.optionsRef : undefined} style={{ position: "relative" }}>
                <button
                  className={cx("scrivr-menu-item", itemClassName)}
                  onClick={() =>
                    ribbon.setOptionsOpen(
                      ribbon.optionsOpen === item.pageNum ? null : item.pageNum,
                    )
                  }
                  style={{
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Options ▾
                </button>

                {ribbon.optionsOpen === item.pageNum && (
                  <OptionsDropdown
                    isHeader={ribbon.isHeader}
                    controller={ribbon.controller}
                    policy={state.policy}
                    editor={editor}
                    onClose={() => ribbon.setOptionsOpen(null)}
                    onRemoveHeader={ribbon.removeHeader}
                    onRemoveFooter={ribbon.removeFooter}
                    itemClassName={itemClassName}
                    titleClassName={titleClassName}
                    descriptionClassName={descriptionClassName}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface OptionsDropdownProps {
  isHeader: boolean;
  controller: HeaderFooterController | null;
  policy: HeaderFooterState["policy"];
  editor: Editor;
  onClose: () => void;
  onRemoveHeader: () => void;
  onRemoveFooter: () => void;
  itemClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
}

function OptionsDropdown({
  isHeader,
  controller,
  policy,
  editor,
  onClose,
  onRemoveHeader,
  onRemoveFooter,
  itemClassName,
  titleClassName,
  descriptionClassName,
}: OptionsDropdownProps) {
  const slot = isHeader ? policy?.defaultHeader : policy?.defaultFooter;
  const marginTop = slot?.marginTop;
  const marginBottom = slot?.marginBottom;
  const margin = slot?.margin ?? 12;

  const handleMarginChange = (field: "marginTop" | "marginBottom" | "margin", value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) return;

    if (field === "marginTop") controller?.setHeaderMarginTop(num);
    else if (field === "marginBottom") controller?.setFooterMarginBottom(num);
    else if (isHeader) controller?.setHeaderMargin(num);
    else controller?.setFooterMargin(num);
  };

  return (
    <div
      className="scrivr-header-footer-dropdown"
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: 4,
        minWidth: 200,
        zIndex: "var(--scrivr-react-dropdown-z, 50)",
      }}
    >
      <div className={cx("scrivr-menu-title", titleClassName)} data-part="title">
        {isHeader ? "Header" : "Footer"} options
      </div>

      {isHeader && (
        <MarginInput
          label="Margin from top"
          value={marginTop}
          placeholder="default"
          onChange={(v) => handleMarginChange("marginTop", v)}
          descriptionClassName={descriptionClassName}
        />
      )}

      {!isHeader && (
        <MarginInput
          label="Margin from bottom"
          value={marginBottom}
          placeholder="default"
          onChange={(v) => handleMarginChange("marginBottom", v)}
          descriptionClassName={descriptionClassName}
        />
      )}

      <MarginInput
        label="Space to body"
        value={margin}
        placeholder="12"
        onChange={(v) => handleMarginChange("margin", v)}
        descriptionClassName={descriptionClassName}
      />

      <div className="scrivr-header-footer-section">
        <div className={cx("scrivr-menu-title", titleClassName)} data-part="title">Insert</div>
        <InsertButton label="Page number" className={itemClassName} onClick={() => { editor.commands.insertPageNumber(); onClose(); }} />
        <InsertButton label="Total pages" className={itemClassName} onClick={() => { editor.commands.insertTotalPages(); onClose(); }} />
        <InsertButton label="Date" className={itemClassName} onClick={() => { editor.commands.insertDate(); onClose(); }} />
      </div>

      <div className="scrivr-header-footer-section">
        <button
          className={cx("scrivr-menu-item", itemClassName)}
          onClick={isHeader ? onRemoveHeader : onRemoveFooter}
          style={{
            border: "none",
            cursor: "pointer",
            width: "100%",
            textAlign: "left",
          }}
        >
          Remove {isHeader ? "header" : "footer"}
        </button>
      </div>
    </div>
  );
}

function InsertButton({
  label,
  className,
  onClick,
}: {
  label: string;
  className?: string | undefined;
  onClick: () => void;
}) {
  return (
    <button
      className={cx("scrivr-menu-item", className)}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        border: "none",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

interface MarginInputProps {
  label: string;
  value: number | undefined;
  placeholder: string;
  onChange: (value: string) => void;
  descriptionClassName?: string | undefined;
}

function MarginInput({
  label,
  value,
  placeholder,
  onChange,
  descriptionClassName,
}: MarginInputProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
      <span className={cx("scrivr-menu-description", descriptionClassName)} data-part="description">
        {label}
      </span>
      <input
        type="number"
        min={0}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 60,
          textAlign: "right",
        }}
      />
    </div>
  );
}
