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
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import { createImageMenu } from "@inscribe/core";
import type { ImageMenuInfo } from "@inscribe/core";
import type { Editor } from "@inscribe/core";

interface ImageMenuProps {
  editor: Editor | null;
}

type VerticalAlign = "baseline" | "middle" | "top" | "bottom" | "text-top" | "text-bottom";
type WrappingMode = "inline" | "square-left" | "square-right" | "top-bottom" | "behind" | "front";

const ALIGN_OPTIONS: { value: VerticalAlign; label: string; title: string }[] = [
  { value: "baseline",    label: "Baseline",   title: "Align image bottom to text baseline" },
  { value: "middle",      label: "Middle",     title: "Center image on font x-height (matches Word / Docs)" },
  { value: "top",         label: "Top",        title: "Align image top to line top" },
  { value: "bottom",      label: "Bottom",     title: "Align image bottom to line bottom" },
  { value: "text-top",    label: "Text Top",   title: "Align image top to parent font ascent" },
  { value: "text-bottom", label: "Text Bot",   title: "Align image bottom to parent font descent" },
];

const WRAP_OPTIONS: { value: WrappingMode; label: string; title: string }[] = [
  { value: "inline",       label: "In line",  title: "Image sits inline with text" },
  { value: "square-left",  label: "← Wrap",   title: "Text wraps to the right of the image" },
  { value: "square-right", label: "Wrap →",   title: "Text wraps to the left of the image" },
  { value: "top-bottom",   label: "↕ Break",  title: "Image breaks the text flow (top/bottom)" },
  { value: "behind",       label: "Behind",   title: "Image floats behind text" },
  { value: "front",        label: "Front",    title: "Image floats in front of text" },
];

export function ImageMenu({ editor }: ImageMenuProps) {
  const [rect, setRect]         = useState<DOMRect | null>(null);
  const [info, setInfo]         = useState<ImageMenuInfo | null>(null);
  const [pos,  setPos]          = useState<{ x: number; y: number } | null>(null);
  const [width,  setWidth]      = useState("");
  const [height, setHeight]     = useState("");
  const [wrappingMode, setWrappingMode] = useState<WrappingMode>("inline");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;
    return createImageMenu(editor, {
      onShow: (r, i) => {
        setRect(r);
        setInfo(i);
        setWidth(String(Math.round(i.node.attrs["width"] as number)));
        setHeight(String(Math.round(i.node.attrs["height"] as number)));
        setWrappingMode((i.node.attrs["wrappingMode"] as WrappingMode) ?? "inline");
      },
      onMove: (r, i) => {
        setRect(r);
        setInfo(i);
        setWrappingMode((i.node.attrs["wrappingMode"] as WrappingMode) ?? "inline");
      },
      onHide: () => { setRect(null); setInfo(null); setPos(null); },
    });
  }, [editor]);

  // Reposition the popover whenever rect or menu size changes
  useEffect(() => {
    if (!rect || !menuRef.current) return;
    const virtualEl = {
      getBoundingClientRect: () => rect,
      getClientRects: () => [rect] as unknown as DOMRectList,
    };
    computePosition(virtualEl, menuRef.current, {
      placement: "bottom-start",
      middleware: [offset(8), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => setPos({ x, y }));
  }, [rect]);

  if (!rect || !info) return null;

  const currentAlign = (info.node.attrs["verticalAlign"] as VerticalAlign) ?? "baseline";
  const isFloat = wrappingMode !== "inline";

  function applyAttr(attrs: Record<string, unknown>) {
    if (!editor || !info) return;
    editor.setNodeAttrs(info.docPos, attrs);
  }

  function handleWidthBlur() {
    const w = parseInt(width, 10);
    const h = parseInt(height, 10);
    if (w > 0 && h > 0) applyAttr({ width: w, height: h });
  }

  function handleAlignChange(align: VerticalAlign) {
    applyAttr({ verticalAlign: align });
  }

  function handleWrapChange(mode: WrappingMode) {
    setWrappingMode(mode);
    applyAttr({ wrappingMode: mode });
  }

  return createPortal(
    <div
      ref={menuRef}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position:     "fixed",
        left:         pos?.x ?? 0,
        top:          pos?.y ?? 0,
        zIndex:       60,
        visibility:   pos ? "visible" : "hidden",
        background:   "#fff",
        border:       "1px solid #e2e8f0",
        borderRadius: 10,
        boxShadow:    "0 4px 20px rgba(0,0,0,0.13)",
        padding:      "8px 10px",
        display:      "flex",
        flexDirection: "column",
        alignItems:   "stretch",
        gap:          6,
        fontSize:     13,
        whiteSpace:   "nowrap",
        userSelect:   "none",
      }}
    >
      {/* Layout / wrapping mode */}
      <div style={styles.group}>
        <span style={styles.label}>Layout</span>
        <div style={styles.segmented}>
          {WRAP_OPTIONS.map(({ value, label, title }) => (
            <button
              key={value}
              title={title}
              onMouseDown={(e) => { e.preventDefault(); handleWrapChange(value); }}
              style={{
                ...styles.segBtn,
                ...(wrappingMode === value ? styles.segBtnActive : {}),
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Vertical alignment — only shown when image is inline */}
      {!isFloat && (
        <>
          <div style={styles.divider} />
          <div style={styles.group}>
            <span style={styles.label}>Align</span>
            <div style={styles.segmented}>
              {ALIGN_OPTIONS.map(({ value, label, title }) => (
                <button
                  key={value}
                  title={title}
                  onMouseDown={(e) => { e.preventDefault(); handleAlignChange(value); }}
                  style={{
                    ...styles.segBtn,
                    ...(currentAlign === value ? styles.segBtnActive : {}),
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
        <span style={styles.label}>W</span>
        <input
          value={width}
          onChange={(e) => setWidth(e.target.value)}
          onBlur={handleWidthBlur}
          onKeyDown={(e) => { if (e.key === "Enter") handleWidthBlur(); }}
          style={styles.dimInput}
        />
        <span style={{ color: "#94a3b8" }}>×</span>
        <span style={styles.label}>H</span>
        <input
          value={height}
          onChange={(e) => setHeight(e.target.value)}
          onBlur={handleWidthBlur}
          onKeyDown={(e) => { if (e.key === "Enter") handleWidthBlur(); }}
          style={styles.dimInput}
        />
        <span style={{ color: "#94a3b8", fontSize: 11 }}>px</span>
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
    fontSize: 11,
    color: "#64748b",
    fontWeight: 500,
  },
  segmented: {
    display: "flex",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    overflow: "hidden",
  },
  segBtn: {
    background: "transparent",
    border: "none",
    borderRight: "1px solid #e2e8f0",
    padding: "3px 8px",
    cursor: "pointer",
    fontSize: 12,
    color: "#374151",
    lineHeight: 1.4,
  },
  segBtnActive: {
    background: "#1a73e8",
    color: "#fff",
  },
  divider: {
    width: "100%",
    height: 1,
    background: "#e2e8f0",
  },
  dimInput: {
    width: 44,
    border: "1px solid #e2e8f0",
    borderRadius: 4,
    padding: "2px 5px",
    fontSize: 12,
    textAlign: "center" as const,
    outline: "none",
    color: "#1e293b",
  },
} as const;
