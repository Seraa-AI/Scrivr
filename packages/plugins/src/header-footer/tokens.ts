/**
 * Inline atom nodes for dynamic header/footer tokens.
 * These only exist in the schema when the HeaderFooter extension is loaded.
 *
 * Each token needs width/height attrs so the layout engine creates object
 * spans for them. Without these, collectInlineSpans() in BlockLayout.ts
 * skips the nodes entirely and no InlineStrategy render is called.
 *
 * The width/height values are placeholders — the actual rendered text
 * may be wider or narrower. A stable-width measurement system (using the
 * widest digit) is a future improvement.
 */

import type { NodeSpec } from "prosemirror-model";

export const pageNumberNode: NodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  attrs: {
    width: { default: 20 },
    height: { default: 14 },
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
    width: { default: 20 },
    height: { default: 14 },
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
    width: { default: 80 },
    height: { default: 14 },
    format: { default: "locale" },
    /** Frozen ISO string — when set, used instead of "now". Default is frozen (today). */
    frozen: { default: null },
  },
  parseDOM: [{ tag: "span[data-date]" }],
  toDOM: () => ["span", { "data-date": "" }, "DATE"],
};
