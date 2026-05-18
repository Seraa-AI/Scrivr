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

import { useState } from "react";
import type { Editor } from "@scrivr/core";
import type { AiOp } from "@scrivr/plugins";
import { cx } from "../utils/classNames";
import { useAiSuggestionCards } from "../hooks/useAiSuggestionCards";

// ── Constants ─────────────────────────────────────────────────────────────────

const CARD_WIDTH = 260;
/** Keep runs longer than this are trimmed in the inline diff */
const KEEP_TRIM = 40;

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
        <span key={i}>
          {text}
        </span>,
      );
    } else if (op.type === "delete") {
      parts.push(
        <span
          key={i}
          data-part="description"
          data-change-kind="delete"
          style={{
            textDecoration: "line-through",
          }}
        >
          {op.text}
        </span>,
      );
    } else {
      parts.push(
        <span
          key={i}
          data-part="description"
          data-change-kind="insert"
        >
          {op.text}
        </span>,
      );
    }
  });

  return (
    <div
      style={{
        lineHeight: 1.8,
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
      }}
    >
      {parts}
    </div>
  );
}

// ── Style overrides ───────────────────────────────────────────────────────────

/**
 * Per-slot class name overrides. Applied in addition to built-in inline styles,
 * so Tailwind, CSS modules, or any class-based approach works naturally.
 */
export interface AiSuggestionCardClassNames {
  /** Outer panel container (the sticky column). */
  panel?: string;
  /** Individual card wrapper. */
  card?: string;
  /** Card header row (badge + label + chevron). */
  header?: string;
  /** The "✦ AI" badge. */
  badge?: string;
  /** Diff body container (shown when expanded). */
  diff?: string;
  /** Button row container (Accept / Reject / Edit first). */
  actions?: string;
}

/**
 * Per-slot inline style overrides. Merged over the built-in styles,
 * so individual properties can be changed without replacing everything.
 */
export interface AiSuggestionCardStyles {
  panel?: React.CSSProperties;
  card?: React.CSSProperties;
  header?: React.CSSProperties;
  badge?: React.CSSProperties;
  diff?: React.CSSProperties;
  actions?: React.CSSProperties;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface AiSuggestionCardsPanelProps {
  editor: Editor | null;
  mode?: "direct" | "tracked";
  className?: string | undefined;
  itemClassName?: string | undefined;
  iconClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
  /** Per-slot class name overrides — works with Tailwind, CSS modules, etc. */
  classNames?: AiSuggestionCardClassNames;
  /** Per-slot inline style overrides — merged over the built-in styles. */
  styles?: AiSuggestionCardStyles;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AiSuggestionCardsPanel({
  editor,
  mode = "direct",
  className,
  itemClassName,
  iconClassName,
  titleClassName,
  descriptionClassName,
  classNames: cn = {},
  styles: sx = {},
}: AiSuggestionCardsPanelProps) {
  // Single open card at a time — null means all collapsed.
  const [openId, setOpenId] = useState<string | null>(null);

  // Auto-open the card when cursor enters a suggestion block.
  const { cards, actions } = useAiSuggestionCards(editor, {
    onFocus: (blockId) => setOpenId(blockId),
  });

  if (!editor || cards.length === 0 || !actions) return null;

  return (
    <div
      className={cx("scrivr-ai-cards", cn.panel, className)}
      style={{
        width: CARD_WIDTH,
        flexShrink: 0,
        position: "sticky",
        top: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignSelf: "flex-start",
        ...sx.panel,
      }}
    >
      {/* Accept All / Reject All */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className={cx("scrivr-menu-item", itemClassName)}
          style={acceptAllBtnStyle}
          onMouseDown={(e) => {
            e.preventDefault();
            actions.acceptAll(mode);
          }}
        >
          ✓ Accept All
        </button>
        <button
          className={cx("scrivr-menu-item", itemClassName)}
          style={rejectAllBtnStyle}
          onMouseDown={(e) => {
            e.preventDefault();
            actions.rejectAll();
          }}
        >
          ✕ Reject All
        </button>
      </div>

      {/* Cards */}
      {cards.map((card) => {
        const isExpanded = openId === card.blockId;
        const isHighlighted = isExpanded || card.isActive;

        return (
          <div
            key={card.blockId}
            className={cx("scrivr-ai-card", cn.card)}
            data-active={isHighlighted ? "" : undefined}
            data-disabled={card.isStale ? "" : undefined}
            style={{
              overflow: "hidden",
              opacity: card.isStale ? 0.65 : 1,
              cursor: "default",
              ...sx.card,
            }}
            onMouseEnter={() => actions.hover(card.blockId)}
            onMouseLeave={() => actions.hover(null)}
          >
            {/* Header */}
            <div
              className={cx("scrivr-ai-card-header", cn.header)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "7px 10px",
                cursor: "pointer",
                ...sx.header,
              }}
              onClick={() => {
                if (openId === card.blockId) {
                  setOpenId(null);
                } else {
                  setOpenId(card.blockId);
                  actions.activate(card.blockId);
                }
              }}
            >
              <span
                className={cx("scrivr-menu-icon", cn.badge, iconClassName)}
                data-part="icon"
                style={{ ...aiBadgeStyle, ...sx.badge }}
              >
                AI
              </span>
              <span
                className={cx("scrivr-menu-title", titleClassName)}
                data-part="title"
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {card.label}
              </span>
              <span
                style={{
                  userSelect: "none",
                  flexShrink: 0,
                }}
              >
                {isExpanded ? "∧" : "∨"}
              </span>
            </div>

            {card.isStale && (
              <div
                className={cx("scrivr-menu-description", descriptionClassName)}
                data-part="description"
                style={{
                }}
              >
                Document changed
              </div>
            )}

            {/* Expanded: diff + actions */}
            {isExpanded && (
              <div
                style={{
                }}
              >
                <div className={cn.diff} style={sx.diff}>
                  <InlineDiff ops={card.block.ops} />
                </div>

                {/* Accept / Reject / Edit first */}
                <div className={cn.actions} style={{ ...sx.actions }}>
                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                    <button
                      className={cx("scrivr-menu-item", itemClassName)}
                      data-disabled={card.isStale ? "" : undefined}
                      style={{
                        ...acceptBtnStyle,
                        opacity: card.isStale ? 0.4 : 1,
                        cursor: card.isStale ? "not-allowed" : "pointer",
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
                      className={cx("scrivr-menu-item", itemClassName)}
                      style={rejectBtnStyle}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        actions.reject(card.blockId);
                      }}
                    >
                      Reject
                    </button>
                  </div>
                  <button
                    className={cx("scrivr-menu-item", itemClassName)}
                    data-disabled={card.isStale ? "" : undefined}
                    style={{
                      ...acceptAsEditBtnStyle,
                      opacity: card.isStale ? 0.4 : 1,
                      cursor: card.isStale ? "not-allowed" : "pointer",
                      marginTop: 6,
                    }}
                    disabled={card.isStale}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (!card.isStale) actions.accept(card.blockId, "direct");
                    }}
                  >
                    Edit first
                  </button>
                </div>
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
  flexShrink: 0,
  lineHeight: 1.4,
};

const acceptBtnStyle: React.CSSProperties = {
  flex: 1,
  border: "none",
  cursor: "pointer",
};

const rejectBtnStyle: React.CSSProperties = {
  flex: 1,
  cursor: "pointer",
};

const acceptAsEditBtnStyle: React.CSSProperties = {
  width: "100%",
  cursor: "pointer",
};

const acceptAllBtnStyle: React.CSSProperties = {
  flex: 1,
  border: "none",
  cursor: "pointer",
};

const rejectAllBtnStyle: React.CSSProperties = {
  flex: 1,
  cursor: "pointer",
};
