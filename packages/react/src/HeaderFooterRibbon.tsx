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

import { useEffect, useState, useCallback, useRef } from "react";
import type { Editor } from "@scrivr/core";
import { useScrivrState as useEditorState } from "./useScrivrState";
import {
  createHeaderFooterController,
  type HeaderFooterController,
  type HeaderFooterState,
} from "@scrivr/plugins";

export interface HeaderFooterRibbonProps {
  editor: Editor | null;
  /**
   * Gap between pages in px. Must match the gap prop passed to the sibling
   * Scrivr component — if they diverge, the ribbon will be mispositioned.
   * Default: 24 (matches Scrivr's default).
   */
  gap?: number;
  className?: string;
}

export function HeaderFooterRibbon({ editor, gap = 24, className }: HeaderFooterRibbonProps) {
  const controllerRef = useRef<HeaderFooterController | null>(null);
  const [state, setState] = useState<HeaderFooterState | null>(null);
  const [optionsOpen, setOptionsOpen] = useState<number | null>(null); // page number or null
  const optionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;
    const controller = createHeaderFooterController(editor);
    controllerRef.current = controller;
    setState(controller.getState());
    const unsub = controller.subscribe(setState);
    return () => {
      unsub();
      controller.destroy();
      controllerRef.current = null;
    };
  }, [editor]);

  // Re-render when layout changes (header height grows, pages added/removed).
  useEditorState({
    editor,
    selector: (ctx) => ctx.editor.layout.version,
    equalityFn: Object.is,
  });

  useEffect(() => {
    if (optionsOpen === null) return;
    const handler = (e: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) {
        setOptionsOpen(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [optionsOpen]);

  const handleToggleFirstPage = useCallback(() => {
    controllerRef.current?.toggleFirstPage();
  }, []);

  const handleRemoveHeader = useCallback(() => {
    controllerRef.current?.removeHeader();
    setOptionsOpen(null);
  }, []);

  const handleRemoveFooter = useCallback(() => {
    controllerRef.current?.removeFooter();
    setOptionsOpen(null);
  }, []);

  if (!editor || !state?.isSurfaceActive || !state.activeBand) return null;

  const layout = editor.layout;
  const isHeader = state.activeBand === "header";
  const differentFirstPage = state.policy?.differentFirstPage ?? false;
  const pageConfig = layout.pageConfig;
  const pageCount = layout.pages.length;

  return (
    <>
      {Array.from({ length: pageCount }, (_, i) => {
        const pageNum = i + 1;
        const metrics = layout.metrics?.[i];
        if (!metrics) return null;

        const isFirstPage = pageNum === 1 && differentFirstPage;
        const label = isHeader
          ? (isFirstPage ? "First Page Header" : "Header")
          : (isFirstPage ? "First Page Footer" : "Footer");

        const bandHeight = isHeader ? metrics.headerHeight : metrics.footerHeight;
        if (bandHeight <= 0) return null;

        const pageOffsetY = i * (pageConfig.pageHeight + gap);
        // Header ribbon: sits in the margin gap just above body contentTop.
        // Footer ribbon: sits just above the footer band (at footerTop - ribbon height).
        const ribbonY = isHeader
          ? pageOffsetY + metrics.contentTop - 28
          : pageOffsetY + metrics.footerTop - 28;

        return (
          <div
            key={pageNum}
            className={className}
            style={{
              position: "absolute",
              top: ribbonY,
              left: 0,
              width: pageConfig.pageWidth,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              height: 28,
              borderTop: "1px solid #e2e8f0",
              borderBottom: "1px solid #e2e8f0",
              padding: "0 12px",
              fontSize: 12,
              fontFamily: "system-ui, -apple-system, sans-serif",
              color: "#374151",
              background: "rgba(255,255,255,0.95)",
              userSelect: "none",
              zIndex: 10,
              boxSizing: "border-box",
              pointerEvents: "auto",
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <span style={{ fontWeight: 500 }}>{label}</span>

            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={differentFirstPage}
                  onChange={handleToggleFirstPage}
                  style={{ margin: 0, cursor: "pointer" }}
                />
                Different first page
              </label>

              {/* Ref only attaches to the page with the open dropdown —
                  click-outside detection via optionsRef.contains() needs
                  exactly one DOM node, not one per page. */}
              <div ref={optionsOpen === pageNum ? optionsRef : undefined} style={{ position: "relative" }}>
                <button
                  onClick={() => setOptionsOpen(optionsOpen === pageNum ? null : pageNum)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#2563eb",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    padding: "2px 4px",
                    borderRadius: 4,
                  }}
                >
                  Options ▾
                </button>

                {optionsOpen === pageNum && (
                  <OptionsDropdown
                    isHeader={isHeader}
                    controller={controllerRef.current}
                    policy={state.policy}
                    editor={editor}
                    onClose={() => setOptionsOpen(null)}
                    onRemoveHeader={handleRemoveHeader}
                    onRemoveFooter={handleRemoveFooter}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
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
}

function OptionsDropdown({
  isHeader,
  controller,
  policy,
  editor,
  onClose,
  onRemoveHeader,
  onRemoveFooter,
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
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: 4,
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        padding: 12,
        minWidth: 200,
        zIndex: 50,
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8, color: "#111827" }}>
        {isHeader ? "Header" : "Footer"} options
      </div>

      {isHeader && (
        <MarginInput
          label="Margin from top"
          value={marginTop}
          placeholder="default"
          onChange={(v) => handleMarginChange("marginTop", v)}
        />
      )}

      {!isHeader && (
        <MarginInput
          label="Margin from bottom"
          value={marginBottom}
          placeholder="default"
          onChange={(v) => handleMarginChange("marginBottom", v)}
        />
      )}

      <MarginInput
        label="Space to body"
        value={margin}
        placeholder="12"
        onChange={(v) => handleMarginChange("margin", v)}
      />

      <div style={{ borderTop: "1px solid #f1f5f9", marginTop: 8, paddingTop: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: "#111827" }}>Insert</div>
        <InsertButton label="Page number" onClick={() => { editor.commands.insertPageNumber(); onClose(); }} />
        <InsertButton label="Total pages" onClick={() => { editor.commands.insertTotalPages(); onClose(); }} />
        <InsertButton label="Date" onClick={() => { editor.commands.insertDate(); onClose(); }} />
      </div>

      <div style={{ borderTop: "1px solid #f1f5f9", marginTop: 8, paddingTop: 8 }}>
        <button
          onClick={isHeader ? onRemoveHeader : onRemoveFooter}
          style={{
            background: "none",
            border: "none",
            color: "#dc2626",
            fontSize: 12,
            cursor: "pointer",
            padding: "4px 0",
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

function InsertButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "none",
        border: "none",
        fontSize: 12,
        color: "#374151",
        cursor: "pointer",
        padding: "4px 0",
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
}

function MarginInput({ label, value, placeholder, onChange }: MarginInputProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
      <span style={{ color: "#6b7280" }}>{label}</span>
      <input
        type="number"
        min={0}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 60,
          padding: "3px 6px",
          border: "1px solid #d1d5db",
          borderRadius: 4,
          fontSize: 12,
          textAlign: "right",
        }}
      />
    </div>
  );
}
