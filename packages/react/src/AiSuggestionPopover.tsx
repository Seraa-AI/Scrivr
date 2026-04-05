import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import type { Editor } from "@scrivr/core";
import { createSuggestionPopover, getAiToolkit } from "@scrivr/plugins";
import type { SuggestionGroupInfo } from "@scrivr/plugins";

interface AiSuggestionPopoverProps {
  editor: Editor | null;
  /**
   * "direct"  — accepted changes are applied as plain document edits.
   * "tracked" — accepted changes enter the track-changes flow as pending marks.
   * Default: "direct".
   */
  mode?: "direct" | "tracked";
}

/**
 * AiSuggestionPopover — React component that shows accept/reject controls
 * when the cursor is inside an AI suggestion group.
 *
 * @example
 * <AiSuggestionPopover editor={editor} mode="tracked" />
 */
export function AiSuggestionPopover({
  editor,
  mode = "direct",
}: AiSuggestionPopoverProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [info, setInfo] = useState<SuggestionGroupInfo | null>(null);
  const [pos,  setPos]  = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;
    return createSuggestionPopover(editor, {
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
    let cancelled = false;
    computePosition(virtualEl, menuRef.current, {
      placement:  "bottom-start",
      middleware: [offset(8), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => { if (!cancelled) setPos({ x, y }); });
    return () => { cancelled = true; };
  }, [rect, info]);

  if (!rect || !info) return null;

  function handleAccept() {
    if (!editor) return;
    const ai = getAiToolkit(editor);
    ai?.suggestions?.apply({ groupId: info!.groupId, mode });
    setRect(null);
  }

  function handleAcceptAll() {
    if (!editor) return;
    const ai = getAiToolkit(editor);
    ai?.suggestions?.apply({ mode });
    setRect(null);
  }

  function handleReject() {
    if (!editor) return;
    const ai = getAiToolkit(editor);
    ai?.suggestions?.reject({ groupId: info!.groupId });
    setRect(null);
  }

  function handleRejectAll() {
    if (!editor) return;
    const ai = getAiToolkit(editor);
    ai?.suggestions?.reject();
    setRect(null);
  }

  const isReplacement = !!(info.replacedText && info.insertedText);
  const isPureInsert  = !info.replacedText && !!info.insertedText;

  return createPortal(
    <div
      ref={menuRef}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position:      "fixed",
        left:          pos?.x ?? 0,
        top:           pos?.y ?? 0,
        zIndex:        60,
        visibility:    pos ? "visible" : "hidden",
        background:    "#fff",
        border:        info.isStale ? "1.5px solid #f59e0b" : "1.5px solid #e2e8f0",
        borderRadius:  10,
        boxShadow:     "0 4px 16px rgba(0,0,0,0.12)",
        padding:       "8px 10px",
        display:       "flex",
        flexDirection: "column",
        gap:           8,
        fontSize:      13,
        minWidth:      240,
        maxWidth:      420,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ ...badge, background: "#ede9fe", color: "#6d28d9" }}>
          ✦ AI Suggestion
        </span>
        {info.isStale && (
          <span style={{ fontSize: 11, color: "#b45309" }}>Document changed</span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={handleAccept}    style={btnStyle("#15803d", "#fff")}>✓ Accept</button>
        <button onClick={handleReject}    style={btnStyle("#b91c1c", "#fff")}>✗ Reject</button>
      </div>

      {/* Preview */}
      {isReplacement && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={previewStyle("#fee2e2", "#b91c1c")}>
            Removing: <em>"{info.replacedText}"</em>
          </div>
          <div style={previewStyle("#f0fdf4", "#15803d")}>
            Adding: <em>"{info.insertedText}"</em>
          </div>
        </div>
      )}
      {isPureInsert && (
        <div style={previewStyle("#f0fdf4", "#15803d")}>
          Adding: <em>"{info.insertedText}"</em>
        </div>
      )}
      {!isReplacement && !isPureInsert && info.replacedText && (
        <div style={previewStyle("#fee2e2", "#b91c1c")}>
          Removing: <em>"{info.replacedText}"</em>
        </div>
      )}

      {/* Footer */}
      <div style={{
        display:        "flex",
        justifyContent: "flex-end",
        gap:            6,
        paddingTop:     2,
        borderTop:      "1px solid #f1f5f9",
      }}>
        <button onClick={handleAcceptAll} style={btnStyle("#6d28d9", "#fff")}>
          Accept All
        </button>
        <button onClick={handleRejectAll} style={btnStyle("#94a3b8", "#fff")}>
          Reject All
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const badge = {
  display:      "inline-flex",
  alignItems:   "center",
  gap:          3,
  padding:      "2px 7px",
  borderRadius: 99,
  fontSize:     11,
  fontWeight:   600,
  flexShrink:   0,
} as const;

function previewStyle(bg: string, color: string) {
  return {
    background:   bg,
    color,
    borderRadius: 4,
    padding:      "4px 8px",
    fontSize:     12,
    lineHeight:   1.4,
    fontFamily:   "Georgia, serif",
    wordBreak:    "break-word" as const,
    maxHeight:    60,
    overflowY:    "auto" as const,
  };
}

function btnStyle(bg: string, color: string) {
  return {
    background:   bg,
    color,
    border:       "none",
    borderRadius: 5,
    padding:      "4px 10px",
    cursor:       "pointer",
    fontSize:     12,
    fontWeight:   600,
    flexShrink:   0,
  } as const;
}
