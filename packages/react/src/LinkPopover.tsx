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
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import { createLinkPopover } from "@scrivr/core";
import type { LinkPopoverInfo } from "@scrivr/core";
import type { Editor } from "@scrivr/core";

interface LinkPopoverProps {
  editor: Editor | null;
}

export function LinkPopover({ editor }: LinkPopoverProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [info, setInfo] = useState<LinkPopoverInfo | null>(null);
  const [pos,  setPos]  = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;
    return createLinkPopover(editor, {
      onShow: (r, i) => { setRect(r); setInfo(i); setEditing(false); },
      onMove: (r, i) => { setRect(r); setInfo(i); },
      onHide: ()     => { setRect(null); setInfo(null); setPos(null); setEditing(false); },
    });
  }, [editor]);

  useEffect(() => {
    if (!rect || !menuRef.current) return;
    const virtualEl = {
      getBoundingClientRect: () => rect,
      getClientRects:        () => [rect] as unknown as DOMRectList,
    };
    computePosition(virtualEl, menuRef.current, {
      placement: "bottom-start",
      middleware: [offset(6), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => setPos({ x, y }));
  }, [rect, editing]);

  if (!rect || !info) return null;

  const display = info.href.replace(/^https?:\/\//, "").slice(0, 40);

  function handleEdit() {
    setEditValue(info!.href);
    setEditing(true);
  }

  function handleSave() {
    if (editor && editValue.trim()) {
      editor.commands["setLinkHref"]?.(info!.from, info!.to, editValue.trim());
    }
    setEditing(false);
  }

  function handleRemove() {
    editor?.commands["unsetLink"]?.();
    setRect(null);
  }

  return createPortal(
    <div
      ref={menuRef}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position:    "fixed",
        left:        pos?.x ?? 0,
        top:         pos?.y ?? 0,
        zIndex:      60,
        visibility:  pos ? "visible" : "hidden",
        background:  "#fff",
        border:      "1px solid #e2e8f0",
        borderRadius: 8,
        boxShadow:   "0 4px 16px rgba(0,0,0,0.12)",
        padding:     "6px 10px",
        display:     "flex",
        alignItems:  "center",
        gap:         8,
        fontSize:    13,
        whiteSpace:  "nowrap",
        minWidth:    200,
      }}
    >
      {editing ? (
        <>
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
            style={{ flex: 1, border: "1px solid #cbd5e1", borderRadius: 4, padding: "2px 6px", fontSize: 13, outline: "none" }}
          />
          <button onClick={handleSave} style={btnStyle("#2563eb", "#fff")}>Save</button>
          <button onClick={() => setEditing(false)} style={btnStyle("#f1f5f9", "#374151")}>Cancel</button>
        </>
      ) : (
        <>
          <span style={{ color: "#2563eb" }}>🔗</span>
          <a
            href={info.href}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#2563eb", textDecoration: "none", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {display}
          </a>
          <button onClick={handleEdit}   style={btnStyle("#f1f5f9", "#374151")} title="Edit link">Edit</button>
          <button onClick={handleRemove} style={btnStyle("#f1f5f9", "#374151")} title="Remove link">Unlink</button>
        </>
      )}
    </div>,
    document.body,
  );
}

function btnStyle(bg: string, color: string) {
  return {
    background:   bg,
    color,
    border:       "none",
    borderRadius: 4,
    padding:      "3px 8px",
    cursor:       "pointer",
    fontSize:     12,
    fontWeight:   500,
  } as const;
}
