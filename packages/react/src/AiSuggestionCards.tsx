/**
 * AiSuggestionCards.tsx
 *
 * In-flow AI suggestion panel. Sits to the right of the editor pages in a
 * flex row — feels like part of the document, not a floating overlay.
 *
 * Cards are one-per-AiSuggestionBlock (per changed paragraph).
 * Collapsed by default; expands when cursor is inside the block or card is hovered.
 * Expanded body shows an inline colour-coded diff (keep / delete / insert).
 *
 * Built on top of `subscribeToAiSuggestions` — a vanilla JS API that works
 * in any framework. This file is the React reference implementation.
 */

import { useEffect, useState } from "react";
import type { Editor } from "@scrivr/core";
import { subscribeToAiSuggestions } from "@scrivr/plugins";
import type {
  AiSuggestionCardData,
  AiSuggestionCardActions,
  AiOp,
} from "@scrivr/plugins";

// ── Constants ─────────────────────────────────────────────────────────────────

const CARD_WIDTH   = 260;
const COLOR_BRAND  = "#4f46e5"; // indigo-600
const COLOR_DELETE = "#dc2626"; // red-600
const COLOR_INSERT = "#16a34a"; // green-600
const COLOR_STALE  = "#f59e0b"; // amber-500
/** Keep runs longer than this are trimmed in the inline diff */
const KEEP_TRIM    = 40;

// ── React hook (headless) ────────────────────────────────────────────────────

/**
 * Headless hook — use this if you want to build your own card UI.
 *
 * Returns the current card list and action functions. Automatically
 * re-renders when the editor state changes.
 */
export function useAiSuggestionCards(editor: Editor | null): {
  cards:   AiSuggestionCardData[];
  actions: AiSuggestionCardActions | null;
} {
  const [state, setState] = useState<{
    cards:   AiSuggestionCardData[];
    actions: AiSuggestionCardActions | null;
  }>({ cards: [], actions: null });

  useEffect(() => {
    if (!editor) { setState({ cards: [], actions: null }); return; }

    const unsub = subscribeToAiSuggestions(editor, (cards, actions) => {
      setState({ cards, actions });
    });

    return unsub;
  }, [editor]);

  return state;
}

// ── Inline diff renderer ──────────────────────────────────────────────────────

function InlineDiff({ ops }: { ops: AiOp[] }) {
  const parts: React.ReactNode[] = [];

  ops.forEach((op, i) => {
    if (op.type === "keep") {
      const text =
        op.text.length > KEEP_TRIM
          ? op.text.slice(0, 18) + " … " + op.text.slice(-12)
          : op.text;
      parts.push(
        <span key={i} style={{ color: "#374151" }}>{text}</span>,
      );
    } else if (op.type === "delete") {
      parts.push(
        <span
          key={i}
          style={{
            color:               "rgba(185, 28, 28, 0.8)",
            textDecoration:      "line-through",
            textDecorationColor: "rgba(185, 28, 28, 0.5)",
          }}
        >
          {op.text}
        </span>,
      );
    } else {
      parts.push(
        <span
          key={i}
          style={{
            color: "rgba(21, 128, 61, 0.9)",
          }}
        >
          {op.text}
        </span>,
      );
    }
  });

  return (
    <div
      style={{
        fontSize:   12,
        lineHeight: 1.8,
        fontFamily: "system-ui, -apple-system, sans-serif",
        wordBreak:  "break-word",
        whiteSpace: "pre-wrap",
        color:      "#374151",
      }}
    >
      {parts}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface AiSuggestionCardsPanelProps {
  editor: Editor | null;
  mode?:  "direct" | "tracked";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AiSuggestionCardsPanel({
  editor,
  mode = "direct",
}: AiSuggestionCardsPanelProps) {
  const { cards, actions } = useAiSuggestionCards(editor);

  if (!editor || cards.length === 0 || !actions) return null;

  return (
    <div
      style={{
        width:         CARD_WIDTH,
        flexShrink:    0,
        position:      "sticky",
        top:           16,
        display:       "flex",
        flexDirection: "column",
        gap:           8,
        alignSelf:     "flex-start",
      }}
    >
      {/* Accept All / Reject All */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          style={acceptAllBtnStyle}
          onMouseDown={(e) => { e.preventDefault(); actions.acceptAll(mode); }}
        >
          ✓ Accept All
        </button>
        <button
          style={rejectAllBtnStyle}
          onMouseDown={(e) => { e.preventDefault(); actions.rejectAll(); }}
        >
          ✕ Reject All
        </button>
      </div>

      {/* Cards */}
      {cards.map((card) => {
        const isExpanded = card.isActive;

        return (
          <div
            key={card.blockId}
            style={{
              background:   "#ffffff",
              borderRadius: 8,
              border:       isExpanded
                ? `2px solid ${COLOR_BRAND}`
                : "1.5px solid #e5e7eb",
              boxShadow:    isExpanded
                ? "0 2px 12px rgba(79,70,229,0.10)"
                : "0 1px 3px rgba(0,0,0,0.06)",
              fontFamily:   "system-ui, -apple-system, sans-serif",
              overflow:     "hidden",
              opacity:      card.isStale ? 0.65 : 1,
              transition:   "border-color 0.15s, box-shadow 0.15s",
              cursor:       "default",
            }}
            onMouseEnter={() => actions.hover(card.blockId)}
            onMouseLeave={() => actions.hover(null)}
          >
            {/* Header */}
            <div
              style={{
                display:    "flex",
                alignItems: "center",
                gap:        7,
                padding:    "7px 10px",
                cursor:     "pointer",
              }}
              onClick={() => actions.activate(card.blockId)}
            >
              <span style={aiBadgeStyle}>✦ AI</span>
              <span
                style={{
                  flex:         1,
                  overflow:     "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace:   "nowrap",
                  color:        "#111827",
                  fontWeight:   500,
                  fontSize:     12,
                }}
              >
                {card.label}
              </span>
              <span style={{ color: "#9ca3af", fontSize: 12, userSelect: "none", flexShrink: 0 }}>
                {isExpanded ? "∧" : "∨"}
              </span>
            </div>

            {card.isStale && (
              <div style={{ padding: "0 10px 6px", color: COLOR_STALE, fontSize: 11 }}>
                ⚠ Document changed
              </div>
            )}

            {/* Expanded: diff + actions */}
            {isExpanded && (
              <div style={{ borderTop: "1px solid #f3f4f6", padding: "8px 10px 10px" }}>
                <InlineDiff ops={card.block.ops} />

                {/* Accept / Reject row */}
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button
                    style={{
                      ...acceptBtnStyle,
                      opacity: card.isStale ? 0.4 : 1,
                      cursor:  card.isStale ? "not-allowed" : "pointer",
                    }}
                    disabled={card.isStale}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (!card.isStale) actions.accept(card.blockId, mode);
                    }}
                  >
                    ✓ Accept
                  </button>
                  <button
                    style={rejectBtnStyle}
                    onMouseDown={(e) => { e.preventDefault(); actions.reject(card.blockId); }}
                  >
                    ✕ Reject
                  </button>
                </div>

                {/* Edit first */}
                <button
                  style={{
                    ...acceptAsEditBtnStyle,
                    opacity:   card.isStale ? 0.4 : 1,
                    cursor:    card.isStale ? "not-allowed" : "pointer",
                    marginTop: 6,
                  }}
                  disabled={card.isStale}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (!card.isStale) actions.accept(card.blockId, "direct");
                  }}
                >
                  ✎ Edit first
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const aiBadgeStyle: React.CSSProperties = {
  background:    COLOR_BRAND,
  color:         "#fff",
  borderRadius:  4,
  padding:       "2px 6px",
  fontSize:      10,
  fontWeight:    700,
  letterSpacing: "0.03em",
  flexShrink:    0,
  lineHeight:    1.4,
};

const acceptBtnStyle: React.CSSProperties = {
  flex:         1,
  padding:      "5px 0",
  background:   COLOR_BRAND,
  color:        "#fff",
  border:       "none",
  borderRadius: 5,
  fontSize:     12,
  fontWeight:   600,
  cursor:       "pointer",
};

const rejectBtnStyle: React.CSSProperties = {
  flex:         1,
  padding:      "5px 0",
  background:   "#ffffff",
  color:        "#6b7280",
  border:       "1.5px solid #e5e7eb",
  borderRadius: 5,
  fontSize:     12,
  fontWeight:   500,
  cursor:       "pointer",
};

const acceptAsEditBtnStyle: React.CSSProperties = {
  width:        "100%",
  padding:      "4px 0",
  background:   "#ffffff",
  color:        "#6b7280",
  border:       "1.5px solid #e5e7eb",
  borderRadius: 5,
  fontSize:     11,
  fontWeight:   500,
  cursor:       "pointer",
};

const acceptAllBtnStyle: React.CSSProperties = {
  flex:         1,
  padding:      "5px 0",
  background:   COLOR_BRAND,
  color:        "#fff",
  border:       "none",
  borderRadius: 5,
  fontSize:     12,
  fontWeight:   600,
  cursor:       "pointer",
};

const rejectAllBtnStyle: React.CSSProperties = {
  flex:         1,
  padding:      "5px 0",
  background:   "#ffffff",
  color:        "#6b7280",
  border:       "1.5px solid #e5e7eb",
  borderRadius: 5,
  fontSize:     12,
  fontWeight:   500,
  cursor:       "pointer",
};
