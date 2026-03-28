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

type VerticalAlign = "baseline" | "middle" | "top";

const ALIGN_OPTIONS: { value: VerticalAlign; label: string; title: string }[] = [
  { value: "baseline", label: "Baseline", title: "Align image bottom to text baseline" },
  { value: "middle",   label: "Middle",   title: "Center image in line height" },
  { value: "top",      label: "Top",      title: "Align image top to line top" },
];

export function ImageMenu({ editor }: ImageMenuProps) {
  const [rect, setRect]   = useState<DOMRect | null>(null);
  const [info, setInfo]   = useState<ImageMenuInfo | null>(null);
  const [pos,  setPos]    = useState<{ x: number; y: number } | null>(null);
  const [width,  setWidth]  = useState("");
  const [height, setHeight] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;
    return createImageMenu(editor, {
      onShow: (r, i) => {
        setRect(r);
        setInfo(i);
        setWidth(String(Math.round(i.node.attrs["width"] as number)));
        setHeight(String(Math.round(i.node.attrs["height"] as number)));
      },
      onMove: (r, i) => {
        setRect(r);
        setInfo(i);
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
        alignItems:   "center",
        gap:          8,
        fontSize:     13,
        whiteSpace:   "nowrap",
        userSelect:   "none",
      }}
    >
      {/* Vertical alignment */}
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
    width: 1,
    height: 22,
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
