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

const KIND_COLOR: Record<AiSuggestionCardData["kind"], string> = {
  rewrite: COLOR_BRAND,
  insert:  COLOR_INSERT,
  delete:  COLOR_DELETE,
};

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

/**
 * Renders ops as an inline colour-coded diff inside a card.
 * Walking ops in order preserves all spaces (space tokens are keep ops).
 *
 *   keep   → light gray (context)
 *   delete → red, strikethrough
 *   insert → green background
 *
 * Long keep runs are trimmed in the middle to keep the card compact.
 */
function InlineDiff({ ops }: { ops: AiOp[] }) {
  const parts: React.ReactNode[] = [];

  ops.forEach((op, i) => {
    if (op.type === "keep") {
      const text =
        op.text.length > KEEP_TRIM
          ? op.text.slice(0, 18) + " … " + op.text.slice(-12)
          : op.text;
      parts.push(
        <span key={i} style={{ color: "#94a3b8" }}>{text}</span>,
      );
    } else if (op.type === "delete") {
      parts.push(
        <span
          key={i}
          style={{
            color:          COLOR_DELETE,
            textDecoration: "line-through",
            fontWeight:     500,
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
            background:   "rgba(220,252,231,0.8)",
            color:        COLOR_INSERT,
            borderRadius: 2,
            padding:      "0 1px",
            fontWeight:   500,
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
        lineHeight: 1.7,
        fontFamily: "system-ui, -apple-system, sans-serif",
        wordBreak:  "break-word",
        whiteSpace: "pre-wrap",
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
      <div style={{ display: "flex", gap: 6 }}>
        <button
          style={acceptAllBtnStyle}
          onMouseDown={(e) => { e.preventDefault(); actions.acceptAll(mode); }}
        >
          Accept All
        </button>
        <button
          style={rejectAllBtnStyle}
          onMouseDown={(e) => { e.preventDefault(); actions.rejectAll(); }}
        >
          Reject All
        </button>
      </div>

      {/* Cards */}
      {cards.map((card) => {
        const isExpanded = card.isActive || card.isHovered;
        const borderColor = card.isStale ? COLOR_STALE : KIND_COLOR[card.kind];

        return (
          <div
            key={card.blockId}
            style={{
              background:   "#fff",
              borderRadius: 8,
              boxShadow:    isExpanded
                ? "0 4px 16px rgba(0,0,0,0.12)"
                : "0 1px 4px rgba(0,0,0,0.07)",
              borderLeft:   `3px solid ${borderColor}`,
              fontFamily:   "system-ui, -apple-system, sans-serif",
              fontSize:     13,
              overflow:     "hidden",
              opacity:      card.isStale ? 0.7 : 1,
              transition:   "box-shadow 0.12s",
              cursor:       "default",
            }}
            onMouseEnter={() => actions.hover(card.blockId)}
            onMouseLeave={() => actions.hover(null)}
          >
            {/* Header row — click to move cursor into this block */}
            <div
              style={{
                display:    "flex",
                alignItems: "center",
                gap:        6,
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
                  color:        "#1e293b",
                  fontWeight:   500,
                  fontSize:     12,
                }}
              >
                {card.label}
              </span>
              <span style={{ color: "#cbd5e1", fontSize: 10, userSelect: "none" }}>
                {isExpanded ? "▲" : "▼"}
              </span>
            </div>

            {card.isStale && (
              <div style={{ padding: "0 10px 6px", color: COLOR_STALE, fontSize: 11 }}>
                ⚠ Document changed
              </div>
            )}

            {/* Expanded: inline diff + actions */}
            {isExpanded && (
              <div style={{ borderTop: "1px solid #f1f5f9", padding: "8px 10px 10px" }}>
                <InlineDiff ops={card.block.ops} />

                {/* Primary actions */}
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
                    Accept
                  </button>
                  <button
                    style={rejectBtnStyle}
                    onMouseDown={(e) => { e.preventDefault(); actions.reject(card.blockId); }}
                  >
                    Reject
                  </button>
                </div>

                {/* Secondary: accept as a direct edit (no track-changes marks) */}
                <button
                  style={{
                    ...acceptAsEditBtnStyle,
                    opacity: card.isStale ? 0.4 : 1,
                    cursor:  card.isStale ? "not-allowed" : "pointer",
                    marginTop: 6,
                  }}
                  disabled={card.isStale}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (!card.isStale) actions.accept(card.blockId, "direct");
                  }}
                >
                  Accept as Edit
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
  borderRadius:  3,
  padding:       "1px 4px",
  fontSize:      10,
  fontWeight:    700,
  letterSpacing: "0.03em",
  flexShrink:    0,
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

const acceptAsEditBtnStyle: React.CSSProperties = {
  width:        "100%",
  padding:      "4px 0",
  background:   "transparent",
  color:        COLOR_BRAND,
  border:       "1px solid rgba(99,102,241,0.35)",
  borderRadius: 5,
  fontSize:     11,
  fontWeight:   500,
  cursor:       "pointer",
  letterSpacing: "0.01em",
};

const rejectBtnStyle: React.CSSProperties = {
  flex:         1,
  padding:      "5px 0",
  background:   "transparent",
  color:        "#94a3b8",
  border:       "1px solid #e2e8f0",
  borderRadius: 5,
  fontSize:     12,
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
  background:   "transparent",
  color:        "#94a3b8",
  border:       "1px solid #e2e8f0",
  borderRadius: 5,
  fontSize:     12,
  fontWeight:   500,
  cursor:       "pointer",
};
