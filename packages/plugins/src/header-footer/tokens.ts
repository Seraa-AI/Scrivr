/**
 * Inline atom nodes for dynamic header/footer tokens.
 * These only exist in the schema when the HeaderFooter extension is loaded.
 *
 * Each token needs width/height attrs so the layout engine creates object
 * spans for them. Without these, collectInlineSpans() in BlockLayout.ts
 * skips the nodes entirely and no InlineStrategy render is called.
 *
 * Width values are tuned for the default 14px body font and 10px footer font.
 * Single digits measure ~6-8px at these sizes. The rendered text may overflow
 * slightly for multi-digit numbers (100+), but this is acceptable — the text
 * draws correctly, only the hit-testing width is approximate.
 */

import type { NodeSpec } from "prosemirror-model";

export const pageNumberNode: NodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  attrs: {
    width: { default: 7 },
    height: { default: 10 },
  },
  parseDOM: [{ tag: "span[data-page-number]" }],
  toDOM: () => ["span", { "data-page-number": "" }, "#"],
};

export const totalPagesNode: NodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  attrs: {
    width: { default: 7 },
    height: { default: 10 },
  },
  parseDOM: [{ tag: "span[data-total-pages]" }],
  toDOM: () => ["span", { "data-total-pages": "" }, "#"],
};

export const dateNode: NodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  attrs: {
    width: { default: 60 },
    height: { default: 10 },
    format: { default: "locale" },
    /** Frozen ISO string — when set, used instead of "now". Default is frozen (today). */
    frozen: { default: null },
  },
  parseDOM: [{ tag: "span[data-date]" }],
  toDOM: () => ["span", { "data-date": "" }, "DATE"],
};
