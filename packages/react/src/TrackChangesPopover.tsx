import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import type { Editor } from "@scrivr/core";
import {
  createChangePopover,
  CHANGE_OPERATION,
  CHANGE_STATUS,
} from "@scrivr/plugins";
import type { ChangePopoverInfo } from "@scrivr/plugins";

interface TrackChangesPopoverProps {
  editor: Editor | null;
}

export function TrackChangesPopover({ editor }: TrackChangesPopoverProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [info, setInfo] = useState<ChangePopoverInfo | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;
    return createChangePopover(editor, {
      onShow: (r, i) => {
        setRect(r);
        setInfo(i);
      },
      onMove: (r, i) => {
        setRect(r);
        setInfo(i);
      },
      onHide: () => {
        setRect(null);
        setInfo(null);
        setPos(null);
      },
    });
  }, [editor]);

  useEffect(() => {
    if (!rect || !menuRef.current) return;
    const virtualEl = {
      getBoundingClientRect: () => rect,
      getClientRects: () => [rect] as unknown as DOMRectList,
    };
    let cancelled = false;
    computePosition(virtualEl, menuRef.current, {
      placement: "bottom-start",
      middleware: [
        offset(8),
        flip({ fallbackPlacements: ["top-start"] }),
        shift({ padding: 8 }),
      ],
    }).then(({ x, y }) => {
      if (!cancelled) setPos({ x, y });
    });
    return () => {
      cancelled = true;
    };
  }, [rect, info]);

  if (!rect || !info) return null;

  return createPortal(
    <div
      ref={menuRef}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        left: pos?.x ?? 0,
        top: pos?.y ?? 0,
        zIndex: 60,
        visibility: pos ? "visible" : "hidden",
        background: "#fff",
        border: `1.5px solid ${info.isConflict ? "#f59e0b" : "#e2e8f0"}`,
        borderRadius: 10,
        boxShadow: info.isConflict
          ? "0 6px 24px rgba(245,158,11,0.18)"
          : "0 4px 16px rgba(0,0,0,0.12)",
        padding: info.isConflict ? "12px 14px" : "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: info.isConflict ? 10 : 8,
        fontSize: 13,
        minWidth: info.isConflict ? 320 : 220,
        maxWidth: 420,
      }}
    >
      {info.isConflict ? (
        <ConflictPopover
          info={info}
          editor={editor}
          onClose={() => setRect(null)}
        />
      ) : (
        <SingleChangePopover
          info={info}
          editor={editor}
          onClose={() => setRect(null)}
        />
      )}
    </div>,
    document.body,
  );
}

// ── Single-change popover ──────────────────────────────────────────────────────

const MARK_ICONS: Record<string, string> = {
  bold: "B",
  italic: "I",
  underline: "U",
  strikethrough: "S",
  highlight: "H",
  color: "●",
  font_size: "Aa",
  font_family: "Ff",
  link: "↗",
};

const MARK_LABELS: Record<string, string> = {
  bold: "Bold",
  italic: "Italic",
  underline: "Underline",
  strikethrough: "Strikethrough",
  highlight: "Highlight",
  color: "Color",
  font_size: "Font size",
  font_family: "Font family",
  link: "Link",
};

/** Derive badge label, icon, bg, and text color from ChangePopoverInfo. */
function badgeMeta(info: ChangePopoverInfo): {
  icon: string;
  label: string;
  bg: string;
  color: string;
} {
  const isDelete = info.operation === CHANGE_OPERATION.delete;

  if (info.replacedText && info.insertedText) {
    return { icon: "↔", label: "Replacement", bg: "#ede9fe", color: "#6d28d9" };
  }
  if (info.changeKind === "mark" && info.markName) {
    const name = MARK_LABELS[info.markName] ?? info.markName;
    const icon = MARK_ICONS[info.markName] ?? "M";
    const label = isDelete ? `${name} removed` : `${name} added`;
    return { icon, label, bg: "#ede9fe", color: "#6d28d9" };
  }
  if (info.changeKind === "node-attr") {
    return {
      icon: "≡",
      label: "Style changed",
      bg: "#e0f2fe",
      color: "#0369a1",
    };
  }
  if (info.changeKind === "node") {
    return isDelete
      ? { icon: "□−", label: "Block removed", bg: "#fee2e2", color: "#b91c1c" }
      : { icon: "□+", label: "Block added", bg: "#dcfce7", color: "#15803d" };
  }
  if (info.operation === CHANGE_OPERATION.move) {
    return { icon: "⇄", label: "Moved", bg: "#fef3c7", color: "#92400e" };
  }
  return isDelete
    ? { icon: "−", label: "Deletion", bg: "#fee2e2", color: "#b91c1c" }
    : { icon: "+", label: "Insertion", bg: "#dcfce7", color: "#15803d" };
}

function SingleChangePopover({
  info,
  editor,
  onClose,
}: {
  info: ChangePopoverInfo;
  editor: Editor | null;
  onClose: () => void;
}) {
  const bm = badgeMeta(info);
  const author = shortName(info.authorID);
  const isDelete = info.operation === CHANGE_OPERATION.delete;
  const ids = info.groupIds.length > 0 ? info.groupIds : [info.id];

  // ── Preview content ────────────────────────────────────────────────────────
  let preview: React.ReactNode = null;

  if (info.replacedText && info.insertedText) {
    preview = (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={textPreview("#fee2e2", "#b91c1c")}>
          Removing: <em>"{info.replacedText}"</em>
        </div>
        <div style={textPreview("#f0fdf4", "#15803d")}>
          Adding: <em>"{info.insertedText}"</em>
        </div>
      </div>
    );
  } else if (info.changeKind === "node-attr") {
    // text is already the attr diff string ("Heading level: 1 → 2")
    if (info.text) {
      preview = (
        <div style={textPreview("#e0f2fe", "#0369a1")}>{info.text}</div>
      );
    }
  } else if (info.changeKind === "mark") {
    // Show the affected text without "Adding:" prefix — the badge already says what mark changed.
    if (info.text) {
      preview = (
        <div style={textPreview("#ede9fe", "#6d28d9")}>
          <em>"{info.text}"</em>
        </div>
      );
    }
  } else if (info.text) {
    preview = (
      <div
        style={textPreview(
          isDelete ? "#fee2e2" : "#f0fdf4",
          isDelete ? "#b91c1c" : "#15803d",
        )}
      >
        {isDelete ? "Removing: " : "Adding: "}
        <em>"{info.text}"</em>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ ...badge, background: bm.bg, color: bm.color }}>
          {bm.icon} {bm.label}
        </span>
        <span style={{ color: "#64748b", fontSize: 12, flex: 1 }}>
          {author}
        </span>
        <button
          onClick={() => {
            editor?.commands.setChangeStatuses?.(CHANGE_STATUS.accepted, ids);
            onClose();
          }}
          style={btnStyle("#15803d", "#fff")}
        >
          ✓ Accept
        </button>
        <button
          onClick={() => {
            editor?.commands.setChangeStatuses?.(CHANGE_STATUS.rejected, ids);
            onClose();
          }}
          style={btnStyle("#b91c1c", "#fff")}
        >
          ✗ Reject
        </button>
      </div>
      {preview}
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
  const changes =
    info.conflictChanges.length > 0 ? info.conflictChanges : [info];

  function acceptOne(id: string) {
    const others = changes.filter((c) => c.id !== id).map((c) => c.id);
    editor?.commands.setChangeStatuses?.(CHANGE_STATUS.accepted, [id]);
    if (others.length > 0)
      editor?.commands.setChangeStatuses?.(CHANGE_STATUS.rejected, others);
    onClose();
  }

  function rejectAll() {
    editor?.commands.setChangeStatuses?.(
      CHANGE_STATUS.rejected,
      changes.map((c) => c.id),
    );
    onClose();
  }

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            ...badge,
            background: "#fef3c7",
            color: "#92400e",
            fontSize: 12,
          }}
        >
          ⚡ Conflict
        </span>
        <span style={{ fontSize: 12, color: "#78350f", fontWeight: 500 }}>
          {changes.length} conflicting changes — choose how to resolve
        </span>
      </div>

      {/* Per-author rows */}
      {changes.map((c) => {
        const isDelete = c.operation === CHANGE_OPERATION.delete;
        const author = shortName(c.authorID);
        const actionLabel = isDelete ? "wants to remove" : "wants to add";
        const accentColor = isDelete ? "#b91c1c" : "#15803d";
        const bgColor = isDelete ? "#fff5f5" : "#f0fdf4";
        const borderColor = isDelete ? "#fecaca" : "#bbf7d0";

        return (
          <div
            key={c.id}
            style={{
              border: `1px solid ${borderColor}`,
              borderRadius: 8,
              background: bgColor,
              padding: "8px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {/* Author + action label */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  ...badge,
                  background: isDelete ? "#fee2e2" : "#dcfce7",
                  color: accentColor,
                }}
              >
                {badgeMeta(c).icon} {badgeMeta(c).label}
              </span>
              <span style={{ fontWeight: 600, color: "#1e293b", fontSize: 12 }}>
                {author}
              </span>
              <span style={{ color: "#64748b", fontSize: 11 }}>
                {actionLabel}
              </span>
            </div>

            {/* Text preview */}
            {c.text ? (
              <div
                style={textPreview(
                  isDelete ? "#fee2e2" : "#dcfce7",
                  accentColor,
                )}
              >
                "{c.text}"
              </div>
            ) : (
              <div
                style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}
              >
                {isDelete ? "(paragraph / node deletion)" : "(new content)"}
              </div>
            )}

            {/* Row actions */}
            <div
              style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}
            >
              <button
                onClick={() => acceptOne(c.id)}
                style={btnStyle(accentColor, "#fff")}
                title={`Accept ${author}'s ${isDelete ? "deletion" : "insertion"}, reject others`}
              >
                {isDelete ? "Keep deletion" : "Keep insertion"}
              </button>
              <button
                onClick={() => {
                  editor?.commands.setChangeStatuses?.(CHANGE_STATUS.rejected, [
                    c.id,
                  ]);
                  onClose();
                }}
                style={btnStyle("#94a3b8", "#fff")}
                title={`Reject only ${author}'s change`}
              >
                Ignore
              </button>
            </div>
          </div>
        );
      })}

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: 2,
        }}
      >
        <span style={{ fontSize: 11, color: "#94a3b8" }}>
          Or reject all changes in this range
        </span>
        <button onClick={rejectAll} style={btnStyle("#b91c1c", "#fff")}>
          Reject All
        </button>
      </div>
    </>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Display name: strip "user:" prefix if present, cap length. */
function shortName(authorID: string): string {
  const name = authorID.split(":").pop() ?? authorID;
  return name.length > 20 ? name.slice(0, 20) + "…" : name;
}

const badge = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  padding: "2px 7px",
  borderRadius: 99,
  fontSize: 11,
  fontWeight: 600,
  flexShrink: 0,
} as const;

function textPreview(bg: string, color: string) {
  return {
    background: bg,
    color,
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 12,
    lineHeight: 1.4,
    fontFamily: "Georgia, serif",
    wordBreak: "break-word" as const,
    maxHeight: 60,
    overflowY: "auto" as const,
  };
}

function btnStyle(bg: string, color: string) {
  return {
    background: bg,
    color,
    border: "none",
    borderRadius: 5,
    padding: "4px 10px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    flexShrink: 0,
  } as const;
}
