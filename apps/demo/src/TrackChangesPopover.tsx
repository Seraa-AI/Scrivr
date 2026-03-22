import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import type { Editor } from "@inscribe/core";
import { createChangePopover, CHANGE_OPERATION, CHANGE_STATUS } from "@inscribe/plugins";
import type { ChangePopoverInfo } from "@inscribe/plugins";

interface TrackChangesPopoverProps {
  editor: Editor | null;
}

const OPERATION_LABEL: Partial<Record<CHANGE_OPERATION, string>> = {
  [CHANGE_OPERATION.insert]:              "Insertion",
  [CHANGE_OPERATION.delete]:              "Deletion",
  [CHANGE_OPERATION.move]:                "Move",
  [CHANGE_OPERATION.wrap_with_node]:      "Wrap",
  [CHANGE_OPERATION.set_node_attributes]: "Attribute change",
};

export function TrackChangesPopover({ editor }: TrackChangesPopoverProps) {
  const [rect, setRect]   = useState<DOMRect | null>(null);
  const [info, setInfo]   = useState<ChangePopoverInfo | null>(null);
  const [pos,  setPos]    = useState<{ x: number; y: number } | null>(null);
  const menuRef           = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;
    return createChangePopover(editor, {
      onShow: (r, i) => { setRect(r); setInfo(i); },
      onMove: (r, i) => { setRect(r); setInfo(i); },
      onHide: ()     => { setRect(null); setInfo(null); setPos(null); },
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
      middleware: [offset(8), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => setPos({ x, y }));
  }, [rect, info]);

  if (!rect || !info) return null;

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
        border:       `1px solid ${info.isConflict ? "#f59e0b" : "#e2e8f0"}`,
        borderRadius: 8,
        boxShadow:    info.isConflict
          ? "0 4px 16px rgba(245,158,11,0.18)"
          : "0 4px 16px rgba(0,0,0,0.12)",
        padding:      info.isConflict ? "10px 12px" : "8px 10px",
        display:      "flex",
        flexDirection: info.isConflict ? "column" : "row",
        alignItems:   info.isConflict ? "stretch" : "center",
        gap:          info.isConflict ? 8 : 8,
        fontSize:     13,
        whiteSpace:   "nowrap",
        minWidth:     info.isConflict ? 280 : 220,
      }}
    >
      {info.isConflict
        ? <ConflictPopover info={info} editor={editor} onClose={() => setRect(null)} />
        : <SingleChangePopover info={info} editor={editor} onClose={() => setRect(null)} />
      }
    </div>,
    document.body,
  );
}

// ── Single-change popover ──────────────────────────────────────────────────────

function SingleChangePopover({
  info,
  editor,
  onClose,
}: {
  info: ChangePopoverInfo;
  editor: Editor | null;
  onClose: () => void;
}) {
  const label  = OPERATION_LABEL[info.operation] ?? info.operation;
  const author = info.authorID.split(":").pop() ?? info.authorID;

  return (
    <>
      <span style={{
        ...badge,
        background: info.operation === CHANGE_OPERATION.delete ? "#fee2e2" : "#dcfce7",
        color:      info.operation === CHANGE_OPERATION.delete ? "#b91c1c" : "#15803d",
      }}>
        {info.operation === CHANGE_OPERATION.delete ? "−" : "+"} {label}
      </span>

      <span style={{ color: "#64748b", fontSize: 12, flex: 1 }}>
        {author}
      </span>

      <button
        onClick={() => { editor?.commands.setChangeStatuses?.(CHANGE_STATUS.accepted, [info.id]); onClose(); }}
        style={btnStyle("#15803d", "#fff")}
        title="Accept change"
      >
        ✓ Accept
      </button>
      <button
        onClick={() => { editor?.commands.setChangeStatuses?.(CHANGE_STATUS.rejected, [info.id]); onClose(); }}
        style={btnStyle("#b91c1c", "#fff")}
        title="Reject change"
      >
        ✗ Reject
      </button>
    </>
  );
}

// ── Conflict popover ───────────────────────────────────────────────────────────

function ConflictPopover({
  info,
  editor,
  onClose,
}: {
  info: ChangePopoverInfo;
  editor: Editor | null;
  onClose: () => void;
}) {
  const changes = info.conflictChanges.length > 0 ? info.conflictChanges : [info];

  function acceptOne(id: string) {
    // Accept the chosen change, reject all others in the conflict group
    const others = changes.filter(c => c.id !== id).map(c => c.id);
    editor?.commands.setChangeStatuses?.(CHANGE_STATUS.accepted, [id]);
    if (others.length > 0) editor?.commands.setChangeStatuses?.(CHANGE_STATUS.rejected, others);
    onClose();
  }

  function rejectAll() {
    editor?.commands.setChangeStatuses?.(CHANGE_STATUS.rejected, changes.map(c => c.id));
    onClose();
  }

  return (
    <>
      {/* Conflict header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ ...badge, background: "#fef3c7", color: "#92400e" }}>
          ⚡ Conflict
        </span>
        <span style={{ fontSize: 11, color: "#92400e" }}>
          {changes.length} overlapping changes
        </span>
      </div>

      {/* Per-author rows */}
      {changes.map((c) => {
        const author = c.authorID.split(":").pop() ?? c.authorID;
        const isDelete = c.operation === CHANGE_OPERATION.delete;
        return (
          <div
            key={c.id}
            style={{
              display:       "flex",
              alignItems:    "center",
              gap:           6,
              padding:       "4px 0",
              borderTop:     "1px solid #fde68a",
            }}
          >
            <span style={{
              ...badge,
              background: isDelete ? "#fee2e2" : "#dcfce7",
              color:      isDelete ? "#b91c1c" : "#15803d",
              flexShrink: 0,
            }}>
              {isDelete ? "−" : "+"} {OPERATION_LABEL[c.operation] ?? c.operation}
            </span>
            <span style={{ color: "#64748b", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
              {author}
            </span>
            <button
              onClick={() => acceptOne(c.id)}
              style={btnStyle("#15803d", "#fff")}
              title={`Accept ${author}'s change`}
            >
              Use this
            </button>
            <button
              onClick={() => { editor?.commands.setChangeStatuses?.(CHANGE_STATUS.rejected, [c.id]); onClose(); }}
              style={btnStyle("#64748b", "#fff")}
              title={`Reject ${author}'s change`}
            >
              ✗
            </button>
          </div>
        );
      })}

      {/* Reject all */}
      <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 2 }}>
        <button onClick={rejectAll} style={btnStyle("#b91c1c", "#fff")}>
          Reject All
        </button>
      </div>
    </>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const badge = {
  display:      "inline-flex",
  alignItems:   "center",
  gap:          3,
  padding:      "2px 7px",
  borderRadius: 99,
  fontSize:     11,
  fontWeight:   600,
} as const;

function btnStyle(bg: string, color: string) {
  return {
    background:   bg,
    color,
    border:       "none",
    borderRadius: 4,
    padding:      "3px 9px",
    cursor:       "pointer",
    fontSize:     12,
    fontWeight:   600,
    flexShrink:   0,
  } as const;
}
